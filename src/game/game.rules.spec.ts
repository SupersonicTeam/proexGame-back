import { RandomSource } from '../common/random/random.source';
import { Player, SessionState } from '../session/session.types';
import {
  advanceFor,
  applyNudge,
  buildRanking,
  computeAdvance,
  computeTier,
  nextConnectedTurnIndex,
  recoilFor,
  resolveCorrectMovement,
  resolveErrorMovement,
  resolveMovement,
  rollDie,
  tileTypeAt,
} from './game.rules';
import { Board } from '../session/session.types';

// Fonte de aleatoriedade determinística: consome valores de uma fila.
class FakeRandomSource implements RandomSource {
  private queue: number[];
  constructor(values: number[]) {
    this.queue = [...values];
  }
  int(): number {
    if (this.queue.length === 0) throw new Error('FakeRandomSource esgotada');
    return this.queue.shift() as number;
  }
  rollD6(): number {
    return this.int();
  }
}

function makePlayer(over: Partial<Player> & { id: string }): Player {
  return {
    name: over.id,
    socketId: `sock-${over.id}`,
    square: 0,
    connected: true,
    isHost: false,
    usedQuestionIds: [],
    skipTurns: 0,
    pendingQuestion: null,
    ...over,
  };
}

function makeState(
  players: Player[],
  over: Partial<SessionState> = {},
): SessionState {
  return {
    code: '12345',
    status: 'playing',
    difficulty: 'normal',
    board: {
      size: 25,
      tileTypeBySquare: { 0: 'start', 25: 'finish' },
      subjectBySquare: {},
    },
    players,
    turnOrder: players.map((p) => p.id),
    currentTurnIndex: 0,
    winner: null,
    createdAt: '2026-06-03T00:00:00.000Z',
    lastActivityAt: '2026-06-03T00:00:00.000Z',
    servedQuestionIds: [],
    ordering: null,
    ...over,
  };
}

describe('rollDie', () => {
  it('delega para rng.rollD6', () => {
    expect(rollDie(new FakeRandomSource([4]))).toBe(4);
  });
});

describe('computeAdvance (Sprint 1 = from + value)', () => {
  it('soma o valor do dado à casa atual', () => {
    expect(computeAdvance(3, 5)).toBe(8);
    expect(computeAdvance(0, 1)).toBe(1);
  });
});

describe('resolveMovement', () => {
  it('move sem vitória quando não atinge N', () => {
    const state = makeState([makePlayer({ id: 'a', square: 4 })]);
    const out = resolveMovement(state, 'a', 3);
    expect(out.toSquare).toBe(7);
    expect(out.isWin).toBe(false);
  });

  it('vence ao atingir exatamente N (chega-ou-passa)', () => {
    const state = makeState([makePlayer({ id: 'a', square: 22 })]);
    const out = resolveMovement(state, 'a', 3); // 22+3 = 25 = N
    expect(out.isWin).toBe(true);
    expect(out.toSquare).toBe(25);
  });

  it('vence ao ultrapassar N sem overflow de índice (clampa em N)', () => {
    const state = makeState([makePlayer({ id: 'a', square: 24 })]);
    const out = resolveMovement(state, 'a', 6); // 30 > 25
    expect(out.isWin).toBe(true);
    expect(out.toSquare).toBe(25);
  });
});

// A ordem de turnos (RF-04) passou para a fase interativa de ordenação —
// testada em ordering.rules.spec.ts (regras puras) e game.service.spec.ts.

describe('nextConnectedTurnIndex', () => {
  it('avança para o próximo jogador conectado', () => {
    const state = makeState(
      [
        makePlayer({ id: 'a' }),
        makePlayer({ id: 'b' }),
        makePlayer({ id: 'c' }),
      ],
      { currentTurnIndex: 0 },
    );
    expect(nextConnectedTurnIndex(state)).toBe(1);
  });

  it('pula jogador desconectado', () => {
    const state = makeState(
      [
        makePlayer({ id: 'a' }),
        makePlayer({ id: 'b', connected: false }),
        makePlayer({ id: 'c' }),
      ],
      { currentTurnIndex: 0 },
    );
    expect(nextConnectedTurnIndex(state)).toBe(2);
  });

  it('volta circularmente ao primeiro conectado', () => {
    const state = makeState(
      [makePlayer({ id: 'a' }), makePlayer({ id: 'b' })],
      { currentTurnIndex: 1 },
    );
    expect(nextConnectedTurnIndex(state)).toBe(0);
  });

  it('retorna o índice atual quando ninguém mais está conectado', () => {
    const state = makeState(
      [makePlayer({ id: 'a' }), makePlayer({ id: 'b', connected: false })],
      { currentTurnIndex: 0 },
    );
    expect(nextConnectedTurnIndex(state)).toBe(0);
  });
});

