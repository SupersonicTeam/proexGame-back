import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { resolveCorsOrigin } from '../common/config/cors';
import { ErrorCode, GameError } from '../common/errors/game-error';
import { GameService, OrderRollOutcome } from '../game/game.service';
import { playersToRoll } from '../game/ordering.rules';
import { ReconnectService } from '../session/reconnect.service';
import { SessionService } from '../session/session.service';
import { SessionState } from '../session/session.types';
import {
  CreateSessionDto,
  JoinSessionDto,
  parseReconnect,
  parseSubmitAnswer,
  SocketData,
  toGameState,
  toLobbyState,
  toPlayerView,
} from './gateway.dto';

// Única camada que toca sockets. Traduz eventos client→server em chamadas de
// serviço e emite os resultados para a sala (= código da sessão). Toda a
// lógica autoritativa vive nos serviços; o gateway não decide nada do jogo.
@WebSocketGateway({ cors: { origin: resolveCorsOrigin() } })
export class GameGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly sessions: SessionService,
    private readonly games: GameService,
    private readonly reconnects: ReconnectService,
  ) {}

  @SubscribeMessage('createSession')
  async handleCreateSession(
    @MessageBody() body: CreateSessionDto,
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const { state, playerId } = await this.sessions.createSession(
        body?.name,
        body?.difficulty ?? 'normal',
        client.id,
      );
      this.bindSocket(client, state.code, playerId);
      client.emit('sessionCreated', { code: state.code, playerId });
      this.server.to(state.code).emit('lobbyState', toLobbyState(state));
      return { code: state.code, playerId };
    } catch (err) {
      return this.emitError(client, err);
    }
  }

  @SubscribeMessage('joinSession')
  async handleJoinSession(
    @MessageBody() body: JoinSessionDto,
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const { state, playerId } = await this.sessions.joinSession(
        body?.code,
        body?.name,
        client.id,
      );
      this.bindSocket(client, state.code, playerId);
      const player = state.players.find((p) => p.id === playerId);
      this.server
        .to(state.code)
        .emit('playerJoined', { player: player ? toPlayerView(player) : null });
      this.server.to(state.code).emit('lobbyState', toLobbyState(state));
      return { code: state.code, playerId };
    } catch (err) {
      return this.emitError(client, err);
    }
  }

  @SubscribeMessage('startGame')
  async handleStartGame(@ConnectedSocket() client: Socket) {
    const { code, playerId } = this.dataOf(client);
    try {
      if (!code || !playerId) throw new GameError(ErrorCode.NOT_IN_SESSION);
      // Valida host/≥2 jogadores e entra na fase de ordem (status 'ordering').
      await this.sessions.startGame(code, playerId);
      // Gera o tabuleiro procedural (RF-06/07/17/18) e emite com gameStarted.
      const withBoard = await this.games.setupBoard(code);
      this.server.to(code).emit('gameStarted', { board: withBoard.board });
      // Inicia a fase interativa de ordem (RF-04): cada jogador rolará o d6.
      await this.beginOrderingAndDrain(code);
    } catch (err) {
      this.emitError(client, err);
    }
  }

  // Entra na fase de ordem (RF-04): emite gameState('ordering') + orderPhase e,
  // em seguida, DRENA jogadores que já estão desconectados no início (ex.: caíram
  // no lobby antes do startGame, ou um restante após leaveSession/expiração). Sem
  // isso a fase travaria esperando uma rolagem que nunca viria, pois o auto-roll
  // por desconectado só roda no evento de disconnect.
  private async beginOrderingAndDrain(code: string): Promise<void> {
    const { state, playersToRoll: toRoll } =
      await this.games.beginOrdering(code);
    this.server.to(code).emit('gameState', toGameState(state));
    this.server
      .to(code)
      .emit('orderPhase', { round: 1, playersToRoll: toRoll });
    const outcomes = await this.games.autoRollPendingDisconnected(code);
    for (const out of outcomes) this.emitOrderOutcome(code, out);
  }

  // Fase de ordem (RF-04): o jogador rola o d6. O servidor é a autoridade da
  // rolagem; ao completar a rodada, ou inicia a partida (orderResult) ou abre
  // nova rodada de desempate só entre os empatados (orderPhase).
  @SubscribeMessage('rollForOrder')
  async handleRollForOrder(@ConnectedSocket() client: Socket) {
    const { code, playerId } = this.dataOf(client);
    try {
      if (!code || !playerId) throw new GameError(ErrorCode.NOT_IN_SESSION);
      const outcome = await this.games.rollForOrder(code, playerId);
      this.emitOrderOutcome(code, outcome);
    } catch (err) {
      this.emitError(client, err);
    }
  }

  @SubscribeMessage('rollDice')
  async handleRollDice(@ConnectedSocket() client: Socket) {
    const { code, playerId } = this.dataOf(client);
    try {
      if (!code || !playerId) throw new GameError(ErrorCode.NOT_IN_SESSION);
      const out = await this.games.applyDiceRoll(code, playerId);
      this.server.to(code).emit('diceResult', {
        playerId: out.playerId,
        value: out.value,
        fromSquare: out.fromSquare,
        toSquare: out.toSquare,
      });
      if (out.isWin) {
        this.server
          .to(code)
          .emit('gameOver', { winner: out.playerId, ranking: out.ranking });
      } else if (out.prompt) {
        // Aterrissou em casa-pergunta: o prompt vai só ao jogador (turno não passa).
        client.emit('questionPrompt', out.prompt);
      } else {
        await this.advanceTurn(code, out.nextPlayerId);
      }
    } catch (err) {
      this.emitError(client, err);
    }
  }

  @SubscribeMessage('submitAnswer')
  async handleSubmitAnswer(
    @MessageBody() body: unknown,
    @ConnectedSocket() client: Socket,
  ) {
    const { code, playerId } = this.dataOf(client);
    try {
      if (!code || !playerId) throw new GameError(ErrorCode.NOT_IN_SESSION);
      const dto = parseSubmitAnswer(body);
      const out = await this.games.submitAnswer(
        code,
        playerId,
        dto.questionId,
        dto.optionIndex,
      );
      // Resultado do movimento vai para a sala (anima tabuleiro) SEM a correta —
      // adversários não devem saber qual era a alternativa correta da pergunta alheia.
      const answerBroadcast = {
        playerId: out.playerId,
        correct: out.correct,
        errorType: out.errorType,
        movement: out.movement,
        fromSquare: out.fromSquare,
        toSquare: out.toSquare,
      };
      // Todos menos o autor: sem correctIndex.
      client.broadcast.to(code).emit('answerResult', answerBroadcast);
      // Só o autor: inclui correctIndex (RF-16-safe — revelado APÓS a submissão,
      // exclusivamente para a tela de resultado educativa de quem respondeu).
      client.emit('answerResult', {
        ...answerBroadcast,
        correctIndex: out.correctIndex,
      });
      if (out.isWin) {
        this.server
          .to(code)
          .emit('gameOver', { winner: out.playerId, ranking: out.ranking });
      } else if (out.prompt) {
        // Encadeamento (RF-11): nova pergunta ao mesmo jogador, turno não passa.
        client.emit('questionPrompt', out.prompt);
      } else {
        await this.advanceTurn(code, out.nextPlayerId);
      }
    } catch (err) {
      this.emitError(client, err);
    }
  }

  @SubscribeMessage('reconnect')
  async handleReconnect(
    @MessageBody() body: unknown,
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const dto = parseReconnect(body);
      const state = await this.sessions.reconnect(
        dto.code,
        dto.playerId,
        client.id,
      );
      this.reconnects.cancel(dto.code, dto.playerId); // cancela o grace
      this.bindSocket(client, dto.code, dto.playerId);
      this.server
        .to(dto.code)
        .emit('playerReconnected', { playerId: dto.playerId });
      // Reenvia o estado atual; se a partida está em andamento, informa o turno.
      this.server.to(dto.code).emit('lobbyState', toLobbyState(state));
      if (state.status === 'playing') {
        client.emit('turnChanged', {
          playerId: state.turnOrder[state.currentTurnIndex],
        });
      } else if (state.status === 'ordering' && state.ordering) {
        // Reconectou durante a fase de ordem (RF-04): reenvia quem deve rolar.
        client.emit('orderPhase', {
          round: state.ordering.round,
          playersToRoll: playersToRoll(state.ordering),
        });
      }
      // Snapshot completo para o reconectado renderizar tabuleiro e posições (RF-14).
      client.emit('gameState', toGameState(state));
      return { code: dto.code, playerId: dto.playerId };
    } catch (err) {
      return this.emitError(client, err);
    }
  }

  // Resync sob demanda (L3/RF-14): cliente sem estado (ex.: após refresh) pede
  // o snapshot completo. Emite gameState só ao remetente; sem payload obrigatório.
  @SubscribeMessage('requestState')
  async handleRequestState(@ConnectedSocket() client: Socket) {
    const { code, playerId } = this.dataOf(client);
    try {
      if (!code || !playerId) throw new GameError(ErrorCode.NOT_IN_SESSION);
      const state = await this.sessions.getState(code);
      if (!state) throw new GameError(ErrorCode.NOT_IN_SESSION);
      // Valida membership: um socket cujo jogador já saiu/foi removido (sem limpar
      // socket.data, ex.: após leaveSession) não pode mais puxar o estado da sessão.
      if (!state.players.some((p) => p.id === playerId)) {
        throw new GameError(ErrorCode.NOT_IN_SESSION);
      }
      client.emit('gameState', toGameState(state));
    } catch (err) {
      this.emitError(client, err);
    }
  }

  @SubscribeMessage('leaveSession')
  async handleLeaveSession(@ConnectedSocket() client: Socket) {
    const { code, playerId } = this.dataOf(client);
    if (!code || !playerId) return;
    const state = await this.sessions.leaveSession(code, playerId);
    await client.leave(code);
    if (!state) return;
    // Saída durante a fase de ordem (RF-04): recupera a ordem com os restantes.
    if (state.status === 'ordering') {
      await this.recoverOrderingAfterRemoval(code, state);
      return;
    }
    this.server.to(code).emit('lobbyState', toLobbyState(state));
  }

  // Após um jogador sair (leaveSession) ou ser removido por expiração de grace
  // durante a fase de ordem (RF-04): reinicia a ordem só com os restantes (>=2,
  // o que também drena já-desconectados) ou volta ao lobby (<2). Evita tanto o
  // travamento quanto um turnOrder com ids que saíram da sessão.
  private async recoverOrderingAfterRemoval(
    code: string,
    state: SessionState,
  ): Promise<void> {
    if (state.players.length >= 2) {
      this.server.to(code).emit('lobbyState', toLobbyState(state));
      await this.beginOrderingAndDrain(code);
    } else {
      const lobby = await this.sessions.returnToLobby(code);
      if (lobby) {
        this.server.to(code).emit('lobbyState', toLobbyState(lobby));
      }
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const { code, playerId } = this.dataOf(client);
    if (!code || !playerId) return;
    const state = await this.sessions.markDisconnected(code, playerId);
    if (!state) return;
    this.server.to(code).emit('playerDisconnected', { playerId });
    // Se caiu durante a fase de ordem (RF-04), o servidor rola por ele para a
    // fase não travar esperando uma rolagem que nunca virá.
    if (state.status === 'ordering') {
      const outcomes = await this.games.autoRollPendingDisconnected(code);
      for (const out of outcomes) this.emitOrderOutcome(code, out);
    }
    // Se era a vez do jogador que caiu, passa o turno para não travar a partida.
    const passed = await this.games.passTurnIfDisconnected(code);
    if (passed) {
      await this.advanceTurn(code, passed.nextPlayerId);
    }
    // Arma o grace period de reconexão (RF-14). Na expiração, remove o jogador
    // e — se a sessão esvaziar — apaga e emite sessionClosed (RF-15).
    this.reconnects.arm(code, playerId, () =>
      this.handleGraceExpired(code, playerId),
    );
  }

  // Traduz o resultado de uma rolagem de ordem (RF-04) em eventos para a sala:
  // sempre `orderRoll`; ao finalizar, `orderResult` + `gameState` + `turnChanged`;
  // se restou empate, um novo `orderPhase` só com os empatados.
  private emitOrderOutcome(code: string, out: OrderRollOutcome): void {
    this.server.to(code).emit('orderRoll', {
      playerId: out.playerId,
      value: out.value,
      round: out.round,
    });
    if (out.finalize) {
      this.server.to(code).emit('orderResult', {
        rolls: out.finalize.rounds[0],
        rounds: out.finalize.rounds,
        turnOrder: out.finalize.turnOrder,
      });
      // Snapshot já em 'playing' (turnOrder preenchido) + quem começa.
      this.server.to(code).emit('gameState', toGameState(out.state));
      this.server
        .to(code)
        .emit('turnChanged', { playerId: out.finalize.firstPlayerId });
    } else if (out.nextRound) {
      this.server.to(code).emit('orderPhase', {
        round: out.nextRound.round,
        playersToRoll: out.nextRound.playersToRoll,
      });
    }
  }

  // Emite a troca de turno e drena presídios em sequência: enquanto o jogador da
  // vez tiver turnos a pular, emite turnSkipped e avança (RF-20).
  private async advanceTurn(
    code: string,
    nextPlayerId: string | null,
  ): Promise<void> {
    let current = nextPlayerId;
    if (!current) return;
    this.server.to(code).emit('turnChanged', { playerId: current });
    for (;;) {
      const skip = await this.games.startTurnSkipIfNeeded(code);
      if (!skip) break;
      this.server.to(code).emit('turnSkipped', {
        playerId: skip.playerId,
        remaining: skip.remaining,
      });
      current = skip.nextPlayerId;
      this.server.to(code).emit('turnChanged', { playerId: current });
    }
  }

  // Callback de expiração do grace: remove o jogador; se a sessão foi apagada,
  // emite sessionClosed, senão atualiza o lobby.
  private async handleGraceExpired(
    code: string,
    playerId: string,
  ): Promise<void> {
    const result = await this.sessions.expireDisconnectedPlayer(code, playerId);
    if (!result.removed) return;
    if (result.sessionDeleted) {
      this.server.to(code).emit('sessionClosed', { reason: 'inactivity' });
    } else if (result.state && result.state.status === 'ordering') {
      // Removido durante a fase de ordem (RF-04): recupera com os restantes para
      // não deixar a ordem presa a um id que não está mais na sessão.
      await this.recoverOrderingAfterRemoval(code, result.state);
    } else if (result.state) {
      this.server.to(code).emit('lobbyState', toLobbyState(result.state));
    }
  }

  private bindSocket(client: Socket, code: string, playerId: string): void {
    void client.join(code);
    (client.data as SocketData).code = code;
    (client.data as SocketData).playerId = playerId;
  }

  private dataOf(client: Socket): SocketData {
    return (client.data ?? {}) as SocketData;
  }

  private emitError(client: Socket, err: unknown): null {
    if (err instanceof GameError) {
      client.emit('error', { code: err.code, message: err.message });
    } else {
      client.emit('error', {
        code: ErrorCode.INTERNAL,
        message: 'Erro interno.',
      });
    }
    return null;
  }
}
