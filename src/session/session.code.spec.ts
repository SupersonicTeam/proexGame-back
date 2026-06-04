import { RandomSource } from '../common/random/random.source';
import { SessionRepository } from './session.repository';
import { generateUniqueCode } from './session.code';

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

// Repositório fake: só implementa exists, que é o que o gerador consulta.
function fakeRepo(existing: string[]): SessionRepository {
  const set = new Set(existing);
  return {
    exists: (code: string) => Promise.resolve(set.has(code)),
  } as unknown as SessionRepository;
}

describe('generateUniqueCode', () => {
  it('gera um código de 5 dígitos', async () => {
    const rng = new FakeRandomSource([1, 2, 3, 4, 5]);
    const code = await generateUniqueCode(fakeRepo([]), rng);
    expect(code).toBe('12345');
    expect(code).toMatch(/^\d{5}$/);
  });

  it('re-gera em caso de colisão com sessão ativa', async () => {
    // 1ª tentativa: 12345 (já existe) → 2ª tentativa: 67890 (livre)
    const rng = new FakeRandomSource([1, 2, 3, 4, 5, 6, 7, 8, 9, 0]);
    const code = await generateUniqueCode(fakeRepo(['12345']), rng);
    expect(code).toBe('67890');
  });

  it('preenche com zeros à esquerda mantendo 5 dígitos', async () => {
    const rng = new FakeRandomSource([0, 0, 4, 2, 1]);
    const code = await generateUniqueCode(fakeRepo([]), rng);
    expect(code).toBe('00421');
    expect(code).toHaveLength(5);
  });
});
