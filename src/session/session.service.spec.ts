import { ErrorCode } from '../common/errors/game-error';
import { RandomSource } from '../common/random/random.source';
import { SessionRepository } from './session.repository';
import { SessionService } from './session.service';
import { SessionState } from './session.types';

// Repositório em memória para testar o serviço sem Redis.
class InMemoryRepo {
  store = new Map<string, SessionState>();
  create(s: SessionState) {
    this.store.set(s.code, structuredClone(s));
    return Promise.resolve();
  }
  findByCode(c: string) {
    const s = this.store.get(c);
    return Promise.resolve(s ? structuredClone(s) : null);
  }
  save(s: SessionState) {
    s.lastActivityAt = new Date().toISOString();
    this.store.set(s.code, structuredClone(s));
    return Promise.resolve();
  }
  exists(c: string) {
    return Promise.resolve(this.store.has(c));
  }
  delete(c: string) {
    this.store.delete(c);
    return Promise.resolve();
  }
}

// RNG fixo: dígitos para o código + valores subsequentes.
class FakeRandomSource implements RandomSource {
  private queue: number[];
  constructor(values: number[]) {
    this.queue = [...values];
  }
  int(): number {
    return this.queue.length ? (this.queue.shift() as number) : 0;
  }
  rollD6(): number {
    return this.int();
  }
}

function build(rngValues: number[] = [1, 2, 3, 4, 5]) {
  const repo = new InMemoryRepo();
  const rng = new FakeRandomSource(rngValues);
  const service = new SessionService(repo as unknown as SessionRepository, rng);
  return { repo, service };
}

describe('SessionService.createSession', () => {
  it('cria sessão em lobby com o criador como host', async () => {
    const { service } = build();
    const { state, playerId } = await service.createSession(
      'Ana',
      'normal',
      'sock-1',
    );
    expect(state.code).toBe('12345');
    expect(state.status).toBe('lobby');
    expect(state.players).toHaveLength(1);
    const host = state.players[0];
    expect(host.id).toBe(playerId);
    expect(host.isHost).toBe(true);
    expect(host.name).toBe('Ana');
    expect(host.square).toBe(0);
  });

  it('rejeita nome vazio com INVALID_NAME', async () => {
    const { service } = build();
    await expect(
      service.createSession('   ', 'normal', 'sock-1'),
    ).rejects.toMatchObject({
      code: ErrorCode.INVALID_NAME,
    });
  });
});

describe('SessionService.joinSession', () => {
  async function withLobby() {
    const ctx = build([1, 2, 3, 4, 5]);
    const created = await ctx.service.createSession('Ana', 'normal', 'sock-1');
    return { ...ctx, code: created.state.code };
  }

  it('adiciona um segundo jogador ao lobby', async () => {
    const { service, code } = await withLobby();
    const { state, playerId } = await service.joinSession(
      code,
      'Bia',
      'sock-2',
    );
    expect(state.players).toHaveLength(2);
    expect(
      state.players.some((p) => p.id === playerId && p.name === 'Bia'),
    ).toBe(true);
    expect(state.players[1].isHost).toBe(false);
  });

  it('rejeita código inexistente com SESSION_NOT_FOUND', async () => {
    const { service } = build();
    await expect(
      service.joinSession('00000', 'Bia', 'sock-2'),
    ).rejects.toMatchObject({
      code: ErrorCode.SESSION_NOT_FOUND,
    });
  });

  it('rejeita nome vazio com INVALID_NAME', async () => {
    const { service, code } = await withLobby();
    await expect(service.joinSession(code, '', 'sock-2')).rejects.toMatchObject(
      {
        code: ErrorCode.INVALID_NAME,
      },
    );
  });

  it('rejeita entrada quando o lobby está cheio (4) com SESSION_FULL', async () => {
    const { service, code } = await withLobby();
    await service.joinSession(code, 'Bia', 'sock-2');
    await service.joinSession(code, 'Caio', 'sock-3');
    await service.joinSession(code, 'Davi', 'sock-4');
    await expect(
      service.joinSession(code, 'Eva', 'sock-5'),
    ).rejects.toMatchObject({
      code: ErrorCode.SESSION_FULL,
    });
  });

  it('rejeita entrada em sessão já iniciada com SESSION_ALREADY_STARTED', async () => {
    const { service, code } = await withLobby();
    await service.joinSession(code, 'Bia', 'sock-2');
    await service.startGame(
      code,
      (await service.getState(code))!.players[0].id,
    );
    await expect(
      service.joinSession(code, 'Caio', 'sock-3'),
    ).rejects.toMatchObject({
      code: ErrorCode.SESSION_ALREADY_STARTED,
    });
  });
});

describe('SessionService.startGame', () => {
  async function withTwoPlayers() {
    const ctx = build([1, 2, 3, 4, 5]);
    const host = await ctx.service.createSession('Ana', 'normal', 'sock-1');
    await ctx.service.joinSession(host.state.code, 'Bia', 'sock-2');
    return { ...ctx, code: host.state.code, hostId: host.playerId };
  }

  it('host inicia: status playing e tabuleiro fixo inicializado', async () => {
    const { service, code, hostId } = await withTwoPlayers();
    const state = await service.startGame(code, hostId);
    expect(state.status).toBe('playing');
    expect(state.board.size).toBe(25);
    expect(state.board.tileTypeBySquare[0]).toBe('start');
    expect(state.board.tileTypeBySquare[25]).toBe('finish');
    expect(state.players.every((p) => p.square === 0)).toBe(true);
  });

  it('rejeita início por quem não é host com NOT_HOST', async () => {
    const { service, code } = await withTwoPlayers();
    const nonHost = (await service.getState(code))!.players[1].id;
    await expect(service.startGame(code, nonHost)).rejects.toMatchObject({
      code: ErrorCode.NOT_HOST,
    });
  });

  it('rejeita início com menos de 2 jogadores com NOT_ENOUGH_PLAYERS', async () => {
    const ctx = build([1, 2, 3, 4, 5]);
    const host = await ctx.service.createSession('Ana', 'normal', 'sock-1');
    await expect(
      ctx.service.startGame(host.state.code, host.playerId),
    ).rejects.toMatchObject({
      code: ErrorCode.NOT_ENOUGH_PLAYERS,
    });
  });
});

describe('SessionService.markDisconnected / leaveSession', () => {
  async function withTwoPlayers() {
    const ctx = build([1, 2, 3, 4, 5]);
    const host = await ctx.service.createSession('Ana', 'normal', 'sock-1');
    const joiner = await ctx.service.joinSession(
      host.state.code,
      'Bia',
      'sock-2',
    );
    return {
      ...ctx,
      code: host.state.code,
      hostId: host.playerId,
      joinerId: joiner.playerId,
    };
  }

  it('markDisconnected marca o jogador como connected=false', async () => {
    const { service, code, joinerId } = await withTwoPlayers();
    const state = await service.markDisconnected(code, joinerId);
    expect(state).not.toBeNull();
    expect(state!.players.find((p) => p.id === joinerId)!.connected).toBe(
      false,
    );
  });

  it('leaveSession remove o jogador da sessão', async () => {
    const { service, code, joinerId } = await withTwoPlayers();
    const state = await service.leaveSession(code, joinerId);
    expect(state!.players.some((p) => p.id === joinerId)).toBe(false);
  });
});
