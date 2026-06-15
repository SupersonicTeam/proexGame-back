import {
  hasRolled,
  isOrderingResolved,
  isRoundComplete,
  orderingTurnOrder,
  playersToRoll,
  recordOrderRoll,
  resolveRound,
  startOrdering,
} from './ordering.rules';

describe('ordering.rules', () => {
  describe('startOrdering', () => {
    it('coloca todos num único grupo na rodada 1, sem rolagens', () => {
      const o = startOrdering(['a', 'b', 'c']);
      expect(o.groups).toEqual([['a', 'b', 'c']]);
      expect(o.currentRolls).toEqual({});
      expect(o.round).toBe(1);
      expect(o.history).toEqual([]);
    });
  });

  describe('playersToRoll / hasRolled', () => {
    it('todos precisam rolar quando há um grupo empatado', () => {
      const o = startOrdering(['a', 'b']);
      expect(playersToRoll(o)).toEqual(['a', 'b']);
      expect(hasRolled(o, 'a')).toBe(false);
    });

    it('grupos de 1 (resolvidos) não precisam rolar', () => {
      // Após uma rodada sem empate, ninguém mais rola.
      const resolved = resolveRound(
        recordOrderRoll(
          recordOrderRoll(startOrdering(['a', 'b']), 'a', 5),
          'b',
          2,
        ),
      );
      expect(playersToRoll(resolved)).toEqual([]);
    });
  });

  describe('isRoundComplete', () => {
    it('falso até todos os empatados rolarem; verdadeiro depois', () => {
      let o = startOrdering(['a', 'b']);
      expect(isRoundComplete(o)).toBe(false);
      o = recordOrderRoll(o, 'a', 4);
      expect(isRoundComplete(o)).toBe(false);
      o = recordOrderRoll(o, 'b', 1);
      expect(isRoundComplete(o)).toBe(true);
    });
  });

  describe('resolveRound — sem empate', () => {
    it('ordena por valor desc e resolve em uma rodada', () => {
      // a=2, b=6, c=4 → b, c, a
      let o = startOrdering(['a', 'b', 'c']);
      o = recordOrderRoll(o, 'a', 2);
      o = recordOrderRoll(o, 'b', 6);
      o = recordOrderRoll(o, 'c', 4);
      o = resolveRound(o);
      expect(isOrderingResolved(o)).toBe(true);
      expect(orderingTurnOrder(o)).toEqual(['b', 'c', 'a']);
      expect(o.history).toHaveLength(1);
      expect(o.round).toBe(2);
    });
  });

  describe('resolveRound — empate só entre empatados (RF-04)', () => {
    it('re-rola apenas os empatados do topo numa nova rodada', () => {
      // Rodada 1: a=6, b=6, c=3 → c já resolvido (último); a/b empatados ficam à frente.
      let o = startOrdering(['a', 'b', 'c']);
      o = recordOrderRoll(o, 'a', 6);
      o = recordOrderRoll(o, 'b', 6);
      o = recordOrderRoll(o, 'c', 3);
      o = resolveRound(o);

      expect(isOrderingResolved(o)).toBe(false);
      // Só a e b precisam rolar de novo; c está fixo por último.
      expect(playersToRoll(o)).toEqual(['a', 'b']);
      expect(o.groups).toEqual([['a', 'b'], ['c']]);
      expect(o.round).toBe(2);

      // Rodada 2 (desempate a/b): a=2, b=5 → b antes de a.
      o = recordOrderRoll(o, 'a', 2);
      o = recordOrderRoll(o, 'b', 5);
      o = resolveRound(o);

      expect(isOrderingResolved(o)).toBe(true);
      expect(orderingTurnOrder(o)).toEqual(['b', 'a', 'c']);
      expect(o.history).toHaveLength(2);
    });

    it('empate persistente exige mais uma rodada (não zera entre os empatados)', () => {
      // Rodada 1: a=4, b=4 → continuam empatados.
      let o = startOrdering(['a', 'b']);
      o = recordOrderRoll(o, 'a', 4);
      o = recordOrderRoll(o, 'b', 4);
      o = resolveRound(o);
      expect(isOrderingResolved(o)).toBe(false);
      expect(playersToRoll(o)).toEqual(['a', 'b']);

      // Rodada 2: a=1, b=6 → b, a.
      o = recordOrderRoll(o, 'a', 1);
      o = recordOrderRoll(o, 'b', 6);
      o = resolveRound(o);
      expect(orderingTurnOrder(o)).toEqual(['b', 'a']);
    });

    it('history registra as rolagens de cada rodada', () => {
      let o = startOrdering(['a', 'b']);
      o = resolveRound(recordOrderRoll(recordOrderRoll(o, 'a', 4), 'b', 4));
      o = resolveRound(recordOrderRoll(recordOrderRoll(o, 'a', 1), 'b', 6));
      expect(o.history).toEqual([
        [
          { playerId: 'a', value: 4 },
          { playerId: 'b', value: 4 },
        ],
        [
          { playerId: 'a', value: 1 },
          { playerId: 'b', value: 6 },
        ],
      ]);
    });
  });
});
