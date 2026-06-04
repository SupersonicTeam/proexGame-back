import { RandomSource } from '../common/random/random.source';
import { RankingEntry, Roll, SessionState } from '../session/session.types';

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
}

// Resolve o movimento de um jogador. Vitória é chega-ou-passa (toSquare >= N).
// A casa exibida é clampada em N para não estourar o índice do tabuleiro.
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
  return { fromSquare, toSquare, isWin };
}

export interface OrderResult {
  turnOrder: string[];
  rolls: Roll[]; // rolls da primeira rolagem (para emitir em orderResult)
}

// Resolve a ordem de turnos: ordena por maior valor; empates são desfeitos
// re-rolando recursivamente apenas entre os empatados (RF-04).
export function resolveOrder(playerIds: string[], rng: RandomSource): OrderResult {
  const rolls: Roll[] = playerIds.map((playerId) => ({
    playerId,
    value: rollDie(rng),
  }));
  const turnOrder = orderByRolls(rolls, rng);
  return { turnOrder, rolls };
}

// Ordena ids por valor desc; cada grupo empatado é re-rolado entre si.
function orderByRolls(rolls: Roll[], rng: RandomSource): string[] {
  // Agrupa ids por valor rolado.
  const byValue = new Map<number, string[]>();
  for (const { playerId, value } of rolls) {
    const group = byValue.get(value) ?? [];
    group.push(playerId);
    byValue.set(value, group);
  }
  // Valores distintos do maior para o menor.
  const values = [...byValue.keys()].sort((a, b) => b - a);
  const ordered: string[] = [];
  for (const value of values) {
    const group = byValue.get(value) as string[];
    if (group.length === 1) {
      ordered.push(group[0]);
    } else {
      // Desempate: re-rola só entre os empatados.
      ordered.push(...resolveOrder(group, rng).turnOrder);
    }
  }
  return ordered;
}

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
export function buildRanking(state: SessionState, winnerId: string): RankingEntry[] {
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
