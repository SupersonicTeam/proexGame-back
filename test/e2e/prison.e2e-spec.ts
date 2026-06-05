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

// int() sempre no mínimo → tabuleiro determinístico: N=20, presídio na casa 1.
// rollD6: ordem [p1,p2] = [2,1]; depois cada jogador rola 1 → ambos caem na
// casa 1 (presídio).
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

describe('Casa de presídio (e2e)', () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(REDIS_CLIENT)
      .useValue(new RedisMock())
      .overrideProvider(RANDOM_SOURCE)
      .useValue(new ScriptedRandom([2, 1, 1, 1]))
      .compile();

    app = moduleRef.createNestApplication();
    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  function connect(): Socket {
    return io(url, { transports: ['websocket'], forceNew: true });
  }

  it('cair em presídio via dado faz perder a próxima jogada (turnSkipped)', async () => {
    const c1 = connect();
    const c2 = connect();
    await Promise.all([once(c1, 'connect'), once(c2, 'connect')]);

    c1.emit('createSession', { name: 'Ana', difficulty: 'normal' });
    const created = await once<{ code: string; playerId: string }>(
      c1,
      'sessionCreated',
    );
    const p1 = created.playerId;
    const joined = await new Promise<{ playerId: string }>((r) =>
      c2.emit('joinSession', { code: created.code, name: 'Bia' }, r),
    );
    const p2 = joined.playerId;

    // Coletor de turnSkipped (broadcast — escuto em c1).
    const skipped: { playerId: string; remaining: number }[] = [];
    c1.on('turnSkipped', (s: { playerId: string; remaining: number }) =>
      skipped.push(s),
    );

    const startedBoard = once<{
      board: { tileTypeBySquare: Record<string, string> };
    }>(c1, 'gameStarted');
    const firstTurn = once<{ playerId: string }>(c1, 'turnChanged');
    c1.emit('startGame');

    // Tabuleiro determinístico: casa 1 é presídio.
    const board = await startedBoard;
    expect(board.board.tileTypeBySquare['1']).toBe('prison');
    expect((await firstTurn).playerId).toBe(p1);

    // p1 rola 1 → casa 1 (presídio). NÃO recebe pergunta; turno passa para p2.
    const p1Dice = once<{ playerId: string; toSquare: number }>(
      c1,
      'diceResult',
    );
    const turnToP2 = once<{ playerId: string }>(c1, 'turnChanged');
    c1.emit('rollDice');
    const d1 = await p1Dice;
    expect(d1.playerId).toBe(p1);
    expect(d1.toSquare).toBe(1);
    expect((await turnToP2).playerId).toBe(p2);

    // p2 rola 1 → casa 1 (presídio). Ao voltar o turno, ambos estão presos:
    // a engine drena os skips emitindo turnSkipped para p1 e p2.
    c2.emit('rollDice');
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error('turnSkipped não emitido para ambos')),
        5000,
      );
      const check = () => {
        const ids = skipped.map((s) => s.playerId);
        if (ids.includes(p1) && ids.includes(p2)) {
          clearTimeout(t);
          resolve();
        }
      };
      c1.on('turnSkipped', check);
      check();
    });

    const remainingById = Object.fromEntries(
      skipped.map((s) => [s.playerId, s.remaining]),
    );
    expect(remainingById[p1]).toBe(0);
    expect(remainingById[p2]).toBe(0);

    c1.disconnect();
    c2.disconnect();
  }, 20000);
});
