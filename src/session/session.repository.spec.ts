import Redis from 'ioredis';
import RedisMock from 'ioredis-mock';
import { SESSION_TTL_SECONDS, SessionRepository } from './session.repository';
import { SessionState } from './session.types';

function makeState(code = '12345'): SessionState {
  return {
    code,
    status: 'lobby',
    difficulty: 'normal',
    board: {
      size: 25,
      tileTypeBySquare: { 0: 'start', 25: 'finish' },
      subjectBySquare: {},
    },
    players: [],
    turnOrder: [],
    currentTurnIndex: 0,
    winner: null,
    createdAt: '2026-06-03T00:00:00.000Z',
    lastActivityAt: '2026-06-03T00:00:00.000Z',
    servedQuestionIds: [],
    ordering: null,
  };
}

describe('SessionRepository', () => {
  let repo: SessionRepository;

  let client: Redis;

  beforeEach(async () => {
    client = new RedisMock() as unknown as Redis;
    // ioredis-mock compartilha o store entre instâncias — limpamos para isolar cada teste.
    await client.flushall();
    repo = new SessionRepository(client);
  });

  it('create + findByCode retorna o estado salvo', async () => {
    const state = makeState();
    await repo.create(state);
    const found = await repo.findByCode('12345');
    expect(found).toEqual(state);
  });

  it('findByCode retorna null para código inexistente', async () => {
    expect(await repo.findByCode('00000')).toBeNull();
  });

  it('exists reflete a presença da sessão', async () => {
    expect(await repo.exists('12345')).toBe(false);
    await repo.create(makeState());
    expect(await repo.exists('12345')).toBe(true);
  });

  it('save atualiza lastActivityAt', async () => {
    const state = makeState();
    await repo.create(state);
    await repo.save(state);
    const found = await repo.findByCode('12345');
    expect(found).not.toBeNull();
    expect(found!.lastActivityAt).not.toBe('2026-06-03T00:00:00.000Z');
  });

  it('delete remove a sessão', async () => {
    await repo.create(makeState());
    await repo.delete('12345');
    expect(await repo.findByCode('12345')).toBeNull();
  });

  it('aplica TTL na criação (RF-15 backstop)', async () => {
    await repo.create(makeState());
    const ttl = await client.ttl('session:12345');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(SESSION_TTL_SECONDS);
  });

  it('renova o TTL a cada save (deslizante)', async () => {
    const state = makeState();
    await repo.create(state);
    await repo.save(state);
    const ttl = await client.ttl('session:12345');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(SESSION_TTL_SECONDS);
  });

  describe('scanCodes (reconciliação de boot — achado #2)', () => {
    it('retorna [] quando não há nenhuma sessão', async () => {
      expect(await repo.scanCodes()).toEqual([]);
    });

    it('retorna os códigos de todas as sessões vivas, sem o prefixo session:', async () => {
      await repo.create(makeState('12345'));
      await repo.create(makeState('67890'));
      await repo.create(makeState('11111'));

      const codes = await repo.scanCodes();
      expect(codes.sort()).toEqual(['11111', '12345', '67890']);
      // Nenhum código carrega o prefixo de chave do Redis.
      expect(codes.every((c) => !c.startsWith('session:'))).toBe(true);
    });
  });

  describe('createIfAbsent (atômico)', () => {
    it('grava e retorna true quando o código está livre', async () => {
      const ok = await repo.createIfAbsent(makeState());
      expect(ok).toBe(true);
      expect(await repo.findByCode('12345')).not.toBeNull();
    });

    it('retorna false e não sobrescreve quando o código já existe', async () => {
      const first = makeState();
      first.difficulty = 'easy';
      await repo.createIfAbsent(first);

      const second = makeState();
      second.difficulty = 'hard';
      const ok = await repo.createIfAbsent(second);

      expect(ok).toBe(false);
      const stored = await repo.findByCode('12345');
      expect(stored!.difficulty).toBe('easy'); // sessão original preservada
    });
  });
});
