import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ErrorCode, GameError } from '../common/errors/game-error';
import { RANDOM_SOURCE, RandomSource } from '../common/random/random.source';
import { generateCode } from './session.code';
import { SessionLock } from './session.lock';
import { SessionRepository } from './session.repository';
import {
  Board,
  BOARD_SIZE,
  Difficulty,
  Player,
  SessionState,
} from './session.types';

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;
// Limite de exibição do nome: nomes maiores quebram o layout do tabuleiro/lobby.
const MAX_NAME_LENGTH = 24;
// Caracteres de controle (C0 0x00–0x1F, DEL 0x7F, C1 0x80–0x9F): removidos para
// preservar a integridade do layout e dos logs. NÃO é mitigação de XSS — o
// escape/sanitização de HTML é responsabilidade do client ao renderizar o nome.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

// Regras de lobby/presença: criar, entrar, iniciar, sair, desconectar.
// Validações lançam GameError(code), traduzido pelo gateway em evento `error`.
//
// Toda operação de ESCRITA (read-modify-write) roda sob SessionLock por `code`
// para evitar lost-update sob eventos concorrentes da mesma sessão (achado P2).
// createSession é exceção: já é atômico via SET NX e não tem estado prévio a
// proteger; getState é leitura pura.
@Injectable()
export class SessionService {
  constructor(
    private readonly repo: SessionRepository,
    @Inject(RANDOM_SOURCE) private readonly rng: RandomSource,
    private readonly lock: SessionLock,
  ) {}

  async createSession(
    name: string,
    difficulty: Difficulty,
    socketId: string,
  ): Promise<{ state: SessionState; playerId: string }> {
    const cleanName = this.validateName(name);
    const playerId = randomUUID();

    // Gera um código e tenta gravar atomicamente; em colisão (SET NX falha),
    // re-gera. O teto evita laço infinito teórico (espaço de 100k códigos).
    for (let attempt = 0; attempt < 1000; attempt++) {
      const now = new Date().toISOString();
      const state: SessionState = {
        code: generateCode(this.rng),
        status: 'lobby',
        difficulty,
        board: this.makeBoard(),
        players: [this.makePlayer(playerId, cleanName, socketId, true)],
        turnOrder: [],
        currentTurnIndex: 0,
        winner: null,
        createdAt: now,
        lastActivityAt: now,
        servedQuestionIds: [],
        ordering: null,
      };
      if (await this.repo.createIfAbsent(state)) {
        return { state, playerId };
      }
    }
    throw new Error('Não foi possível gerar um código de sessão único');
  }

  async joinSession(
    code: string,
    name: string,
    socketId: string,
  ): Promise<{ state: SessionState; playerId: string }> {
    const cleanName = this.validateName(name);
    return this.lock.runExclusive(code, async () => {
      const state = await this.requireSession(code);
      if (state.status !== 'lobby') {
        throw new GameError(ErrorCode.SESSION_ALREADY_STARTED);
      }
      if (state.players.length >= MAX_PLAYERS) {
        throw new GameError(ErrorCode.SESSION_FULL);
      }
      const playerId = randomUUID();
      state.players.push(this.makePlayer(playerId, cleanName, socketId, false));
      await this.repo.save(state);
      return { state, playerId };
    });
  }

  async startGame(
    code: string,
    requesterPlayerId: string,
  ): Promise<SessionState> {
    return this.lock.runExclusive(code, async () => {
      const state = await this.requireSession(code);
      if (state.status !== 'lobby') {
        throw new GameError(ErrorCode.SESSION_ALREADY_STARTED);
      }
      const host = state.players.find((p) => p.isHost);
      if (!host || host.id !== requesterPlayerId) {
        throw new GameError(ErrorCode.NOT_HOST);
      }
      if (state.players.length < MIN_PLAYERS) {
        throw new GameError(ErrorCode.NOT_ENOUGH_PLAYERS);
      }
      // Entra na fase interativa de ordem (RF-04): os jogadores rolam o d6 para
      // decidir quem começa antes de o jogo ir para 'playing'. O tabuleiro
      // procedural é gerado pelo GameService.setupBoard (P3: não geramos um
      // board fixo aqui que seria imediatamente sobrescrito).
      state.status = 'ordering';
      state.players.forEach((p) => (p.square = 0));
      await this.repo.save(state);
      return state;
    });
  }

