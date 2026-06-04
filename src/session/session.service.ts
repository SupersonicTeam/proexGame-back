import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ErrorCode, GameError } from '../common/errors/game-error';
import { RANDOM_SOURCE, RandomSource } from '../common/random/random.source';
import { generateUniqueCode } from './session.code';
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
    const code = await generateUniqueCode(this.repo, this.rng);
    const playerId = randomUUID();
    const now = new Date().toISOString();

    const state: SessionState = {
      code,
      status: 'lobby',
      difficulty,
      board: this.makeBoard(),
      players: [this.makePlayer(playerId, cleanName, socketId, true)],
      turnOrder: [],
      currentTurnIndex: 0,
      winner: null,
      createdAt: now,
      lastActivityAt: now,
    };
    await this.repo.create(state);
    return { state, playerId };
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

  getState(code: string): Promise<SessionState | null> {
    return this.repo.findByCode(code);
  }

  private async requireSession(code: string): Promise<SessionState> {
    const state = await this.repo.findByCode(code);
    if (!state) throw new GameError(ErrorCode.SESSION_NOT_FOUND);
    return state;
  }

  private validateName(name: string): string {
    const clean = (name ?? '').trim();
    if (clean.length === 0) throw new GameError(ErrorCode.INVALID_NAME);
    return clean;
  }

  private makePlayer(
    id: string,
    name: string,
    socketId: string,
    isHost: boolean,
  ): Player {
    return { id, name, socketId, square: 0, connected: true, isHost };
  }

  // Tabuleiro fixo da Sprint 1: casa 0 = início, casa N = chegada, demais 'normal'.
  private makeBoard(): Board {
    return {
      size: BOARD_SIZE,
      tileTypeBySquare: { 0: 'start', [BOARD_SIZE]: 'finish' },
    };
  }
}