describe('buildRanking', () => {
  it('coloca o vencedor em 1º e ordena os demais por casa desc', () => {
    const state = makeState([
      makePlayer({ id: 'a', name: 'Ana', square: 10 }),
      makePlayer({ id: 'b', name: 'Bia', square: 25 }),
      makePlayer({ id: 'c', name: 'Caio', square: 18 }),
    ]);
    const ranking = buildRanking(state, 'b');
    expect(ranking.map((r) => r.playerId)).toEqual(['b', 'c', 'a']);
    expect(ranking.map((r) => r.position)).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// S2-04 — computeTier, advanceFor, recoilFor
// ---------------------------------------------------------------------------

describe('computeTier', () => {
  describe('2 jogadores — apenas leader e last', () => {
    it('identifica leader e last corretamente', () => {
      const state = makeState([
        makePlayer({ id: 'a', square: 10 }),
        makePlayer({ id: 'b', square: 5 }),
      ]);
      expect(computeTier(state, 'a')).toBe('leader');
      expect(computeTier(state, 'b')).toBe('last');
    });

    it('empate total com 2 jogadores → ambos leader', () => {
      const state = makeState([
        makePlayer({ id: 'a', square: 7 }),
        makePlayer({ id: 'b', square: 7 }),
      ]);
      expect(computeTier(state, 'a')).toBe('leader');
      expect(computeTier(state, 'b')).toBe('leader');
    });
  });

  describe('3 jogadores — leader, middle, last', () => {
    it('identifica os três tiers distintos', () => {
      const state = makeState([
        makePlayer({ id: 'a', square: 15 }),
        makePlayer({ id: 'b', square: 8 }),
        makePlayer({ id: 'c', square: 2 }),
      ]);
      expect(computeTier(state, 'a')).toBe('leader');
      expect(computeTier(state, 'b')).toBe('middle');
      expect(computeTier(state, 'c')).toBe('last');
    });

    it('empate no topo → ambos leader, terceiro é last', () => {
      const state = makeState([
        makePlayer({ id: 'a', square: 12 }),
        makePlayer({ id: 'b', square: 12 }),
        makePlayer({ id: 'c', square: 3 }),
      ]);
      expect(computeTier(state, 'a')).toBe('leader');
      expect(computeTier(state, 'b')).toBe('leader');
      expect(computeTier(state, 'c')).toBe('last');
    });

    it('empate na base → todos na base são last, líder é leader', () => {
      const state = makeState([
        makePlayer({ id: 'a', square: 20 }),
        makePlayer({ id: 'b', square: 4 }),
        makePlayer({ id: 'c', square: 4 }),
      ]);
      expect(computeTier(state, 'a')).toBe('leader');
      expect(computeTier(state, 'b')).toBe('last');
      expect(computeTier(state, 'c')).toBe('last');
    });

    it('empate total com 3 jogadores → todos leader', () => {
      const state = makeState([
        makePlayer({ id: 'a', square: 5 }),
        makePlayer({ id: 'b', square: 5 }),
        makePlayer({ id: 'c', square: 5 }),
      ]);
      expect(computeTier(state, 'a')).toBe('leader');
      expect(computeTier(state, 'b')).toBe('leader');
      expect(computeTier(state, 'c')).toBe('leader');
    });
  });

  describe('4 jogadores', () => {
    it('classifica corretamente com squares distintos', () => {
      const state = makeState([
        makePlayer({ id: 'a', square: 20 }),
        makePlayer({ id: 'b', square: 14 }),
        makePlayer({ id: 'c', square: 9 }),
        makePlayer({ id: 'd', square: 3 }),
      ]);
      expect(computeTier(state, 'a')).toBe('leader');
      expect(computeTier(state, 'b')).toBe('middle');
      expect(computeTier(state, 'c')).toBe('middle');
      expect(computeTier(state, 'd')).toBe('last');
    });

    it('empate na posição intermediária → todos os empatados são middle', () => {
      const state = makeState([
        makePlayer({ id: 'a', square: 18 }),
        makePlayer({ id: 'b', square: 10 }),
        makePlayer({ id: 'c', square: 10 }),
        makePlayer({ id: 'd', square: 2 }),
      ]);
      expect(computeTier(state, 'a')).toBe('leader');
      expect(computeTier(state, 'b')).toBe('middle');
      expect(computeTier(state, 'c')).toBe('middle');
      expect(computeTier(state, 'd')).toBe('last');
    });
  });

  // Achado #6: jogadores DESCONECTADOS não devem distorcer os tiers — o cálculo
  // de máximo/mínimo considera apenas jogadores com connected === true.
  describe('jogadores desconectados são ignorados no cálculo (achado #6)', () => {
    it('o desconectado mais atrás não rouba o tier last do ativo mais atrasado', () => {
      // A (con) em 10, B (con) em 15, C (DESCON) em 2. Entre conectados, o min é
      // A (10) → A é last; B é leader. Com o código antigo, C (2) seria o min e A
      // viraria middle — por isso este teste falhava antes da correção.
      const state = makeState([
        makePlayer({ id: 'a', square: 10 }),
        makePlayer({ id: 'b', square: 15 }),
        makePlayer({ id: 'c', square: 2, connected: false }),
      ]);
      expect(computeTier(state, 'a')).toBe('last');
      expect(computeTier(state, 'b')).toBe('leader');
    });

    it('o desconectado à frente não rouba o tier leader do ativo mais avançado', () => {
      // C (DESCON) em 30 está à frente, mas é ignorado: entre conectados, B (15)
      // é leader e A (10) é last.
      const state = makeState([
        makePlayer({ id: 'a', square: 10 }),
        makePlayer({ id: 'b', square: 15 }),
        makePlayer({ id: 'c', square: 30, connected: false }),
      ]);
      expect(computeTier(state, 'a')).toBe('last');
      expect(computeTier(state, 'b')).toBe('leader');
    });

    it('chamado para o próprio jogador desconectado, devolve tier coerente entre conectados', () => {
      // C (DESCON) em 2 fica fora do conjunto de referência (conectados: A=10, B=15).
      // Como seu square (2) não é nem o max (15) nem o min (10) dos conectados, ele
      // cai no caso 'middle' — coerente: o desconectado não define os extremos nem
      // ocupa um deles, então recebe o tier neutro. O que importa é que ele NÃO
      // contamina o cálculo dos conectados (verificado nos testes acima).
      const state = makeState([
        makePlayer({ id: 'a', square: 10 }),
        makePlayer({ id: 'b', square: 15 }),
        makePlayer({ id: 'c', square: 2, connected: false }),
      ]);
      expect(computeTier(state, 'c')).toBe('middle');
    });

    it('guard: nenhum conectado → fallback para TODOS (comportamento atual)', () => {
      // Todos desconectados: o conjunto de conectados é vazio, então o cálculo cai
      // de volta para todos os jogadores. A (20) é leader, C (3) é last.
      const state = makeState([
        makePlayer({ id: 'a', square: 20, connected: false }),
        makePlayer({ id: 'b', square: 9, connected: false }),
        makePlayer({ id: 'c', square: 3, connected: false }),
      ]);
      expect(computeTier(state, 'a')).toBe('leader');
      expect(computeTier(state, 'b')).toBe('middle');
      expect(computeTier(state, 'c')).toBe('last');
    });

    it('empate total entre conectados → todos leader (desconectado ignorado)', () => {
      // A e B (con) empatados em 7; C (DESCON) em 1 é ignorado → max === min → leader.
      const state = makeState([
        makePlayer({ id: 'a', square: 7 }),
        makePlayer({ id: 'b', square: 7 }),
        makePlayer({ id: 'c', square: 1, connected: false }),
      ]);
      expect(computeTier(state, 'a')).toBe('leader');
      expect(computeTier(state, 'b')).toBe('leader');
    });
  });

  it('lança erro quando o playerId não existe', () => {
    const state = makeState([makePlayer({ id: 'a', square: 5 })]);
    expect(() => computeTier(state, 'inexistente')).toThrow(
      'Jogador inexistente não encontrado na sessão',
    );
  });
});

describe('advanceFor', () => {
  // Tabela §4 completa: 3 dificuldades × 3 tiers = 9 células
  it.each<[string, Parameters<typeof advanceFor>, number]>([
    ['easy/leader', ['easy', 'leader'], 3],
    ['easy/middle', ['easy', 'middle'], 4],
    ['easy/last', ['easy', 'last'], 5],
    ['normal/leader', ['normal', 'leader'], 2],
    ['normal/middle', ['normal', 'middle'], 3],
    ['normal/last', ['normal', 'last'], 4],
    ['hard/leader', ['hard', 'leader'], 1],
    ['hard/middle', ['hard', 'middle'], 2],
    ['hard/last', ['hard', 'last'], 3],
  ])('%s → %i', (_label, [diff, tier], expected) => {
    expect(advanceFor(diff, tier)).toBe(expected);
  });
});

describe('recoilFor', () => {
  // Tabela §4 de recuo: 3 dificuldades × 2 tipos = 6 células
  it.each<[string, Parameters<typeof recoilFor>, number]>([
    ['proximal/easy', ['easy', 'proximal'], 1],
    ['proximal/normal', ['normal', 'proximal'], 2],
    ['proximal/hard', ['hard', 'proximal'], 3],
    ['wrong/easy', ['easy', 'wrong'], 2],
    ['wrong/normal', ['normal', 'wrong'], 3],
    ['wrong/hard', ['hard', 'wrong'], 4],
  ])('%s → %i', (_label, [diff, type], expected) => {
    expect(recoilFor(diff, type)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// S2-05 — tileTypeAt, nudge e resolução de movimento de acerto/erro
// ---------------------------------------------------------------------------

// Tabuleiro de teste: 0=start, 25=finish, 5=question, 10=prison; demais normal.
function makeBoard(over: Partial<Board> = {}): Board {
  return {
    size: 25,
    tileTypeBySquare: { 0: 'start', 25: 'finish', 5: 'question', 10: 'prison' },
    subjectBySquare: { 5: 'mat' },
    ...over,
  };
}

describe('tileTypeAt', () => {
  const board = makeBoard();
  it('casa 0 é start e casa N é finish', () => {
    expect(tileTypeAt(board, 0)).toBe('start');
    expect(tileTypeAt(board, 25)).toBe('finish');
  });
  it('casas além de N contam como finish; ≤0 como start', () => {
    expect(tileTypeAt(board, 30)).toBe('finish');
    expect(tileTypeAt(board, -1)).toBe('start');
  });
  it('reflete o tipo especial marcado e cai em normal por padrão', () => {
    expect(tileTypeAt(board, 5)).toBe('question');
    expect(tileTypeAt(board, 10)).toBe('prison');
    expect(tileTypeAt(board, 3)).toBe('normal');
  });
});

describe('applyNudge', () => {
  it('não desloca quando a casa-alvo não é especial (não consome rng)', () => {
    const rng = new FakeRandomSource([]); // estoura se consumir
    expect(applyNudge(makeBoard(), 3, rng)).toBe(3);
  });

  it('com P satisfeita (int<=7), desloca casa-pergunta para +1 normal', () => {
    // 5=question, 6=normal → prefere +1.
    expect(applyNudge(makeBoard(), 5, new FakeRandomSource([7]))).toBe(6);
  });

  it('com P não satisfeita (int>7), permanece na casa especial', () => {
    expect(applyNudge(makeBoard(), 5, new FakeRandomSource([8]))).toBe(5);
  });

  it('desloca presídio também (anti "parado na cadeia sem efeito")', () => {
    // 10=prison, 11=normal.
    expect(applyNudge(makeBoard(), 10, new FakeRandomSource([1]))).toBe(11);
  });

  it('cai para -1 quando +1 também é especial', () => {
    // 5=question, 6=prison, 4=normal → +1 inviável, usa -1.
    const board = makeBoard({
      tileTypeBySquare: {
        0: 'start',
        25: 'finish',
        5: 'question',
        6: 'prison',
      },
    });
    expect(applyNudge(board, 5, new FakeRandomSource([7]))).toBe(4);
  });

  it('permanece quando ambos os vizinhos são inviáveis', () => {
    const board = makeBoard({
      tileTypeBySquare: {
        0: 'start',
        25: 'finish',
        4: 'prison',
        5: 'question',
        6: 'prison',
      },
    });
    expect(applyNudge(board, 5, new FakeRandomSource([7]))).toBe(5);
  });

  it('não desloca para a chegada (finish não é "não-especial")', () => {
    // 24=question, 25=finish → +1 inviável; 23=normal → usa -1.
    const board = makeBoard({
      tileTypeBySquare: { 0: 'start', 25: 'finish', 24: 'question' },
    });
    expect(applyNudge(board, 24, new FakeRandomSource([7]))).toBe(23);
  });
});

describe('resolveCorrectMovement', () => {
  it('avança por tier/dificuldade sem nudge quando o alvo é normal', () => {
    // 2 jogadores: A em 3 (leader), B em 0. normal/leader = +2 → 5? 5 é question.
    // Para isolar o caso normal, coloco A em 1 → alvo 3 (normal).
    const state = makeState(
      [makePlayer({ id: 'a', square: 1 }), makePlayer({ id: 'b', square: 0 })],
      { difficulty: 'normal', board: makeBoard() },
    );
    const rng = new FakeRandomSource([]); // alvo normal → sem consumo
    const r = resolveCorrectMovement(state, 'a', rng);
    expect(r).toEqual({
      fromSquare: 1,
      toSquare: 3,
      isWin: false,
      tileType: 'normal',
    });
  });

  it('aplica nudge quando o avanço cai em casa-pergunta', () => {
    // A em 3 (leader), normal → +2 → 5 (question) → nudge +1 → 6 (normal).
    const state = makeState(
      [makePlayer({ id: 'a', square: 3 }), makePlayer({ id: 'b', square: 0 })],
      { difficulty: 'normal', board: makeBoard() },
    );
    const r = resolveCorrectMovement(state, 'a', new FakeRandomSource([7]));
    expect(r.toSquare).toBe(6);
    expect(r.tileType).toBe('normal');
    expect(r.isWin).toBe(false);
  });

  it('last avança mais (catch-up) que leader', () => {
    // A em 0 (last), B em 8 (leader). normal/last = +4 → casa 4 (normal).
    const state = makeState(
      [makePlayer({ id: 'a', square: 0 }), makePlayer({ id: 'b', square: 8 })],
      { difficulty: 'normal', board: makeBoard() },
    );
    const r = resolveCorrectMovement(state, 'a', new FakeRandomSource([]));
    expect(r.toSquare).toBe(4);
  });

  it('vitória quando o avanço alcança/ultrapassa N (clamp em N)', () => {
    const state = makeState(
      [makePlayer({ id: 'a', square: 24 }), makePlayer({ id: 'b', square: 0 })],
      { difficulty: 'normal', board: makeBoard() },
    );
    const r = resolveCorrectMovement(state, 'a', new FakeRandomSource([]));
    expect(r.isWin).toBe(true);
    expect(r.toSquare).toBe(25);
    expect(r.tileType).toBe('finish');
  });
});

describe('resolveErrorMovement', () => {
  it('recua por erro proximal sem disparar nada', () => {
    const state = makeState([makePlayer({ id: 'a', square: 5 })], {
      difficulty: 'normal',
      board: makeBoard(),
    });
    const r = resolveErrorMovement(state, 'a', 'proximal'); // normal proximal = 2
    expect(r).toEqual({
      fromSquare: 5,
      toSquare: 3,
      isWin: false,
      tileType: 'normal',
    });
  });

  it('recuo total é maior que proximal', () => {
    const state = makeState([makePlayer({ id: 'a', square: 5 })], {
      difficulty: 'normal',
      board: makeBoard(),
    });
    expect(resolveErrorMovement(state, 'a', 'wrong').toSquare).toBe(2); // 5-3
  });

  it('clampa na casa 1 (nunca abaixo)', () => {
    const state = makeState([makePlayer({ id: 'a', square: 2 })], {
      difficulty: 'hard',
      board: makeBoard(),
    });
    expect(resolveErrorMovement(state, 'a', 'wrong').toSquare).toBe(1); // 2-4 → 1
  });
});

describe('resolveMovement (dado) — agora devolve tileType de destino', () => {
  it('inclui o tileType da casa de aterrissagem', () => {
    const state = makeState([makePlayer({ id: 'a', square: 3 })], {
      board: makeBoard(),
    });
    const r = resolveMovement(state, 'a', 2); // 3+2 = 5 = question
    expect(r.toSquare).toBe(5);
    expect(r.tileType).toBe('question');
  });
});
