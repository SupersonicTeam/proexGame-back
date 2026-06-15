import { SessionLock } from './session.lock';

// Espera um "tick" de macrotask, criando uma janela real onde outra operação
// poderia se intercalar caso NÃO houvesse serialização.
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('SessionLock', () => {
  it('serializa operações da MESMA chave (não há intercalação)', async () => {
    const lock = new SessionLock();
    const events: string[] = [];
    const op = (label: string) => async () => {
      events.push(`${label}:start`);
      await tick();
      events.push(`${label}:end`);
    };

    await Promise.all([
      lock.runExclusive('k', op('A')),
      lock.runExclusive('k', op('B')),
    ]);

    // Sem o lock seria ['A:start','B:start','A:end','B:end'] (intercalado).
    expect(events).toEqual(['A:start', 'A:end', 'B:start', 'B:end']);
  });

  it('preserva a ordem de enfileiramento (FIFO) sob a mesma chave', async () => {
    const lock = new SessionLock();
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        lock.runExclusive('k', async () => {
          await tick();
          order.push(n);
        }),
      ),
    );
    expect(order).toEqual([1, 2, 3, 4, 5]);
  });

  it('permite concorrência entre chaves DIFERENTES', async () => {
    const lock = new SessionLock();
    const events: string[] = [];
    const op = (label: string) => async () => {
      events.push(`${label}:start`);
      await tick();
      events.push(`${label}:end`);
    };

    await Promise.all([
      lock.runExclusive('k1', op('A')),
      lock.runExclusive('k2', op('B')),
    ]);

    // Chaves distintas rodam em paralelo: ambos iniciam antes de qualquer fim.
    expect(events.slice(0, 2).sort()).toEqual(['A:start', 'B:start']);
  });

  it('um erro numa operação não trava a fila das seguintes', async () => {
    const lock = new SessionLock();
    const results = await Promise.allSettled([
      lock.runExclusive('k', () => Promise.reject(new Error('boom'))),
      lock.runExclusive('k', () => Promise.resolve('ok')),
    ]);
    expect(results[0].status).toBe('rejected');
    expect(results[1]).toEqual({ status: 'fulfilled', value: 'ok' });
  });

  it('propaga o valor de retorno e o erro de `fn`', async () => {
    const lock = new SessionLock();
    await expect(
      lock.runExclusive('k', () => Promise.resolve(42)),
    ).resolves.toBe(42);
    await expect(
      lock.runExclusive('k', () => Promise.reject(new Error('x'))),
    ).rejects.toThrow('x');
  });

  it('não acumula chaves no Map após a fila esvaziar (sem vazamento)', async () => {
    const lock = new SessionLock();
    await lock.runExclusive('k', async () => undefined);
    // Acesso ao estado interno só para garantir a limpeza da entrada ociosa.
    const tails = (lock as unknown as { tails: Map<string, unknown> }).tails;
    expect(tails.has('k')).toBe(false);
  });
});
