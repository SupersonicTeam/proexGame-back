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
import { once, startMatch } from './helpers';

// RNG roteirizado: int() retorna o mínimo → tabuleiro determinístico; rolagens de
// d6 vêm da fila (resolvem a fase de ordem RF-04 sem empate).
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

interface PlayerView {
  id: string;
  color?: string;
  emoji?: string;
}

// Aguarda um snapshot (gameState/lobbyState) cujo predicado bata, IGNORANDO
// snapshots anteriores "em trânsito" — ex.: o gameState do orderResult que chega
// ao não-host depois de startMatch resolver no host. Evita flakiness por corrida.
function waitForState(
  socket: Socket,
  event: 'gameState' | 'lobbyState',
  predicate: (s: { players: PlayerView[] }) => boolean,
  timeoutMs = 8000,
): Promise<{ players: PlayerView[] }> {
  return new Promise((resolve, reject) => {
    const onState = (s: { players: PlayerView[] }) => {
      if (!predicate(s)) return;
      clearTimeout(timer);
      socket.off(event, onState);
      resolve(s);
    };
    const timer = setTimeout(() => {
      socket.off(event, onState);
      reject(
        new Error(`timeout aguardando '${event}' que satisfaça o predicado`),
      );
    }, timeoutMs);
    socket.on(event, onState);
  });
}

// CONTRACT-S5: aparência cosmética (cor + emoji) do peão. Aditivo e sem impacto
// em regras — só verifica que a escolha de um jogador chega a TODOS pela sala.
describe('setAppearance (e2e)', () => {
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

  it('propaga cor/emoji escolhidos a toda a sala via lobbyState', async () => {
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

    // c2 escolhe a aparência; c1 (a sala) deve enxergar a escolha no lobbyState.
    const lobbyP = waitForState(
      c1,
      'lobbyState',
      (s) =>
        s.players.find((p) => p.id === joined.playerId)?.color === '#ff8800',
    );
    c2.emit('setAppearance', { color: '#ff8800', emoji: '🦊' });
    const lobby = await lobbyP;

    const bia = lobby.players.find((p) => p.id === joined.playerId)!;
    expect(bia.color).toBe('#ff8800');
    expect(bia.emoji).toBe('🦊');
    // Quem não escolheu não ganha os campos (fallback do front).
    const ana = lobby.players.find((p) => p.id === created.playerId)!;
    expect(ana.color).toBeUndefined();
    expect(ana.emoji).toBeUndefined();

    c1.disconnect();
    c2.disconnect();
  }, 20000);

  it('atualiza a aparência em jogo via gameState', async () => {
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
    await startMatch(c1, [
      { socket: c1, playerId: created.playerId },
      { socket: c2, playerId: joined.playerId },
    ]);

    // Em 'playing' o rebroadcast é por gameState; c2 deve ver a escolha de c1.
    const gsP = waitForState(
      c2,
      'gameState',
      (s) =>
        s.players.find((p) => p.id === created.playerId)?.color === '#00aa55',
    );
    c1.emit('setAppearance', { color: '#00aa55', emoji: '🐸' });
    const gs = await gsP;

    const ana = gs.players.find((p) => p.id === created.playerId)!;
    expect(ana.color).toBe('#00aa55');
    expect(ana.emoji).toBe('🐸');

    c1.disconnect();
    c2.disconnect();
  }, 20000);

  it('rejeita payload malformado com error INVALID_PAYLOAD', async () => {
    const c1 = connect();
    await once(c1, 'connect');
    c1.emit('createSession', { name: 'Ana', difficulty: 'normal' });
    await once(c1, 'sessionCreated');

    const errP = once<{ code: string }>(c1, 'error');
    c1.emit('setAppearance', { color: 'nao-e-hex', emoji: '😀' });
    expect((await errP).code).toBe('INVALID_PAYLOAD');

    c1.disconnect();
  }, 15000);
});
