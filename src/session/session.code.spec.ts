import { RandomSource } from '../common/random/random.source';
import { generateCode } from './session.code';

class FakeRandomSource implements RandomSource {
  private queue: number[];
  constructor(values: number[]) {
    this.queue = [...values];
  }
  int(): number {
    return this.queue.shift() as number;
  }
  rollD6(): number {
    return this.int();
  }
}

describe('generateCode', () => {
  it('gera um código de 5 dígitos a partir do RNG', () => {
    const code = generateCode(new FakeRandomSource([1, 2, 3, 4, 5]));
    expect(code).toBe('12345');
    expect(code).toMatch(/^\d{5}$/);
  });

  it('preenche com zeros à esquerda mantendo 5 dígitos', () => {
    const code = generateCode(new FakeRandomSource([0, 0, 4, 2, 1]));
    expect(code).toBe('00421');
    expect(code).toHaveLength(5);
  });
});
