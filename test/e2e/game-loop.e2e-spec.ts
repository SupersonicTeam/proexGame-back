import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'net';
import RedisMock from 'ioredis-mock';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../../src/app.module';
import { REDIS_CLIENT } from '../../src/redis/redis.constants';

// Helper: aguarda um evento do socket (com timeout) e resolve com o payload.
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

describe('Game loop (e2e)', () => {
  let app: INestApplication;
  let url: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Substitui o Redis real por um mock em memória para o e2e.
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

  it('dois jogadores completam uma partida até gameOver com turnos sincronizados', async () => {
    const c1 = connect();
    const c2 = connect();
    await Promise.all([once(c1, 'connect'), once(c2, 'connect')]);

    // c1 cria a sessão.
    c1.emit('createSession', { name: 'Ana', difficulty: 'normal' });
    const created = await once<{ code: string; playerId: string }>(
      c1,
      'sessionCreated',
    );
    const code = created.code;
    const p1 = created.playerId;

    // c2 entra; recebe o playerId pelo ack.
    const joined = await new Promise<{ playerId: string }>((resolve) => {
      c2.emit('joinSession', { code, name: 'Bia' }, resolve);
    });
    const p2 = joined.playerId;
    expect(p1).not.toBe(p2);

    const byId: Record<string, Socket> = { [p1]: c1, [p2]: c2 };

    // c1 (host) inicia; ambos recebem gameStarted e o primeiro turnChanged.
    const startedBoard = once<{ board: { size: number } }>(c1, 'gameStarted');
    const firstTurn = once<{ playerId: string }>(c1, 'turnChanged');
    c1.emit('startGame');
    const board = await startedBoard;
    // Tabuleiro agora é procedural (RF-06): tamanho em [20, 30].
    expect(board.board.size).toBeGreaterThanOrEqual(20);
    expect(board.board.size).toBeLessThanOrEqual(30);
    let current = (await firstTurn).playerId;

    // Driver do loop: o jogador da vez rola; ao receber uma pergunta, responde
    // (índice 0); seguimos até gameOver. Cobre tabuleiro procedural com perguntas.
    const gameOver = await new Promise<{ winner: string; ranking: any[] }>(
      (resolve, reject) => {
        const failTimer = setTimeout(
          () => reject(new Error('partida não terminou')),
          20000,
        );

        const onTurn = (p: { playerId: string }) => {
          current = p.playerId;
          byId[current]?.emit('rollDice');
        };
        const onPrompt =
          (sock: Socket) => (q: { questionId: string; options: string[] }) => {
            sock.emit('submitAnswer', {
              questionId: q.questionId,
              optionIndex: 0,
            });
          };
        const onPrompt1 = onPrompt(c1);
        const onPrompt2 = onPrompt(c2);
        const onOver = (payload: { winner: string; ranking: any[] }) => {
          clearTimeout(failTimer);
          c1.off('turnChanged', onTurn);
          c2.off('turnChanged', onTurn);
          c1.off('questionPrompt', onPrompt1);
          c2.off('questionPrompt', onPrompt2);
          resolve(payload);
        };
        c1.on('turnChanged', onTurn);
        c1.on('questionPrompt', onPrompt1);
        c2.on('questionPrompt', onPrompt2);
        c1.on('gameOver', onOver);
        c2.on('gameOver', onOver);

        // Dispara a primeira rolagem do jogador atual.
        byId[current]?.emit('rollDice');
      },
    );

    expect([p1, p2]).toContain(gameOver.winner);
    expect(gameOver.ranking).toHaveLength(2);
    expect(gameOver.ranking[0].playerId).toBe(gameOver.winner);

    c1.disconnect();
    c2.disconnect();
  }, 30000);

  it('rejeita rollDice fora da vez com error NOT_YOUR_TURN', async () => {
    const c1 = connect();
    const c2 = connect();
    await Promise.all([once(c1, 'connect'), once(c2, 'connect')]);

    c1.emit('createSession', { name: 'Ana', difficulty: 'normal' });
    const created = await once<{ code: string; playerId: string }>(
      c1,
      'sessionCreated',
    );
    await new Promise((r) =>
      c2.emit('joinSession', { code: created.code, name: 'Bia' }, r),
    );

    const firstTurn = once<{ playerId: string }>(c1, 'turnChanged');
    c1.emit('startGame');
    const current = (await firstTurn).playerId;

    // O jogador que NÃO é o da vez tenta rolar.
    const offTurnClient = current === created.playerId ? c2 : c1;
    const errPromise = once<{ code: string }>(offTurnClient, 'error');
    offTurnClient.emit('rollDice');
    const err = await errPromise;
    expect(err.code).toBe('NOT_YOUR_TURN');

    c1.disconnect();
    c2.disconnect();
  }, 15000);

  it('rejeita joinSession com código inexistente com SESSION_NOT_FOUND', async () => {
    const c1 = connect();
    await once(c1, 'connect');

    const errPromise = once<{ code: string }>(c1, 'error');
    c1.emit('joinSession', { code: '00000', name: 'Ana' });
    const err = await errPromise;
    expect(err.code).toBe('SESSION_NOT_FOUND');

    c1.disconnect();
  }, 15000);
});
