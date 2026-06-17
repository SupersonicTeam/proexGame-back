import Redis from 'ioredis';
import RedisMock from 'ioredis-mock';
import { DefaultRandomSource } from '../common/random/default-random.source';
import { GameService } from '../game/game.service';
import { ReconnectService } from '../session/reconnect.service';
import { SessionLock } from '../session/session.lock';
import { SessionRepository } from '../session/session.repository';
import { SessionService } from '../session/session.service';
import { Player, SessionState } from '../session/session.types';
import { GameGateway } from './game.gateway';

// Monta um Player conectado mínimo para semear o estado direto no repositório.
function makePlayer(id: string, name: string): Player {
  return {
    id,
    name,
    socketId: `sock-${id}`,
    square: 0,
    connected: true,
    isHost: id === 'p1',
    usedQuestionIds: [],
    skipTurns: 0,
    pendingQuestion: null,
  };
}

function makeState(
  code: string,
  status: SessionState['status'],
  playerIds: string[],
): SessionState {
  return {
    code,
    status,
    difficulty: 'normal',
    board: {
      size: 25,
      tileTypeBySquare: { 0: 'start', 25: 'finish' },
      subjectBySquare: {},
    },
    players: playerIds.map((id) => makePlayer(id, id)),
    turnOrder: status === 'playing' ? [...playerIds] : [],
    currentTurnIndex: 0,
    winner: null,
    createdAt: '2026-06-03T00:00:00.000Z',
    lastActivityAt: '2026-06-03T00:00:00.000Z',
    servedQuestionIds: [],
    ordering: null,
  };
}

describe('GameGateway.onApplicationBootstrap (reconciliação de grace — achado #2)', () => {
  let repo: SessionRepository;
  let reconnects: ReconnectService;
  let gateway: GameGateway;

  beforeEach(async () => {
    const client = new RedisMock() as unknown as Redis;
    // ioredis-mock compartilha o store entre instâncias — limpa para isolar o teste.
    await client.flushall();
    repo = new SessionRepository(client);
    const sessions = new SessionService(
      repo,
      new DefaultRandomSource(),
      new SessionLock(),
    );
    reconnects = new ReconnectService();
    // GameService não é exercido no boot; um stub vazio basta.
    const games = {} as GameService;
    gateway = new GameGateway(sessions, games, reconnects);
    // this.server fica indefinido (não há @WebSocketServer injetado no teste); a
    // rotina de boot é emit-free, então isso não deve quebrar nada.
  });

  it('marca todos os jogadores de uma sessão ativa como desconectados e rearma o grace', async () => {
    await repo.create(makeState('12345', 'playing', ['p1', 'p2']));

    await gateway.onApplicationBootstrap();

    const stored = await repo.findByCode('12345');
    expect(stored).not.toBeNull();
    expect(stored!.players.every((p) => !p.connected)).toBe(true);
    expect(reconnects.has('12345', 'p1')).toBe(true);
    expect(reconnects.has('12345', 'p2')).toBe(true);
  });

  it('NÃO marca nem rearma jogadores de uma sessão já finalizada', async () => {
    await repo.create(makeState('99999', 'finished', ['p1', 'p2']));

    await gateway.onApplicationBootstrap();

    const stored = await repo.findByCode('99999');
    // Estado finalizado não é tocado: jogadores seguem connected=true.
    expect(stored!.players.every((p) => p.connected)).toBe(true);
    expect(reconnects.has('99999', 'p1')).toBe(false);
    expect(reconnects.has('99999', 'p2')).toBe(false);
  });

  it('reconcilia múltiplas sessões ativas e ignora a finalizada na mesma varredura', async () => {
    await repo.create(makeState('11111', 'lobby', ['a1', 'a2']));
    await repo.create(makeState('22222', 'playing', ['b1', 'b2']));
    await repo.create(makeState('33333', 'finished', ['c1', 'c2']));

    await gateway.onApplicationBootstrap();

    for (const code of ['11111', '22222']) {
      const stored = await repo.findByCode(code);
      expect(stored!.players.every((p) => !p.connected)).toBe(true);
      for (const p of stored!.players) {
        expect(reconnects.has(code, p.id)).toBe(true);
      }
    }
    const finished = await repo.findByCode('33333');
    expect(finished!.players.every((p) => p.connected)).toBe(true);
    expect(reconnects.has('33333', 'c1')).toBe(false);
  });
});
