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

// RNG roteirizado: int() devolve sempre o mínimo do intervalo → tabuleiro
// determinístico (N=20, presídio na casa 1, perguntas nas casas 2..12, todas da
// 1ª matéria). rollD6() consome uma fila controlada pelo teste.
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
    // Fallback cicla 1..6 para nunca empatar a ordem (evita recursão infinita).
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

describe('Fluxo de pergunta + segurança (e2e)', () => {
  let app: INestApplication;
  let url: string;
  let redis: { flushall(): Promise<unknown> };

  beforeAll(async () => {
    redis = new RedisMock() as unknown as { flushall(): Promise<unknown> };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(REDIS_CLIENT)
      .useValue(redis)
      // Ordem [p1,p2]; p1 rola 2 → casa 2 (pergunta).
      .overrideProvider(RANDOM_SOURCE)
      .useValue(new ScriptedRandom([2, 1, 2]))
      .compile();

    app = moduleRef.createNestApplication();
    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}`;
  });

  // int() fixo torna o código de sessão determinístico; limpamos o Redis entre
  // os testes para o segundo createSession não colidir com o primeiro.
  afterEach(async () => {
    await redis.flushall();
  });

  afterAll(async () => {
    await app.close();
  });

  function connect(): Socket {
    return io(url, { transports: ['websocket'], forceNew: true });
  }

  it('dispara questionPrompt sem vazar a resposta e processa submitAnswer', async () => {
    const c1 = connect();
    const c2 = connect();
    await Promise.all([once(c1, 'connect'), once(c2, 'connect')]);

    c1.emit('createSession', { name: 'Ana', difficulty: 'normal' });
    const created = await once<{ code: string; playerId: string }>(
      c1,
      'sessionCreated',
    );
    const p1 = created.playerId;
    await new Promise((r) =>
      c2.emit('joinSession', { code: created.code, name: 'Bia' }, r),
    );

    const firstTurn = once<{ playerId: string }>(c1, 'turnChanged');
    c1.emit('startGame');
    const current = (await firstTurn).playerId;
    expect(current).toBe(p1); // ordem [p1, p2]

    // p1 rola 2 → cai na casa 2 (pergunta) → recebe questionPrompt.
    const promptP = once<{
      questionId: string;
      subject: string;
      statement: string;
      options: string[];
    }>(c1, 'questionPrompt');
    c1.emit('rollDice');
    const prompt = await promptP;

    // SEGURANÇA (RF-16): o payload tem questionId/subject/statement/options e
    // NUNCA expõe qual alternativa é a correta.
    expect(Object.keys(prompt).sort()).toEqual([
      'options',
      'questionId',
      'statement',
      'subject',
    ]);
    expect(prompt.options).toHaveLength(4);
    expect(typeof prompt.subject).toBe('string');
    const serialized = JSON.stringify(prompt);
    expect(serialized).not.toContain('correctIndex');
    expect(serialized).not.toContain('proximalIndex');

    // p1 responde (índice 0). answerResult é emitido para a sala.
    const answerP = once<{
      playerId: string;
      correct: boolean;
      errorType: string;
      toSquare: number;
      correctIndex: number;
    }>(c1, 'answerResult');
    c1.emit('submitAnswer', { questionId: prompt.questionId, optionIndex: 0 });
    const answer = await answerP;
    expect(answer.playerId).toBe(p1);
    expect(typeof answer.correct).toBe('boolean');
    expect(['none', 'proximal', 'wrong']).toContain(answer.errorType);
    // RF-16: o questionPrompt não revelou correctIndex; o answerResult deve revelar.
    expect(typeof answer.correctIndex).toBe('number');
    expect(answer.correctIndex).toBeGreaterThanOrEqual(0);
    expect(answer.correctIndex).toBeLessThan(prompt.options.length);

    c1.disconnect();
    c2.disconnect();
  }, 20000);

  it('rejeita submitAnswer sem pergunta pendente com NO_PENDING_QUESTION', async () => {
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
    await firstTurn;

    // p1 ainda não rolou → não há pergunta pendente.
    const errP = once<{ code: string }>(c1, 'error');
    c1.emit('submitAnswer', { questionId: 'mat-0001', optionIndex: 0 });
    expect((await errP).code).toBe('NO_PENDING_QUESTION');

    c1.disconnect();
    c2.disconnect();
  }, 20000);
});
