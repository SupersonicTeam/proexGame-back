import { DefaultRandomSource } from './default-random.source';

describe('DefaultRandomSource', () => {
  const rng = new DefaultRandomSource();

  it('rollD6 retorna sempre um valor em [1, 6]', () => {
    for (let i = 0; i < 2000; i++) {
      const v = rng.rollD6();
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('rollD6 cobre todas as 6 faces ao longo de muitas rolagens', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(rng.rollD6());
    expect(seen.size).toBe(6);
  });

  it('int respeita limites inclusivos', () => {
    for (let i = 0; i < 2000; i++) {
      const v = rng.int(3, 5);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(5);
    }
  });

  it('int com min === max retorna o próprio valor', () => {
    expect(rng.int(7, 7)).toBe(7);
  });
});