  // Saída voluntária no meio da sessão (RF). Antes só filtrava de players[],
  // deixando o id no turnOrder/currentTurnIndex — id fantasma travava a partida
  // (achado #3). Agora reaproveita o helper removePlayer, que reconcilia o turno
  // e aplica a regra do vencedor por abandono. Retorna o que ocorreu para o
  // gateway emitir os eventos certos (gameOver/gameState/lobbyState).
  async leaveSession(
    code: string,
    playerId: string,
  ): Promise<{
    state: SessionState | null;
    gameEnded: boolean;
    sessionDeleted: boolean;
  }> {
    return this.lock.runExclusive(code, async () => {
      const state = await this.repo.findByCode(code);
      if (!state) {
        return { state: null, gameEnded: false, sessionDeleted: false };
      }
      const result = this.removePlayer(state, playerId);
      if (result.sessionDeleted) {
        await this.repo.delete(code);
        return { state: null, gameEnded: false, sessionDeleted: true };
      }
      await this.repo.save(state);
      return {
        state,
        gameEnded: result.gameEnded,
        sessionDeleted: false,
      };
    });
  }

  // Volta a sessão ao lobby (ex.: jogadores insuficientes para definir a ordem
  // depois de uma saída na fase de ordem — RF-04). Limpa a ordem/ordenação e
  // preserva os jogadores restantes para um novo início.
  async returnToLobby(code: string): Promise<SessionState | null> {
    return this.lock.runExclusive(code, async () => {
      const state = await this.repo.findByCode(code);
      if (!state) return null;
      state.status = 'lobby';
      state.ordering = null;
      state.turnOrder = [];
      state.currentTurnIndex = 0;
      await this.repo.save(state);
      return state;
    });
  }

  // Marca o jogador como desconectado, preservando-o no estado para reconexão (Sprint 2).
  async markDisconnected(
    code: string,
    playerId: string,
  ): Promise<SessionState | null> {
    return this.lock.runExclusive(code, async () => {
      const state = await this.repo.findByCode(code);
      if (!state) return null;
      const player = state.players.find((p) => p.id === playerId);
      if (player) player.connected = false;
      await this.repo.save(state);
      return state;
    });
  }

  // Reconecta um jogador dentro da janela de grace (RF-14): revincula o novo
  // socket e marca como conectado. O `playerId` (UUIDv4) é o portador da
  // identidade — sessão/jogador inexistentes resultam em RECONNECT_FAILED, sem
  // vazar qual dos dois faltou.
  async reconnect(
    code: string,
    playerId: string,
    socketId: string,
  ): Promise<SessionState> {
    return this.lock.runExclusive(code, async () => {
      const state = await this.repo.findByCode(code);
      if (!state) throw new GameError(ErrorCode.RECONNECT_FAILED);
      const player = state.players.find((p) => p.id === playerId);
      if (!player) throw new GameError(ErrorCode.RECONNECT_FAILED);
      player.connected = true;
      player.socketId = socketId;
      await this.repo.save(state);
      return state;
    });
  }

  // Expira a janela de reconexão de um jogador (RF-14/15): se ele não reconectou,
  // remove-o da sessão; se a sessão ficar sem ninguém, apaga do Redis. Retorna o
  // que aconteceu para o gateway emitir os eventos certos (sessionClosed/lobby).
  async expireDisconnectedPlayer(
    code: string,
    playerId: string,
  ): Promise<{
    state: SessionState | null;
    removed: boolean;
    sessionDeleted: boolean;
  }> {
    return this.lock.runExclusive(code, async () => {
      const state = await this.repo.findByCode(code);
      if (!state) return { state: null, removed: false, sessionDeleted: false };
      const player = state.players.find((p) => p.id === playerId);
      // Reconectou no intervalo → nada a fazer.
      if (!player || player.connected) {
        return { state, removed: false, sessionDeleted: false };
      }
      // Reaproveita a mesma reconciliação de turno/vencedor que leaveSession
      // (achado #3): assim a queda para 1 jogador em playing também termina a
      // partida e declara o restante vencedor (paridade entre os dois caminhos).
      const result = this.removePlayer(state, playerId);
      if (result.sessionDeleted) {
        await this.repo.delete(code);
        return { state: null, removed: true, sessionDeleted: true };
      }
      await this.repo.save(state);
      return { state, removed: true, sessionDeleted: false };
    });
  }

