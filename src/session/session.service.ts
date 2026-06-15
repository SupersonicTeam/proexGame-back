import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ErrorCode, GameError } from '../common/errors/game-error';
import { RANDOM_SOURCE, RandomSource } from '../common/random/random.source';
import { generateCode } from './session.code';
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
// não corromper o layout nem virar vetor de XSS no client se este não escapar.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

// Regras de lobby/presença: criar, entrar, iniciar, sair, desconectar.
// Validações lançam GameError(code), traduzido pelo gateway em evento `error`.
@Injectable()
export class SessionService {
  constructor(
    private readonly repo: SessionRepository,
    @Inject(RANDOM_SOURCE) private readonly rng: RandomSource,
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
  }

  async startGame(
    code: string,
    requesterPlayerId: string,
  ): Promise<SessionState> {
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
    state.status = 'playing';
    state.board = this.makeBoard();
    state.players.forEach((p) => (p.square = 0));
    await this.repo.save(state);
    return state;
  }

  async leaveSession(
    code: string,
    playerId: string,
  ): Promise<SessionState | null> {
    const state = await this.repo.findByCode(code);
    if (!state) return null;
    state.players = state.players.filter((p) => p.id !== playerId);
    await this.repo.save(state);
    return state;
  }

  // Marca o jogador como desconectado, preservando-o no estado para reconexão (Sprint 2).
  async markDisconnected(
    code: string,
    playerId: string,
  ): Promise<SessionState | null> {
    const state = await this.repo.findByCode(code);
    if (!state) return null;
    const player = state.players.find((p) => p.id === playerId);
    if (player) player.connected = false;
    await this.repo.save(state);
    return state;
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
    const state = await this.repo.findByCode(code);
    if (!state) throw new GameError(ErrorCode.RECONNECT_FAILED);
    const player = state.players.find((p) => p.id === playerId);
    if (!player) throw new GameError(ErrorCode.RECONNECT_FAILED);
    player.connected = true;
    player.socketId = socketId;
    await this.repo.save(state);
    return state;
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
    const state = await this.repo.findByCode(code);
    if (!state) return { state: null, removed: false, sessionDeleted: false };
    const player = state.players.find((p) => p.id === playerId);
    // Reconectou no intervalo → nada a fazer.
    if (!player || player.connected) {
      return { state, removed: false, sessionDeleted: false };
    }
    const removedIdx = state.turnOrder.indexOf(playerId);
    state.players = state.players.filter((p) => p.id !== playerId);
    if (state.players.length === 0) {
      await this.repo.delete(code);
      return { state: null, removed: true, sessionDeleted: true };
    }
    // Remove também da ordem de turnos e reajusta currentTurnIndex para não
    // apontar para um jogador inexistente (evita turnChanged/rotação inconsistentes
    // numa partida em andamento).
    state.turnOrder = state.turnOrder.filter((id) => id !== playerId);
    if (state.turnOrder.length > 0) {
      // Se removemos alguém antes do índice atual, recua um para preservar o alvo.
      if (removedIdx !== -1 && removedIdx < state.currentTurnIndex) {
        state.currentTurnIndex -= 1;
      }
      // Mantém o índice dentro dos limites (wrap quando o removido era o último).
      state.currentTurnIndex %= state.turnOrder.length;
    }
    await this.repo.save(state);
    return { state, removed: true, sessionDeleted: false };
  }

  getState(code: string): Promise<SessionState | null> {
    return this.repo.findByCode(code);
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
    // Novo trim após o corte evita um nome terminado em espaço quando o limite
    // cai logo após um espaço interno.
    return sanitized.slice(0, MAX_NAME_LENGTH).trim();
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
