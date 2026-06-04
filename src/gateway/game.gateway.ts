import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ErrorCode, GameError } from '../common/errors/game-error';
import { GameService } from '../game/game.service';
import { SessionService } from '../session/session.service';
import {
  CreateSessionDto,
  JoinSessionDto,
  SocketData,
  toLobbyState,
} from './gateway.dto';

// Única camada que toca sockets. Traduz eventos client→server em chamadas de
// serviço e emite os resultados para a sala (= código da sessão). Toda a
// lógica autoritativa vive nos serviços; o gateway não decide nada do jogo.
@WebSocketGateway({ cors: { origin: true } })
export class GameGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly sessions: SessionService,
    private readonly games: GameService,
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
      this.server.to(state.code).emit('playerJoined', { player });
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
      const started = await this.sessions.startGame(code, playerId);
      this.server.to(code).emit('gameStarted', { board: started.board });

      const { state, rolls } = await this.games.resolveTurnOrder(code);
      this.server
        .to(code)
        .emit('orderResult', { rolls, turnOrder: state.turnOrder });
      this.server.to(code).emit('turnChanged', {
        playerId: state.turnOrder[state.currentTurnIndex],
      });
    } catch (err) {
      this.emitError(client, err);
    }
  }

  // Na Sprint 1 a ordem é resolvida automaticamente no startGame.
  // O evento existe no contrato para evolução futura; aqui é um no-op seguro.
  @SubscribeMessage('rollForOrder')
  handleRollForOrder() {
    return { ok: true };
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
      } else {
        this.server
          .to(code)
          .emit('turnChanged', { playerId: out.nextPlayerId });
      }
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
    if (state) {
      this.server.to(code).emit('lobbyState', toLobbyState(state));
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const { code, playerId } = this.dataOf(client);
    if (!code || !playerId) return;
    const state = await this.sessions.markDisconnected(code, playerId);
    if (!state) return;
    this.server.to(code).emit('playerDisconnected', { playerId });
    // Se era a vez do jogador que caiu, passa o turno para não travar a partida.
    const passed = await this.games.passTurnIfDisconnected(code);
    if (passed) {
      this.server
        .to(code)
        .emit('turnChanged', { playerId: passed.nextPlayerId });
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
      client.emit('error', { code: 'INTERNAL', message: 'Erro interno.' });
    }
    return null;
  }
}
