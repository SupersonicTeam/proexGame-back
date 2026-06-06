import { ErrorCode, GameError } from '../common/errors/game-error';
import { Difficulty, Player, SessionState } from '../session/session.types';

// Payloads client → server (Sprint 1).
export interface CreateSessionDto {
  name: string;
  difficulty: Difficulty;
}

export interface JoinSessionDto {
  code: string;
  name: string;
}

// Payloads client → server (Sprint 2).
export interface SubmitAnswerDto {
  questionId: string;
  optionIndex: number;
}

export interface ReconnectDto {
  code: string;
  playerId: string;
}

// Dados guardados no socket para identificar o jogador na desconexão.
export interface SocketData {
  code?: string;
  playerId?: string;
}

// Validação estrita do payload de submitAnswer (segurança: nunca confiar no
// client). Garante tipos; os limites semânticos (questionId casado, índice
// dentro das opções) são validados de forma autoritativa no GameService.
export function parseSubmitAnswer(body: unknown): SubmitAnswerDto {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.questionId !== 'string' || b.questionId.trim() === '') {
    throw new GameError(ErrorCode.QUESTION_MISMATCH);
  }
  if (typeof b.optionIndex !== 'number' || !Number.isInteger(b.optionIndex)) {
    throw new GameError(ErrorCode.INVALID_OPTION);
  }
  return { questionId: b.questionId, optionIndex: b.optionIndex };
}

// Validação estrita do payload de reconnect. `code` precisa ser 5 dígitos e
// `playerId` uma string não-vazia (o UUID é o portador da identidade).
export function parseReconnect(body: unknown): ReconnectDto {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.code !== 'string' || !/^\d{5}$/.test(b.code)) {
    throw new GameError(ErrorCode.RECONNECT_FAILED);
  }
  if (typeof b.playerId !== 'string' || b.playerId.trim() === '') {
    throw new GameError(ErrorCode.RECONNECT_FAILED);
  }
  return { code: b.code, playerId: b.playerId };
}

// Visão pública de um jogador no contrato WS — NUNCA expõe `socketId`
// nem outros campos internos do estado.
export function toPlayerView(player: Player) {
  return {
    id: player.id,
    name: player.name,
    connected: player.connected,
    isHost: player.isHost,
  };
}

// Projeção do estado para o lobby (não vaza socketId nem dados internos).
export function toLobbyState(state: SessionState) {
  const host = state.players.find((p) => p.isHost);
  return {
    code: state.code,
    status: state.status,
    hostId: host?.id ?? null,
    players: state.players.map(toPlayerView),
  };
}
