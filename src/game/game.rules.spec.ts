import { RandomSource } from '../common/random/random.source';
import { Player, SessionState } from '../session/session.types';
import {
  advanceFor,
  buildRanking,
  computeAdvance,
  computeTier,
  nextConnectedTurnIndex,
  recoilFor,
  resolveMovement,
  resolveOrder,
  rollDie,
} from './game.rules';

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

describe('resolveOrder', () => {
  it('ordena por maior valor sem empate', () => {
    // a=2, b=6, c=4 → ordem b, c, a
    const rng = new FakeRandomSource([2, 6, 4]);
    const { turnOrder } = resolveOrder(['a', 'b', 'c'], rng);
    expect(turnOrder).toEqual(['b', 'c', 'a']);
  });

  it('re-rola apenas entre os empatados no maior valor', () => {
    // 1ª rolagem: a=6, b=6, c=3 → empate a/b no topo, c por último.
    // desempate a/b: a=2, b=5 → b antes de a.
    // ordem final: b, a, c
    const rng = new FakeRandomSource([6, 6, 3, 2, 5]);
    const { turnOrder } = resolveOrder(['a', 'b', 'c'], rng);
    expect(turnOrder).toEqual(['b', 'a', 'c']);
  });

  it('retorna os rolls da primeira rolagem', () => {
    const rng = new FakeRandomSource([2, 6, 4]);
    const { rolls } = resolveOrder(['a', 'b', 'c'], rng);
    expect(rolls).toEqual([
      { playerId: 'a', value: 2 },
      { playerId: 'b', value: 6 },
      { playerId: 'c', value: 4 },
    ]);
  });
});

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
