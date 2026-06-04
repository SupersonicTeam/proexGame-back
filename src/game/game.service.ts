import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode, GameError } from '../common/errors/game-error';
import { RANDOM_SOURCE, RandomSource } from '../common/random/random.source';
import { SessionRepository } from '../session/session.repository';
import { RankingEntry, Roll, SessionState } from '../session/session.types';
import {
  buildRanking,
  nextConnectedTurnIndex,
  resolveMovement,
  resolveOrder,
  rollDie,
} from './game.rules';

export interface TurnOrderResult {
  state: SessionState;
  rolls: Roll[];
}

export interface ApplyDiceResult {
  state: SessionState;
  playerId: string;
  value: number;
  fromSquare: number;
  toSquare: number;
  isWin: boolean;
  nextPlayerId: string | null; // próximo a jogar (null quando há vitória)
  ranking: RankingEntry[] | null; // preenchido apenas na vitória
}

// Orquestra as regras puras (game.rules) com a persistência para os eventos
// de jogo. Toda decisão aleatória vem do servidor (RF-16).
@Injectable()
export class GameService {
  constructor(
    private readonly repo: SessionRepository,
    @Inject(RANDOM_SOURCE) private readonly rng: RandomSource,
  ) {}

  // Resolve a ordem de turnos (RF-04) e posiciona o índice no primeiro jogador.
  async resolveTurnOrder(code: string): Promise<TurnOrderResult> {
    const state = await this.requireSession(code);
    const { turnOrder, rolls } = resolveOrder(
      state.players.map((p) => p.id),
      this.rng,
    );
    state.turnOrder = turnOrder;
    state.currentTurnIndex = 0;
    await this.repo.save(state);
    return { state, rolls };
  }

  // Aplica a rolagem do jogador da vez: move, detecta vitória ou passa o turno.
  async applyDiceRoll(
    code: string,
    playerId: string,
  ): Promise<ApplyDiceResult> {
    const state = await this.requireSession(code);
    if (state.status !== 'playing') {
      throw new GameError(ErrorCode.GAME_NOT_ACTIVE);
    }
    const currentPlayerId = state.turnOrder[state.currentTurnIndex];
    if (currentPlayerId !== playerId) {
      throw new GameError(ErrorCode.NOT_YOUR_TURN);
    }

    const value = rollDie(this.rng);
    const { fromSquare, toSquare, isWin } = resolveMovement(
      state,
      playerId,
      value,
    );

    const player = state.players.find((p) => p.id === playerId)!;
    player.square = toSquare;

    if (isWin) {
      state.status = 'finished';
      state.winner = playerId;
      const ranking = buildRanking(state, playerId);
      await this.repo.save(state);
      return {
        state,
        playerId,
        value,
        fromSquare,
        toSquare,
        isWin: true,
        nextPlayerId: null,
        ranking,
      };
    }

    state.currentTurnIndex = nextConnectedTurnIndex(state);
    await this.repo.save(state);
    return {
      state,
      playerId,
      value,
      fromSquare,
      toSquare,
      isWin: false,
      nextPlayerId: state.turnOrder[state.currentTurnIndex],
      ranking: null,
    };
  }

  // Se o jogador da vez está desconectado, passa o turno para o próximo
  // conectado (evita partida travada — S1-10). Retorna null se nada a fazer.
  async passTurnIfDisconnected(
    code: string,
  ): Promise<{ state: SessionState; nextPlayerId: string } | null> {
    const state = await this.repo.findByCode(code);
    if (!state || state.status !== 'playing') return null;
    const currentId = state.turnOrder[state.currentTurnIndex];
    const current = state.players.find((p) => p.id === currentId);
    if (current?.connected) return null; // ainda é a vez de alguém conectado
    state.currentTurnIndex = nextConnectedTurnIndex(state);
    await this.repo.save(state);
    return { state, nextPlayerId: state.turnOrder[state.currentTurnIndex] };
  }

  private async requireSession(code: string): Promise<SessionState> {
    const state = await this.repo.findByCode(code);
    if (!state) throw new GameError(ErrorCode.SESSION_NOT_FOUND);
    return state;
  }
}
