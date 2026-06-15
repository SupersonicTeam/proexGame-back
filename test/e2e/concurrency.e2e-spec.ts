import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'net';
import RedisMock from 'ioredis-mock';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../../src/app.module';
import { REDIS_CLIENT } from '../../src/redis/redis.constants';
import { once, startMatch } from './helpers';

// Achado P2 — double-click em rollDice. Sob o SessionLock, duas rolagens
// quase-simultâneas do MESMO jogador são serializadas: a 1ª é processada
// (exatamente um diceResult) e a 2ª é rejeitada. O código de erro depende de
// onde a 1ª aterrissou — mas o invariante (1 diceResult + 1 error) vale para
// qualquer tabuleiro, o que torna o teste determinístico:
//  - casa normal/presídio → turno passa → NOT_YOUR_TURN;
//  - vitória               → partida encerra → GAME_NOT_ACTIVE;
//  - casa-pergunta         → turno NÃO passa → ANSWER_PENDING (guarda do P2).
describe('Concorrência — double-click rollDice (e2e)', () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
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

  it('processa apenas UMA rolagem; a segunda emissão recebe error', async () => {
    const c1 = connect();
    const c2 = connect();
    await Promise.all([once(c1, 'connect'), once(c2, 'connect')]);

    c1.emit('createSession', { name: 'Ana', difficulty: 'normal' });
    const created = await once<{ code: string; playerId: string }>(
      c1,
      'sessionCreated',
    );
    const joined = await new Promise<{ playerId: string }>((resolve) => {
      c2.emit('joinSession', { code: created.code, name: 'Bia' }, resolve);
    });

    const byId: Record<string, Socket> = {
      [created.playerId]: c1,
      [joined.playerId]: c2,
    };
    const { firstPlayerId } = await startMatch(c1, [
      { socket: c1, playerId: created.playerId },
      { socket: c2, playerId: joined.playerId },
    ]);
    const roller = byId[firstPlayerId];

    // Conta os diceResult recebidos (broadcast para a sala) e captura o error.
    let diceResults = 0;
    roller.on('diceResult', () => {
      diceResults += 1;
    });
    const errorReceived = once<{ code: string }>(roller, 'error');

    // Double-click: duas emissões em sequência imediata, sem aguardar entre elas.
    roller.emit('rollDice');
    roller.emit('rollDice');

    const err = await errorReceived;
    expect(['NOT_YOUR_TURN', 'GAME_NOT_ACTIVE', 'ANSWER_PENDING']).toContain(
      err.code,
    );

    // Folga curta para garantir que nenhum segundo diceResult chega depois.
    await new Promise((r) => setTimeout(r, 200));
    expect(diceResults).toBe(1);

    c1.disconnect();
    c2.disconnect();
  }, 20000);
});
