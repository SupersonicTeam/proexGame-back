// Geração procedural do tabuleiro (S2-03 / RF-06/07/17/18).
// Funções puras: sem I/O, sem Redis, sem sockets.
// Toda aleatoriedade vem do RandomSource recebido como argumento.

import { RandomSource } from '../common/random/random.source';
import { Board, Difficulty, TileType } from '../session/session.types';
import { Subject } from '../questions/question.types';

// ---------------------------------------------------------------------------
// Constantes exportadas
// ---------------------------------------------------------------------------

/** Densidade de casas-pergunta sobre o pool livre (não-terminal, sem presídios). */
export const DENSITY: Record<Difficulty, number> = {
  easy: 0.4,
  normal: 0.6,
  hard: 0.8,
};

/**
 * Faixa de tamanho N do tabuleiro por dificuldade (RF-NEW-01). O difícil tem
 * tabuleiros maiores (mais casas, partida mais longa); o fácil, menores.
 * As faixas podem se sobrepor (normal/hard) — é intencional.
 */
export const BOARD_SIZE_RANGE: Record<
  Difficulty,
  { min: number; max: number }
> = {
  easy: { min: 30, max: 45 },
  normal: { min: 60, max: 70 },
  hard: { min: 65, max: 85 },
};

// ---------------------------------------------------------------------------
// Funções auxiliares exportadas
// ---------------------------------------------------------------------------

/**
 * Quantidade de presídios em função do tamanho N do tabuleiro (RF-NEW-02).
 * Escala ~1 presídio a cada 25 casas, com mínimo de 1. Com as faixas atuais:
 * fácil [30,45]→1-2, normal [60,70]→2-3, difícil [65,85]→3.
 * O divisor 25 é um knob de balanceamento.
 */
export function prisonCount(n: number): number {
  return Math.max(1, Math.round(n / 25));
}

// ---------------------------------------------------------------------------
// Algoritmo de amostragem sem reposição (partial Fisher-Yates)
// ---------------------------------------------------------------------------

/**
 * Sorteia `count` elementos distintos do array `pool` sem repetição.
 * Utiliza partial Fisher-Yates: para cada posição i de 0 a count-1,
 * escolhe um índice aleatório j em [i, pool.length-1] e troca pool[i]
 * com pool[j]. O custo é O(count) chamadas ao rng.
 *
 * O array `pool` recebido NÃO é mutado: trabalha-se sobre uma cópia interna.
 */
function sampleWithoutReplacement(
  pool: number[],
  count: number,
  rng: RandomSource,
): number[] {
  // Copia o pool para não mutar o caller.
  const arr = [...pool];
  const result: number[] = [];
  for (let i = 0; i < count; i++) {
    // Escolhe índice no intervalo [i, arr.length - 1].
    const j = i + rng.int(0, arr.length - 1 - i);
    // Troca arr[i] ↔ arr[j].
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
    result.push(arr[i]);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Função principal
// ---------------------------------------------------------------------------

/**
 * Gera um tabuleiro procedural com as seguintes etapas (ordem obrigatória):
 * 1. Sorteia N na faixa da dificuldade (BOARD_SIZE_RANGE).
 * 2. Reserva casa 0 (start) e casa N (finish).
 * 3. Aloca `prisonCount(N)` presídios distintos em [1, N-1].
 * 4. Aloca casas-pergunta com densidade DENSITY[difficulty] sobre o pool
 *    restante (casas não-terminais excluindo presídios).
 * 5. Atribui uma subject (via rng) a cada casa-pergunta.
 *
 * Casas não marcadas são implicitamente 'normal' e NÃO aparecem em
 * tileTypeBySquare (consistente com o padrão da Sprint 1).
 */
export function generateBoard(
  difficulty: Difficulty,
  subjects: Subject[],
  rng: RandomSource,
): Board {
  // 1. Sorteia N na faixa da dificuldade.
  const range = BOARD_SIZE_RANGE[difficulty];
  const n = rng.int(range.min, range.max);

  // 2. Casas terminais.
  const tileTypeBySquare: Record<number, TileType> = {
    0: 'start',
    [n]: 'finish',
  };
  const subjectBySquare: Record<number, Subject> = {};

  // Pool de casas não-terminais: [1, N-1].
  const nonTerminalPool: number[] = [];
  for (let i = 1; i <= n - 1; i++) {
    nonTerminalPool.push(i);
  }

  // 3. Presídios.
  const prisonQty = prisonCount(n);
  const prisonSquares = sampleWithoutReplacement(
    nonTerminalPool,
    prisonQty,
    rng,
  );
  for (const sq of prisonSquares) {
    tileTypeBySquare[sq] = 'prison';
  }

  // Pool livre após remover presídios.
  const prisonSet = new Set(prisonSquares);
  const freePool = nonTerminalPool.filter((sq) => !prisonSet.has(sq));

  // 4. Casas-pergunta.
  const questionQty = Math.round(DENSITY[difficulty] * freePool.length);
  const questionSquares = sampleWithoutReplacement(freePool, questionQty, rng);
  for (const sq of questionSquares) {
    tileTypeBySquare[sq] = 'question';
  }

  // 5. Atribui subjects às casas-pergunta.
  for (const sq of questionSquares) {
    const idx = rng.int(0, subjects.length - 1);
    subjectBySquare[sq] = subjects[idx];
  }

  return {
    size: n,
    tileTypeBySquare,
    subjectBySquare,
  };
}
