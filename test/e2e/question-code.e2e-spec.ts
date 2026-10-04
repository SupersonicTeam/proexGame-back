import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';
import RedisMock from 'ioredis-mock';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../../src/app.module';
import {
  RANDOM_SOURCE,
  RandomSource,
} from '../../src/common/random/random.source';
import { REDIS_CLIENT } from '../../src/redis/redis.constants';
import { once, startMatch } from './helpers';

// Feature logica-programacao (PROG-07): o pseudocódigo (`code`) chega ao
// jogador pelo WebSocket, idêntico ao do banco, sem quebrar o RF-16. Usa um
// banco-fixture (QUESTIONS_DIR) com uma única matéria cujas perguntas têm code.

// RNG roteirizado: int() devolve o mínimo → tabuleiro determinístico (easy:
// N=30, presídio na casa 1, perguntas a partir da casa 2) e sempre a 1ª
// pergunta disponível do nível.
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

const CODE =
  's <- 0\npara i de 1 ate 4 faca\n  s <- s + i\nfimpara\nescreva(s)';

const FIXTURE = [
  {
    id: 'laco-9001',
    subject: 'lacos-de-repeticao',
    difficulty: 'easy',
    statement: 'O que este algoritmo mostra?',
    code: CODE,
    correct: '10',
    proximal: '6',
    wrong: ['4', '1234'],
  },
];

describe('questionPrompt com pseudocódigo (e2e)', () => {
  let app: INestApplication;
  let url: string;
  let dir: string;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qcode-e2e-'));
    fs.writeFileSync(
      path.join(dir, 'lacos-de-repeticao.json'),
      JSON.stringify(FIXTURE),
      'utf-8',
    );
    process.env.QUESTIONS_DIR = dir;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(REDIS_CLIENT)
      .useValue(new RedisMock())
      // Ordem [p1,p2]; p1 rola 2 → casa 2 (pergunta).
      .overrideProvider(RANDOM_SOURCE)
      .useValue(new ScriptedRandom([2, 1, 2]))
      .compile();

    app = moduleRef.createNestApplication();
    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}`;
  });

  // Limpa a env ANTES de fechar o app (que pode lançar se o beforeAll falhou):
  // o banco-fixture não pode vazar para outras suítes do mesmo worker.
  afterAll(async () => {
    delete process.env.QUESTIONS_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
    await app?.close();
  });

  function connect(): Socket {
    return io(url, { transports: ['websocket'], forceNew: true });
  }

  it('entrega code idêntico ao do banco e continua sem revelar a correta', async () => {
    const c1 = connect();
    const c2 = connect();
    await Promise.all([once(c1, 'connect'), once(c2, 'connect')]);

    c1.emit('createSession', { name: 'Ana', difficulty: 'easy' });
    const created = await once<{ code: string; playerId: string }>(
      c1,
      'sessionCreated',
    );
    const joined = await new Promise<{ playerId: string }>((r) =>
      c2.emit('joinSession', { code: created.code, name: 'Bia' }, r),
    );
    const { firstPlayerId } = await startMatch(c1, [
      { socket: c1, playerId: created.playerId },
      { socket: c2, playerId: joined.playerId },
    ]);
    expect(firstPlayerId).toBe(created.playerId);

    const promptP = once<Record<string, unknown>>(c1, 'questionPrompt');
    c1.emit('rollDice');
    const prompt = await promptP;

    expect(prompt.questionId).toBe('laco-9001');
    expect(prompt.subject).toBe('lacos-de-repeticao');
    expect(prompt.code).toBe(CODE);
    expect(Object.keys(prompt).sort()).toEqual([
      'code',
      'options',
      'questionId',
      'statement',
      'subject',
    ]);
    const serialized = JSON.stringify(prompt);
    expect(serialized).not.toContain('correctIndex');
    expect(serialized).not.toContain('proximalIndex');

    c1.disconnect();
    c2.disconnect();
  }, 20000);
});
