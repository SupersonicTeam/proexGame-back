import { buildRanking } from '../game/game.rules';
import { playersToRoll } from '../game/ordering.rules';
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
// client). Erro de TRANSPORTE (tipos/formato) → INVALID_PAYLOAD; os limites
// semânticos (questionId casado, índice dentro das opções) são validados de
// forma autoritativa no GameService com os códigos de regra de jogo.
export function parseSubmitAnswer(body: unknown): SubmitAnswerDto {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.questionId !== 'string' || b.questionId.trim() === '') {
    throw new GameError(ErrorCode.INVALID_PAYLOAD);
  }
  if (typeof b.optionIndex !== 'number' || !Number.isInteger(b.optionIndex)) {
    throw new GameError(ErrorCode.INVALID_PAYLOAD);
  }
  return { questionId: b.questionId, optionIndex: b.optionIndex };
}

// Validação estrita do payload de reconnect. Erro de TRANSPORTE (code não-5-
// dígitos, playerId vazio) → INVALID_PAYLOAD. A falha de RECONEXÃO em si
// (sessão/jogador inexistente) é decidida no SessionService (RECONNECT_FAILED),
// sem vazar qual dos dois faltou.
export function parseReconnect(body: unknown): ReconnectDto {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.code !== 'string' || !/^\d{5}$/.test(b.code)) {
    throw new GameError(ErrorCode.INVALID_PAYLOAD);
  }
  if (typeof b.playerId !== 'string' || b.playerId.trim() === '') {
    throw new GameError(ErrorCode.INVALID_PAYLOAD);
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
    square: player.square,
  };
}

// Snapshot completo de partida para (re)render do frontend. Não vaza socketId,
// pendingQuestion, correctIndex, servedQuestionIds nem usedQuestionIds (RF-16).
export function toGameState(state: SessionState) {
  const currentTurnPlayerId =
    state.status === 'playing'
      ? (state.turnOrder[state.currentTurnIndex] ?? null)
      : null;
  const ranking =
    state.status === 'finished' && state.winner
      ? buildRanking(state, state.winner)
      : null;
  // Projeção da fase de ordem (RF-04) — presente só em status 'ordering'. Expõe
  // a rodada atual, quem ainda precisa rolar e quem já rolou (valores não são
  // segredo: também vão no evento orderRoll). Permite ao front renderizar a
  // tela de ordem após um refresh/reconexão.
  const ordering =
    state.status === 'ordering' && state.ordering
      ? {
          round: state.ordering.round,
          playersToRoll: playersToRoll(state.ordering),
          rolled: Object.keys(state.ordering.currentRolls),
        }
      : null;
  return {
    code: state.code,
    status: state.status,
    difficulty: state.difficulty,
    board: state.board,
    players: state.players.map(toPlayerView),
    currentTurnPlayerId,
    ordering,
    winner: state.winner,
    ranking,
  };
}

// Projeção do estado para o lobby (não vaza socketId nem dados internos).
export function toLobbyState(state: SessionState) {
  const host = state.players.find((p) => p.isHost);
  return {
    code: state.code,
    status: state.status,
    difficulty: state.difficulty,
    hostId: host?.id ?? null,
    players: state.players.map(toPlayerView),
  };
}
