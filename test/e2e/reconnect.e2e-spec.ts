import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'net';
import RedisMock from 'ioredis-mock';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../../src/app.module';
import { REDIS_CLIENT } from '../../src/redis/redis.constants';

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

describe('Reconexão (e2e)', () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(REDIS_CLIENT)
      .useValue(new RedisMock())
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

  it('reconecta um jogador dentro da janela de grace e restaura o estado', async () => {
    const c1 = connect();
    const c2 = connect();
    await Promise.all([once(c1, 'connect'), once(c2, 'connect')]);

    c1.emit('createSession', { name: 'Ana', difficulty: 'normal' });
    const created = await once<{ code: string; playerId: string }>(
      c1,
      'sessionCreated',
    );
    const code = created.code;
    const joined = await new Promise<{ playerId: string }>((r) =>
      c2.emit('joinSession', { code, name: 'Bia' }, r),
    );
    const p2 = joined.playerId;

    // c2 cai; c1 deve ver playerDisconnected.
    const disconnected = once<{ playerId: string }>(c1, 'playerDisconnected');
    c2.disconnect();
    expect((await disconnected).playerId).toBe(p2);

    // Novo socket reconecta com {code, playerId} dentro do grace.
    const c3 = connect();
    await once(c3, 'connect');
    const reconnected = once<{ playerId: string }>(c1, 'playerReconnected');
    const lobby = once<{
      players: { id: string; connected: boolean }[];
    }>(c3, 'lobbyState');
    c3.emit('reconnect', { code, playerId: p2 });

    expect((await reconnected).playerId).toBe(p2);
    const state = await lobby;
    const me = state.players.find((p) => p.id === p2)!;
    expect(me.connected).toBe(true);

    c1.disconnect();
    c3.disconnect();
  }, 20000);

  it('rejeita reconnect com playerId inexistente (RECONNECT_FAILED)', async () => {
    const c1 = connect();
    await once(c1, 'connect');
    c1.emit('createSession', { name: 'Ana', difficulty: 'normal' });
    const created = await once<{ code: string; playerId: string }>(
      c1,
      'sessionCreated',
    );

    const c2 = connect();
    await once(c2, 'connect');
    const errP = once<{ code: string }>(c2, 'error');
    c2.emit('reconnect', { code: created.code, playerId: 'fantasma' });
    expect((await errP).code).toBe('RECONNECT_FAILED');

    c1.disconnect();
    c2.disconnect();
  }, 20000);
});
