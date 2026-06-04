// Testes de geração procedural do tabuleiro (S2-03 / RF-06/07/17/18).
// Padrão: FakeRandomSource determinística que consome uma fila via int().
// Escrito ANTES da implementação (TDD).

import { RandomSource } from '../common/random/random.source';
import { Board, Difficulty } from '../session/session.types';
import { DENSITY, generateBoard, prisonCount } from './board.rules';

// ---------------------------------------------------------------------------
// Fonte fake determinística — mesma abordagem de game.rules.spec.ts
// ---------------------------------------------------------------------------
class FakeRandomSource implements RandomSource {
  private queue: number[];

  constructor(values: number[]) {
    this.queue = [...values];
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  int(_min: number, _max: number): number {
    if (this.queue.length === 0) throw new Error('FakeRandomSource esgotada');
    return this.queue.shift() as number;
  }

  rollD6(): number {
    return this.int(1, 6);
  }
}

// ---------------------------------------------------------------------------
// Helpers de inspeção
// ---------------------------------------------------------------------------

/** Conta casas de um tipo específico no tabuleiro. */
function countTileType(board: Board, type: string): number {
  return Object.values(board.tileTypeBySquare).filter((t) => t === type).length;
}

/** Retorna os índices de casas de um tipo específico. */
function squaresOfType(board: Board, type: string): number[] {
  return Object.entries(board.tileTypeBySquare)
    .filter(([, t]) => t === type)
    .map(([k]) => Number(k));
}

// ---------------------------------------------------------------------------
// Testes de prisonCount
// ---------------------------------------------------------------------------

describe('prisonCount', () => {
  it('retorna 1 para N = 20', () => {
    expect(prisonCount(20)).toBe(1);
  });

  it('retorna 1 para N = 24', () => {
    expect(prisonCount(24)).toBe(1);
  });

  it('retorna 2 para N = 25', () => {
    expect(prisonCount(25)).toBe(2);
  });

  it('retorna 2 para N = 30', () => {
    expect(prisonCount(30)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Testes de DENSITY
// ---------------------------------------------------------------------------

describe('DENSITY', () => {
  it('define 0.4 para easy', () => {
    expect(DENSITY['easy']).toBe(0.4);
  });

  it('define 0.6 para normal', () => {
    expect(DENSITY['normal']).toBe(0.6);
  });

  it('define 0.8 para hard', () => {
    expect(DENSITY['hard']).toBe(0.8);
  });
});

// ---------------------------------------------------------------------------
// Geração de N
// ---------------------------------------------------------------------------

describe('generateBoard — tamanho N', () => {
  // A primeira chamada ao rng é int(20,30) para sortear N.
  // Para gerar o tabuleiro completo, precisamos de mais valores —
  // fornecemos um buffer longo para não esgotar o fake.

  it('usa o valor do rng para definir o tamanho (N=20)', () => {
    // N=20 → prisonCount=1 → pools restantes pequenos
    // Sequência: [20, ...sorteios de presídios e perguntas]
    // N=20: pool [1..19]=19 casas. prisonCount=1 → 1 sorteio de presídio.
    // Perguntas: round(0.4*(19-1))=round(7.2)=7 → 7 sorteios de casas + 7 de subject.
    // Fornecemos valores suficientes preenchendo com 0s ao final.
    const rng = new FakeRandomSource([
      20, // N
      0, // índice do presídio no pool [1..19] (casa 1)
      0,
      0,
      0,
      0,
      0,
      0,
      0, // 7 índices de casas-pergunta
      0,
      0,
      0,
      0,
      0,
      0,
      0, // 7 índices de subject
    ]);
    const board = generateBoard('easy', ['mat'], rng);
    expect(board.size).toBe(20);
  });

  it('usa o valor do rng para definir o tamanho (N=30)', () => {
    // N=30 → prisonCount=2 → mais sorteios
    const rng = new FakeRandomSource([
      30, // N
      0,
      0, // 2 índices de presídio
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0, // índices de casas-pergunta (sobra)
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0, // índices de subject (sobra)
    ]);
    const board = generateBoard('easy', ['mat'], rng);
    expect(board.size).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// Reserva de casas terminais (casa 0 = start, casa N = finish)
// ---------------------------------------------------------------------------

describe('generateBoard — casas terminais', () => {
  // Fixture padrão: força N=25 e fornece buffer de zeros para os demais sorteios.
  function makeBoardN25(difficulty: Difficulty = 'easy'): Board {
    const rng = new FakeRandomSource([
      25, // N
      ...Array(50).fill(0), // buffer para presídios, perguntas e subjects
    ]);
    return generateBoard(difficulty, ['mat', 'por'], rng);
  }

  it('casa 0 é sempre start', () => {
    const board = makeBoardN25();
    expect(board.tileTypeBySquare[0]).toBe('start');
  });

  it('casa N é sempre finish', () => {
    const board = makeBoardN25();
    expect(board.tileTypeBySquare[board.size]).toBe('finish');
  });

  it('não há presídio na casa 0 nem na casa N', () => {
    const board = makeBoardN25();
    const prisons = squaresOfType(board, 'prison');
    expect(prisons).not.toContain(0);
    expect(prisons).not.toContain(board.size);
  });

  it('não há question na casa 0 nem na casa N', () => {
    const board = makeBoardN25();
    const questions = squaresOfType(board, 'question');
    expect(questions).not.toContain(0);
    expect(questions).not.toContain(board.size);
  });
});

// ---------------------------------------------------------------------------
// Contagem de presídios
// ---------------------------------------------------------------------------

describe('generateBoard — presídios', () => {
  it('gera 1 presídio para N=20 (limite inferior N<=24)', () => {
    const rng = new FakeRandomSource([20, ...Array(50).fill(0)]);
    const board = generateBoard('easy', ['mat'], rng);
    expect(countTileType(board, 'prison')).toBe(1);
  });

  it('gera 1 presídio para N=24 (limite superior N<=24)', () => {
    const rng = new FakeRandomSource([24, ...Array(50).fill(0)]);
    const board = generateBoard('easy', ['mat'], rng);
    expect(countTileType(board, 'prison')).toBe(1);
  });

  it('gera 2 presídios para N=25 (limite inferior N>=25)', () => {
    const rng = new FakeRandomSource([25, ...Array(50).fill(0)]);
    const board = generateBoard('easy', ['mat'], rng);
    expect(countTileType(board, 'prison')).toBe(2);
  });

  it('gera 2 presídios para N=30 (limite superior N>=25)', () => {
    const rng = new FakeRandomSource([30, ...Array(50).fill(0)]);
    const board = generateBoard('easy', ['mat'], rng);
    expect(countTileType(board, 'prison')).toBe(2);
  });

  it('presídios ficam apenas em [1, N-1]', () => {
    const rng = new FakeRandomSource([25, ...Array(50).fill(0)]);
    const board = generateBoard('easy', ['mat'], rng);
    const prisons = squaresOfType(board, 'prison');
    for (const sq of prisons) {
      expect(sq).toBeGreaterThanOrEqual(1);
      expect(sq).toBeLessThanOrEqual(board.size - 1);
    }
  });

  it('presídios são casas distintas', () => {
    // N=25: 2 presídios; com rng controlado, verificamos sem repetição.
    // Usamos valores que não se sobreponham no pool de candidatos.
    const rng = new FakeRandomSource([25, 0, 1, ...Array(50).fill(0)]);
    const board = generateBoard('easy', ['mat'], rng);
    const prisons = squaresOfType(board, 'prison');
    const unique = new Set(prisons);
    expect(unique.size).toBe(prisons.length);
  });
});

// ---------------------------------------------------------------------------
// Densidade de casas-pergunta
// ---------------------------------------------------------------------------

describe('generateBoard — casas-pergunta (densidade)', () => {
  // Para verificar densidade, fixamos N e contamos.
  // N=25: pool não-terminal = [1..24] = 24 casas. prisonCount=2 → 22 livres.
  // easy:   round(0.4 * 22) = round(8.8) = 9
  // normal: round(0.6 * 22) = round(13.2) = 13
  // hard:   round(0.8 * 22) = round(17.6) = 18

  it('contagem correta de perguntas para easy (N=25)', () => {
    const rng = new FakeRandomSource([25, ...Array(100).fill(0)]);
    const board = generateBoard('easy', ['mat'], rng);
    expect(countTileType(board, 'question')).toBe(9);
  });

  it('contagem correta de perguntas para normal (N=25)', () => {
    const rng = new FakeRandomSource([25, ...Array(100).fill(0)]);
    const board = generateBoard('normal', ['mat'], rng);
    expect(countTileType(board, 'question')).toBe(13);
  });

  it('contagem correta de perguntas para hard (N=25)', () => {
    const rng = new FakeRandomSource([25, ...Array(100).fill(0)]);
    const board = generateBoard('hard', ['mat'], rng);
    expect(countTileType(board, 'question')).toBe(18);
  });

  // N=20: pool não-terminal = [1..19] = 19 casas. prisonCount=1 → 18 livres.
  // easy:   round(0.4 * 18) = round(7.2) = 7
  // normal: round(0.6 * 18) = round(10.8) = 11
  // hard:   round(0.8 * 18) = round(14.4) = 14

  it('contagem correta de perguntas para easy (N=20)', () => {
    const rng = new FakeRandomSource([20, ...Array(100).fill(0)]);
    const board = generateBoard('easy', ['mat'], rng);
    expect(countTileType(board, 'question')).toBe(7);
  });

  it('contagem correta de perguntas para normal (N=20)', () => {
    const rng = new FakeRandomSource([20, ...Array(100).fill(0)]);
    const board = generateBoard('normal', ['mat'], rng);
    expect(countTileType(board, 'question')).toBe(11);
  });

  it('contagem correta de perguntas para hard (N=20)', () => {
    const rng = new FakeRandomSource([20, ...Array(100).fill(0)]);
    const board = generateBoard('hard', ['mat'], rng);
    expect(countTileType(board, 'question')).toBe(14);
  });

  it('casas-pergunta ficam apenas em [1, N-1]', () => {
    const rng = new FakeRandomSource([25, ...Array(100).fill(0)]);
    const board = generateBoard('normal', ['mat'], rng);
    const questions = squaresOfType(board, 'question');
    for (const sq of questions) {
      expect(sq).toBeGreaterThanOrEqual(1);
      expect(sq).toBeLessThanOrEqual(board.size - 1);
    }
  });
});

// ---------------------------------------------------------------------------
// Exclusividade de tipos (nenhuma casa é question E prison)
// ---------------------------------------------------------------------------

describe('generateBoard — exclusividade question/prison', () => {
  it('nenhuma casa é simultaneamente question e prison', () => {
    const rng = new FakeRandomSource([25, ...Array(100).fill(0)]);
    const board = generateBoard('hard', ['mat', 'por', 'his'], rng);
    const prisons = new Set(squaresOfType(board, 'prison'));
    const questions = squaresOfType(board, 'question');
    for (const sq of questions) {
      expect(prisons.has(sq)).toBe(false);
    }
  });

  it('nenhuma casa é simultaneamente question/prison e start/finish', () => {
    const rng = new FakeRandomSource([25, ...Array(100).fill(0)]);
    const board = generateBoard('hard', ['mat'], rng);
    const specials = squaresOfType(board, 'question').concat(
      squaresOfType(board, 'prison'),
    );
    for (const sq of specials) {
      expect(sq).not.toBe(0);
      expect(sq).not.toBe(board.size);
    }
  });
});

// ---------------------------------------------------------------------------
// subjectBySquare — integridade
// ---------------------------------------------------------------------------

describe('generateBoard — subjectBySquare', () => {
  it('só contém chaves que são casas question', () => {
    const rng = new FakeRandomSource([25, ...Array(100).fill(0)]);
    const board = generateBoard('normal', ['mat', 'por'], rng);
    const questionSquares = new Set(squaresOfType(board, 'question'));
    for (const key of Object.keys(board.subjectBySquare)) {
      expect(questionSquares.has(Number(key))).toBe(true);
    }
  });

  it('toda casa question tem uma subject atribuída', () => {
    const rng = new FakeRandomSource([25, ...Array(100).fill(0)]);
    const board = generateBoard('normal', ['mat', 'por'], rng);
    const questions = squaresOfType(board, 'question');
    for (const sq of questions) {
      expect(board.subjectBySquare[sq]).toBeDefined();
    }
  });

  it('subjects atribuídas pertencem à lista recebida', () => {
    const subjects = ['mat', 'por', 'his'];
    const rng = new FakeRandomSource([25, ...Array(100).fill(0)]);
    const board = generateBoard('normal', subjects, rng);
    for (const subject of Object.values(board.subjectBySquare)) {
      expect(subjects).toContain(subject);
    }
  });

  it('subjects são sorteadas via rng (determinístico)', () => {
    // Com rng determinístico, dois boards gerados com a mesma sequência
    // devem ser idênticos.
    const seq = [25, ...Array(100).fill(0)];
    const b1 = generateBoard(
      'normal',
      ['mat', 'por'],
      new FakeRandomSource(seq),
    );
    const b2 = generateBoard(
      'normal',
      ['mat', 'por'],
      new FakeRandomSource(seq),
    );
    expect(b1.subjectBySquare).toEqual(b2.subjectBySquare);
  });
});

// ---------------------------------------------------------------------------
// Reprodutibilidade total (mesma semente → mesmo board)
// ---------------------------------------------------------------------------

describe('generateBoard — reprodutibilidade', () => {
  it('gera tabuleiro idêntico para a mesma sequência de rng', () => {
    // N=25, normal: 1 (N) + 2 (prisões) + 13 (casas-pergunta) + 13 (subjects) = 29 valores.
    const seq = [
      25, // N
      3,
      7, // presídios (índices no partial Fisher-Yates)
      0,
      1,
      2,
      4,
      5,
      6,
      8,
      9,
      10,
      11,
      12,
      0,
      1, // 13 índices de casas-pergunta
      0,
      1,
      0,
      1,
      0,
      1,
      0,
      1,
      0,
      1,
      0,
      1,
      0, // 13 índices de subject
    ];
    const b1 = generateBoard(
      'normal',
      ['mat', 'por'],
      new FakeRandomSource(seq),
    );
    const b2 = generateBoard(
      'normal',
      ['mat', 'por'],
      new FakeRandomSource(seq),
    );
    expect(b1).toEqual(b2);
  });
});
