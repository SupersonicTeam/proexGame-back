import { RandomSource } from '../common/random/random.source';
import {
  Board,
  Difficulty,
  RankingEntry,
  SessionState,
  TileType,
} from '../session/session.types';

// ---------------------------------------------------------------------------
// Regras de jogo puras (sem I/O, sem Redis, sem sockets). Toda decisão
// determinística do núcleo da Sprint 1 vive aqui e é testável isoladamente.
// ---------------------------------------------------------------------------

// Rola um d6 justo a partir da fonte injetada.
export function rollDie(rng: RandomSource): number {
  return rng.rollD6();
}

// Avanço na Sprint 1 = casa atual + valor do dado.
// Ponto de extensão: a Sprint 3 substitui isto por C_d + T_p (tiers/dificuldade).
export function computeAdvance(fromSquare: number, diceValue: number): number {
  return fromSquare + diceValue;
}

export interface MovementResult {
  fromSquare: number;
  toSquare: number;
  isWin: boolean;
  // Tipo da casa de destino — usado pela aterrissagem (S2-07) para decidir
  // disparo de pergunta/presídio (RF-08/19).
  tileType: TileType;
}

// Tipo da casa em uma posição. Apenas casas especiais são marcadas no board;
// as demais são 'normal'. Posições ≤0 contam como início, ≥N como chegada.
export function tileTypeAt(board: Board, square: number): TileType {
  if (square <= 0) return 'start';
  if (square >= board.size) return 'finish';
  return board.tileTypeBySquare[square] ?? 'normal';
}

// Resolve o movimento por DADO. Vitória é chega-ou-passa (toSquare >= N).
// A casa exibida é clampada em N para não estourar o índice do tabuleiro.
// O dado é justo: NÃO há nudge aqui (o nudge é exclusivo do avanço de acerto).
export function resolveMovement(
  state: SessionState,
  playerId: string,
  diceValue: number,
): MovementResult {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) {
    throw new Error(`Jogador ${playerId} não encontrado na sessão`);
  }
  const fromSquare = player.square;
  const raw = computeAdvance(fromSquare, diceValue);
  const isWin = raw >= state.board.size;
  const toSquare = isWin ? state.board.size : raw;
  return {
    fromSquare,
    toSquare,
    isWin,
    tileType: tileTypeAt(state.board, toSquare),
  };
}

// A ordem de turnos (RF-04) agora é resolvida na fase interativa de ordenação —
// ver game/ordering.rules.ts (cada jogador rola; empates re-rolam entre si).

// Próximo índice de turno cujo jogador está conectado (circular).
// Se ninguém mais estiver conectado, mantém o índice atual (evita loop infinito).
export function nextConnectedTurnIndex(state: SessionState): number {
  const n = state.turnOrder.length;
  for (let step = 1; step <= n; step++) {
    const idx = (state.currentTurnIndex + step) % n;
    const playerId = state.turnOrder[idx];
    const player = state.players.find((p) => p.id === playerId);
    if (player?.connected) return idx;
  }
  return state.currentTurnIndex;
}

// Ranking final: vencedor em 1º; demais por casa (square) desc.
export function buildRanking(
  state: SessionState,
  winnerId: string,
): RankingEntry[] {
  const winner = state.players.find((p) => p.id === winnerId);
  const others = state.players
    .filter((p) => p.id !== winnerId)
    .sort((a, b) => b.square - a.square);

  const ordered = winner ? [winner, ...others] : others;
  return ordered.map((player, index) => ({
    playerId: player.id,
    name: player.name,
    square: player.square,
    position: index + 1,
  }));
}

// ---------------------------------------------------------------------------
// S2-04 — Tiers de balanceamento (RF-10/13, §4 do CLAUDE.md)
// ---------------------------------------------------------------------------

/**
 * Posição relativa do jogador no ranking de casas, recalculada a cada turno.
 *
 * Decisão de empate total (todos na mesma casa):
 *   → todos são tratados como 'leader' (tier mais favorável).
 *   Justificativa: o empate total é transitório; penalizar todos com 'last'
 *   congelaria o progresso coletivo sem diferenciar ninguém. 'leader' vence
 *   o empate por convenção documentada aqui.
 */
export type Tier = 'leader' | 'middle' | 'last';

/**
 * Determina o tier de um jogador com base nas casas (square) atuais.
 *
 * Regras:
 *  - leader: square === máximo de todos os jogadores.
 *  - last:   square === mínimo de todos os jogadores (e square < máximo).
 *  - middle: demais casos.
 *  - Em partida de 2 jogadores não existe middle — só leader e last.
 *  - Empate total (max === min) → leader para todos.
 */
export function computeTier(state: SessionState, playerId: string): Tier {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) {
    throw new Error(`Jogador ${playerId} não encontrado na sessão`);
  }

  const squares = state.players.map((p) => p.square);
  const maxSquare = Math.max(...squares);
  const minSquare = Math.min(...squares);

  // Empate total → todos leader (ver decisão acima).
  if (maxSquare === minSquare) return 'leader';

  if (player.square === maxSquare) return 'leader';
  if (player.square === minSquare) return 'last';
  return 'middle';
}

