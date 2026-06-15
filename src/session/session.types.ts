// Tipos de domínio da sessão de jogo.
// Sprint 1: núcleo jogável. Sprint 2: perguntas, presídio, tabuleiro procedural,
// reconexão. Os campos da S2 (usedQuestionIds, skipTurns, pendingQuestion,
// subjectBySquare, servedQuestionIds) entram aqui como obrigatórios.

import { PendingQuestion, Subject } from '../questions/question.types';

export type Difficulty = 'easy' | 'normal' | 'hard';

// 'ordering' = fase interativa de definição da ordem de turnos (RF-04), entre o
// lobby e o jogo: os jogadores rolam o d6 para decidir quem começa.
export type SessionStatus = 'lobby' | 'ordering' | 'playing' | 'finished';

// Estado da fase de ordenação interativa (RF-04). Ver game/ordering.rules.ts.
// `groups` é uma partição ORDENADA: grupos com >1 jogador ainda estão empatados
// e precisam rolar; resolvido quando todos têm tamanho 1.
export interface OrderingState {
  groups: string[][];
  currentRolls: Record<string, number>; // rolagens da rodada atual (playerId → valor)
  round: number; // rodada atual (1-based)
  history: Roll[][]; // rolagens das rodadas concluídas (para orderResult)
}

// Tipos de casa, mutuamente exclusivos (RF-17). 'start' = casa 0, 'finish' = casa N.
// 'question' e 'prison' entram na Sprint 2.
export type TileType = 'start' | 'normal' | 'question' | 'prison' | 'finish';

export interface Player {
  id: string;
  name: string;
  socketId: string;
  square: number; // 0 = início
  connected: boolean;
  isHost: boolean;
  // --- Sprint 2 ---
  // Perguntas já servidas a ESTE jogador (auditoria). A checagem de não-repetição
  // efetiva é global na sessão (servedQuestionIds) — ver decisão D3.
  usedQuestionIds: string[];
  // Turnos a pular por efeito de presídio (RF-20).
  skipTurns: number;
  // Pergunta pendente de resposta (estado autoritativo do servidor). null quando
  // não há pergunta aberta para o jogador.
  pendingQuestion: PendingQuestion | null;
}

export interface Board {
  size: number; // N — sorteado em [20,30] na Sprint 2 (procedural)
  // Mapeia apenas as casas especiais; demais são 'normal' por padrão.
  tileTypeBySquare: Record<number, TileType>;
  // Matéria de cada casa-pergunta (só chaves de casas 'question').
  subjectBySquare: Record<number, Subject>;
}

export interface SessionState {
  code: string;
  status: SessionStatus;
  difficulty: Difficulty;
  board: Board;
  players: Player[];
  turnOrder: string[]; // playerId[]
  currentTurnIndex: number;
  winner: string | null; // playerId
  createdAt: string; // ISO
  lastActivityAt: string; // ISO
  // --- Sprint 2 ---
  // União global das perguntas servidas na sessão (não-repetição global — D3 / RF-09).
  servedQuestionIds: string[];
  // --- Sprint 4 ---
  // Estado da fase de ordenação interativa (RF-04); null fora dessa fase.
  ordering: OrderingState | null;
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

// @deprecated Sprint 1 usava tamanho fixo. Na Sprint 2 o tamanho é sorteado em
// [20,30] por board.rules.generateBoard. Mantido como fallback temporário até a
// geração procedural ser ligada no fluxo de início (S2-07).
export const BOARD_SIZE = 25;
