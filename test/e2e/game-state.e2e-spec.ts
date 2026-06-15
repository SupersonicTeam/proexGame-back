import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'net';
import RedisMock from 'ioredis-mock';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../../src/app.module';
import {
  RANDOM_SOURCE,
  RandomSource,
} from '../../src/common/random/random.source';
import { REDIS_CLIENT } from '../../src/redis/redis.constants';
import { startMatch } from './helpers';

// RNG roteirizado: int() retorna sempre o mínimo → tabuleiro determinístico.
class ScriptedRandom implements RandomSource {
  private rolls: number[];
  private fallbackTick = 0;
  constructor(rolls: number[]) {
    this.rolls = [...rolls];
  }
  int(minInclusive: number): number {
    return minInclusive;
  }
  rollD6(): number {
    if (this.rolls.length) return this.rolls.shift() as number;
    this.fallbackTick = (this.fallbackTick % 6) + 1;
    return this.fallbackTick;
  }
}

function once<T = any>(
  socket: Socket,
  event: string,
  timeoutMs = 4000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout aguardando '${event}'`)),
      timeoutMs,
    );
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe('requestState (e2e)', () => {
  let app: INestApplication;
  let url: string;
  let redis: { flushall(): Promise<unknown> };

  beforeAll(async () => {
    redis = new RedisMock() as unknown as { flushall(): Promise<unknown> };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(REDIS_CLIENT)
      .useValue(redis)
      .overrideProvider(RANDOM_SOURCE)
      .useValue(new ScriptedRandom([2, 1]))
      .compile();

    app = moduleRef.createNestApplication();
    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await redis.flushall();
  });

  afterAll(async () => {
    await app.close();
  });

  function connect(): Socket {
    return io(url, { transports: ['websocket'], forceNew: true });
  }

  it('cliente em partida emite requestState e recebe gameState coerente', async () => {
    const c1 = connect();
    const c2 = connect();
    await Promise.all([once(c1, 'connect'), once(c2, 'connect')]);

    c1.emit('createSession', { name: 'Ana', difficulty: 'normal' });
    const created = await once<{ code: string; playerId: string }>(
      c1,
      'sessionCreated',
    );
    const joined = await new Promise<{ playerId: string }>((r) =>
      c2.emit('joinSession', { code: created.code, name: 'Bia' }, r),
    );
    // Inicia a partida e resolve a fase de ordem (RF-04) → status 'playing'.
    await startMatch(c1, [
      { socket: c1, playerId: created.playerId },
      { socket: c2, playerId: joined.playerId },
    ]);

    // Solicita resync sob demanda.
    const resyncP = once<{
      code: string;
      status: string;
      board: { size: number };
      players: { id: string; square: number }[];
    }>(c1, 'gameState');
    c1.emit('requestState');
    const snap = await resyncP;

    expect(snap.code).toBe(created.code);
    expect(snap.status).toBe('playing');
    expect(typeof snap.board.size).toBe('number');
    expect(snap.players).toHaveLength(2);

    c1.disconnect();
    c2.disconnect();
  }, 20000);

  it('socket sem sessão recebe error NOT_IN_SESSION', async () => {
    const stranger = connect();
    await once(stranger, 'connect');

    const errP = once<{ code: string }>(stranger, 'error');
    stranger.emit('requestState');
    const err = await errP;
    expect(err.code).toBe('NOT_IN_SESSION');

    stranger.disconnect();
  }, 10000);

  it('jogador que saiu (leaveSession) não consegue mais puxar gameState', async () => {
    const c1 = connect();
    const c2 = connect();
    await Promise.all([once(c1, 'connect'), once(c2, 'connect')]);

    c1.emit('createSession', { name: 'Ana', difficulty: 'normal' });
    const created = await once<{ code: string; playerId: string }>(
      c1,
      'sessionCreated',
    );
    // c2 entra e depois sai — seu socket.data ainda tem code/playerId.
    await new Promise((r) =>
      c2.emit('joinSession', { code: created.code, name: 'Bia' }, r),
    );
    const leftLobby = once<{ players: unknown[] }>(c1, 'lobbyState');
    c2.emit('leaveSession');
    await leftLobby;

    // Membership inválida → NOT_IN_SESSION, sem vazar o gameState da sessão.
    const errP = once<{ code: string }>(c2, 'error');
    c2.emit('requestState');
    expect((await errP).code).toBe('NOT_IN_SESSION');

    c1.disconnect();
    c2.disconnect();
  }, 20000);
});

describe('gameState snapshot (e2e)', () => {
  let app: INestApplication;
  let url: string;
  let redis: { flushall(): Promise<unknown> };

  beforeAll(async () => {
    redis = new RedisMock() as unknown as { flushall(): Promise<unknown> };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(REDIS_CLIENT)
      .useValue(redis)
      .overrideProvider(RANDOM_SOURCE)
      .useValue(new ScriptedRandom([2, 1]))
      .compile();

    app = moduleRef.createNestApplication();
    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await redis.flushall();
  });

  afterAll(async () => {
    await app.close();
  });

  function connect(): Socket {
    return io(url, { transports: ['websocket'], forceNew: true });
  }

  it('gameState (snapshot canônico) traz board procedural, players.square e turno', async () => {
    const c1 = connect();
    const c2 = connect();
    await Promise.all([once(c1, 'connect'), once(c2, 'connect')]);

    c1.emit('createSession', { name: 'Ana', difficulty: 'normal' });
    const created = await once<{ code: string; playerId: string }>(
      c1,
      'sessionCreated',
    );
    const joined = await new Promise<{ playerId: string }>((r) =>
      c2.emit('joinSession', { code: created.code, name: 'Bia' }, r),
    );

    // Inicia e resolve a ordem (RF-04); depois pede o snapshot canônico ('playing').
    await startMatch(c1, [
      { socket: c1, playerId: created.playerId },
      { socket: c2, playerId: joined.playerId },
    ]);

    const snapP = once<{
      code: string;
      status: string;
      difficulty: string;
      board: { size: number; tileTypeBySquare: Record<string, string> };
      players: { id: string; square: number }[];
      currentTurnPlayerId: string | null;
      winner: string | null;
      ranking: unknown[] | null;
    }>(c1, 'gameState');
    c1.emit('requestState');
    const snap = await snapP;

    expect(snap.status).toBe('playing');
    expect(typeof snap.board.size).toBe('number');
    expect(snap.board.size).toBeGreaterThanOrEqual(20);
    expect(snap.board.size).toBeLessThanOrEqual(30);
    expect(snap.players).toHaveLength(2);
    for (const p of snap.players) {
      expect(typeof p.square).toBe('number');
    }
    expect(snap.currentTurnPlayerId).toBeTruthy();
    expect(snap.winner).toBeNull();
    expect(snap.ranking).toBeNull();

    // Garante que socketId não vaza no snapshot.
    const serialized = JSON.stringify(snap);
    expect(serialized).not.toContain('socketId');
    expect(serialized).not.toContain('correctIndex');
    expect(serialized).not.toContain('pendingQuestion');

    c1.disconnect();
    c2.disconnect();
  }, 20000);
});