// Tabela §4 — avanço base por dificuldade (C_d).
const BASE_ADVANCE: Record<Difficulty, number> = {
  easy: 3,
  normal: 2,
  hard: 1,
};

// Tabela §4 — bônus de avanço por tier (T_p).
const TIER_BONUS: Record<Tier, number> = {
  leader: 0,
  middle: 1,
  last: 2,
};

/**
 * Casas a avançar após acerto = C_d + T_p (§4).
 *
 * | Dificuldade | leader | middle | last |
 * |-------------|--------|--------|------|
 * | easy        |   3    |   4    |  5   |
 * | normal      |   2    |   3    |  4   |
 * | hard        |   1    |   2    |  3   |
 */
export function advanceFor(difficulty: Difficulty, tier: Tier): number {
  return BASE_ADVANCE[difficulty] + TIER_BONUS[tier];
}

// Tabela §4 — recuo por tipo de erro: proximal (distrator próximo) e
// wrong/total (resposta totalmente errada).
const RECOIL: Record<Difficulty, Record<'proximal' | 'wrong', number>> = {
  //              proximal  wrong(total)
  easy: { proximal: 1, wrong: 2 },
  normal: { proximal: 2, wrong: 3 },
  hard: { proximal: 3, wrong: 4 },
};

/**
 * Casas a recuar após erro (§4).
 *
 * | Tipo     | easy | normal | hard |
 * |----------|------|--------|------|
 * | proximal |  1   |   2    |  3   |
 * | wrong    |  2   |   3    |  4   |
 */
export function recoilFor(
  difficulty: Difficulty,
  errorType: 'proximal' | 'wrong',
): number {
  return RECOIL[difficulty][errorType];
}

// ---------------------------------------------------------------------------
// S2-05 — Nudge anti-encadeamento e resolução de movimento de acerto/erro
// ---------------------------------------------------------------------------

// Probabilidade do nudge (§4): P = 0.7. Expressa via int(1,10) <= 7 para ser
// determinística sob RandomSource fake nos testes.
const NUDGE_NUMERATOR = 7;
const NUDGE_DENOMINATOR = 10;

// Uma casa é "não-especial" (alvo válido de nudge) se for 'normal'. Início e
// chegada não contam — o nudge só evita o caso visual de cair em pergunta/presídio.
function isNudgeTarget(board: Board, square: number): boolean {
  return tileTypeAt(board, square) === 'normal';
}

/**
 * Nudge anti-encadeamento (§4, RF-11). Se a casa-alvo de um avanço de acerto for
 * 'question' ou 'prison', com P=0.7 desloca para a casa não-especial mais próxima
 * em ±1, preferindo +1 (para não reduzir a recompensa); se +1 for inviável, tenta
 * −1; se ambos forem inviáveis, permanece. Reduz, mas não zera, o encadeamento.
 */
export function applyNudge(
  board: Board,
  target: number,
  rng: RandomSource,
): number {
  const type = tileTypeAt(board, target);
  if (type !== 'question' && type !== 'prison') return target;
  // Sorteio de P=0.7; só consome o rng quando a casa é de fato especial.
  if (rng.int(1, NUDGE_DENOMINATOR) > NUDGE_NUMERATOR) return target;
  if (isNudgeTarget(board, target + 1)) return target + 1;
  if (isNudgeTarget(board, target - 1)) return target - 1;
  return target;
}

/**
 * Movimento de ACERTO (§4, RF-10/11/13): avança C_d + T_p conforme tier e
 * dificuldade, aplica nudge anti-encadeamento e clampa. Vitória é chega-ou-passa.
 * Ordem: (1) target = square + advance; (2) nudge; (3) clamp (≥N → vitória).
 */
export function resolveCorrectMovement(
  state: SessionState,
  playerId: string,
  rng: RandomSource,
): MovementResult {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) {
    throw new Error(`Jogador ${playerId} não encontrado na sessão`);
  }
  const fromSquare = player.square;
  const tier = computeTier(state, playerId);
  const advance = advanceFor(state.difficulty, tier);
  const target = applyNudge(state.board, fromSquare + advance, rng);
  const isWin = target >= state.board.size;
  const toSquare = isWin ? state.board.size : target;
  return {
    fromSquare,
    toSquare,
    isWin,
    tileType: tileTypeAt(state.board, toSquare),
  };
}

/**
 * Movimento de ERRO (§4, RF-08/10): recua conforme tipo de erro e dificuldade,
 * com clamp inferior na casa 1. Recuo NUNCA dispara pergunta/presídio (RF-08/19)
 * — o serviço apenas reposiciona o jogador e passa o turno.
 */
export function resolveErrorMovement(
  state: SessionState,
  playerId: string,
  errorType: 'proximal' | 'wrong',
): MovementResult {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) {
    throw new Error(`Jogador ${playerId} não encontrado na sessão`);
  }
  const fromSquare = player.square;
  const recoil = recoilFor(state.difficulty, errorType);
  const toSquare = Math.max(1, fromSquare - recoil);
  return {
    fromSquare,
    toSquare,
    isWin: false,
    tileType: tileTypeAt(state.board, toSquare),
  };
}