  // Helper compartilhado por leaveSession e expireDisconnectedPlayer (achado #3).
  // Remove o jogador de players[] e — mantendo a integridade do turno — também de
  // turnOrder, reajustando currentTurnIndex para nunca apontar para um id fantasma.
  // Regra de produto: se a partida está em 'playing' e sobra exatamente 1 jogador,
  // a partida TERMINA e o restante é declarado vencedor (status 'finished',
  // winner = id do restante). Muta `state` in place; NÃO persiste (cada chamador
  // decide salvar ou apagar conforme sessionDeleted). Retorna sinais para o
  // chamador montar a resposta/eventos.
  private removePlayer(
    state: SessionState,
    playerId: string,
  ): { gameEnded: boolean; sessionDeleted: boolean } {
    const removedIdx = state.turnOrder.indexOf(playerId);
    state.players = state.players.filter((p) => p.id !== playerId);
    if (state.players.length === 0) {
      return { gameEnded: false, sessionDeleted: true };
    }
    // Remove da ordem de turnos e reajusta currentTurnIndex para não apontar para
    // um jogador inexistente (evita turnChanged/rotação inconsistentes em jogo).
    state.turnOrder = state.turnOrder.filter((id) => id !== playerId);
    if (state.turnOrder.length > 0) {
      // Removemos alguém antes do índice atual → recua um p/ preservar o alvo.
      if (removedIdx !== -1 && removedIdx < state.currentTurnIndex) {
        state.currentTurnIndex -= 1;
      }
      // Mantém o índice dentro dos limites (wrap quando o removido era o último).
      state.currentTurnIndex %= state.turnOrder.length;
    }
    // Partida em andamento que cai para 1 jogador: termina por abandono, restante
    // vence. Só vale em 'playing' — no lobby/ordering a saída não declara vencedor.
    if (state.status === 'playing' && state.players.length === 1) {
      state.status = 'finished';
      state.winner = state.players[0].id;
      return { gameEnded: true, sessionDeleted: false };
    }
    return { gameEnded: false, sessionDeleted: false };
  }

  // Define a aparência cosmética do jogador (CONTRACT-S5): cor (hex) e emoji,
  // propagados a todos via lobbyState/gameState. Puramente visual — não toca
  // nenhuma regra (movimento/ordem/pergunta/prisão) nem RF-16. Funciona em
  // qualquer status (lobby, ordering, playing). Sob lock por ser read-modify-
  // write como as demais escritas (achado P2). NOT_IN_SESSION (em vez de
  // SESSION_NOT_FOUND) para não revelar a existência da sessão a um não-membro.
  async setAppearance(
    code: string,
    playerId: string,
    color: string,
    emoji: string,
  ): Promise<SessionState> {
    return this.lock.runExclusive(code, async () => {
      const state = await this.repo.findByCode(code);
      if (!state) throw new GameError(ErrorCode.NOT_IN_SESSION);
      const player = state.players.find((p) => p.id === playerId);
      if (!player) throw new GameError(ErrorCode.NOT_IN_SESSION);
      player.color = color;
      player.emoji = emoji;
      await this.repo.save(state);
      return state;
    });
  }

  getState(code: string): Promise<SessionState | null> {
    return this.repo.findByCode(code);
  }

  // Lista os códigos de todas as sessões vivas no Redis (passthrough do SCAN do
  // repositório). Usado pela reconciliação de grace no boot (achado #2).
  listSessionCodes(): Promise<string[]> {
    return this.repo.scanCodes();
  }

  private async requireSession(code: string): Promise<SessionState> {
    const state = await this.repo.findByCode(code);
    if (!state) throw new GameError(ErrorCode.SESSION_NOT_FOUND);
    return state;
  }

  // Sanitiza o nome enviado pelo jogador antes de projetá-lo a todos os clients
  // (lobbyState/playerJoined/gameState). Remove caracteres de controle e limita
  // o tamanho; só rejeita (INVALID_NAME) quando nada útil sobra, para não
  // atrapalhar o jogador com truncamento/limpeza silenciosos.
  private validateName(name: string): string {
    const sanitized = (name ?? '').replace(CONTROL_CHARS, '').trim();
    if (sanitized.length === 0) throw new GameError(ErrorCode.INVALID_NAME);
    // Trunca por code points (Array.from itera por code points) para não cortar
    // um par substituto ao meio — ex.: emoji — gerando surrogate inválido. Novo
    // trim após o corte evita um nome terminado em espaço quando o limite cai
    // logo após um espaço interno.
    return Array.from(sanitized).slice(0, MAX_NAME_LENGTH).join('').trim();
  }

  private makePlayer(
    id: string,
    name: string,
    socketId: string,
    isHost: boolean,
  ): Player {
    return {
      id,
      name,
      socketId,
      square: 0,
      connected: true,
      isHost,
      usedQuestionIds: [],
      skipTurns: 0,
      pendingQuestion: null,
    };
  }

  // Tabuleiro fixo: casa 0 = início, casa N = chegada, demais 'normal'.
  // @deprecated Sprint 2 substitui por board.rules.generateBoard (procedural) no
  // início da partida (S2-07). Mantido para o lobby ter um board válido.
  private makeBoard(): Board {
    return {
      size: BOARD_SIZE,
      tileTypeBySquare: { 0: 'start', [BOARD_SIZE]: 'finish' },
      subjectBySquare: {},
    };
  }
}
