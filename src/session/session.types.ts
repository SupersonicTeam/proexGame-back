// Tipos de domínio da sessão de jogo (Sprint 1 — núcleo jogável).
// Campos de sprints futuras (usedQuestionIds, skipTurns) são omitidos aqui de propósito.

export type Difficulty = 'easy' | 'normal' | 'hard';

export type SessionStatus = 'lobby' | 'playing' | 'finished';

// Na Sprint 1 só existem 'start', 'finish' e o implícito 'normal'.
// 'question' e 'prison' entram nas Sprints 2/3.
export type TileType = 'start' | 'normal' | 'finish';

export interface Player {
  id: string;
  name: string;
  socketId: string;
  square: number; // 0 = início
  connected: boolean;
  isHost: boolean;
}

export interface Board {
  size: number; // N (FIXO na Sprint 1)
  // Mapeia apenas as casas especiais; demais são 'normal' por padrão.
  tileTypeBySquare: Record<number, TileType>;
}

export interface SessionState {
  code: string;
  status: SessionStatus;
  difficulty: Difficulty; // persistida, sem efeito de cálculo na Sprint 1
  board: Board;
  players: Player[];
  turnOrder: string[]; // playerId[]
  currentTurnIndex: number;
  winner: string | null; // playerId
  createdAt: string; // ISO
  lastActivityAt: string; // ISO
}

export interface Roll {
  playerId: string;
  value: number;
}

export interface RankingEntry {
  playerId: string;
  name: string;
  square: number;
  position: number; // 1 = vencedor
}

export interface DiceOutcome {
  state: SessionState;
  playerId: string;
  value: number;
  fromSquare: number;
  toSquare: number;
  isWin: boolean;
}

// Tamanho fixo do tabuleiro na Sprint 1 (procedural variável entra na Sprint 2).
export const BOARD_SIZE = 25;
