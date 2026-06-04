import { ErrorCode } from '../common/errors/game-error';
import { RandomSource } from '../common/random/random.source';
import { SessionRepository } from '../session/session.repository';
import { Player, SessionState } from '../session/session.types';
import { GameService } from './game.service';

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

class FakeRandomSource implements RandomSource {
  private queue: number[];
  constructor(values: number[]) {
    this.queue = [...values];
  }
  int(): number {
    return this.queue.shift() as number;
  }
  rollD6(): number {
    return this.int();
  }
}

function makePlayer(over: Partial<Player> & { id: string }): Player {
  return {
    name: over.id,
    socketId: `sock-${over.id}`,
    square: 0,
    connected: true,
    isHost: false,
    ...over,
  };
}

function seedState(
  repo: InMemoryRepo,
  players: Player[],
  over: Partial<SessionState> = {},
) {
  const state: SessionState = {
    code: '12345',
    status: 'playing',
    difficulty: 'normal',
    board: { size: 25, tileTypeBySquare: { 0: 'start', 25: 'finish' } },
    players,
    turnOrder: players.map((p) => p.id),
    currentTurnIndex: 0,
    winner: null,
    createdAt: '2026-06-03T00:00:00.000Z',
    lastActivityAt: '2026-06-03T00:00:00.000Z',
    ...over,
  };
  repo.store.set(state.code, structuredClone(state));
  return state;
}

function build(rngValues: number[]) {
  const repo = new InMemoryRepo();
  const rng = new FakeRandomSource(rngValues);
  const service = new GameService(repo as unknown as SessionRepository, rng);
  return { repo, service };
}

describe('GameService.resolveTurnOrder', () => {
  it('define a ordem de turnos por rolagem e zera o índice', async () => {
    const { repo, service } = build([2, 6]); // a=2, b=6 → ordem b, a
    seedState(repo, [makePlayer({ id: 'a' }), makePlayer({ id: 'b' })]);
    const { state, rolls } = await service.resolveTurnOrder('12345');
    expect(state.turnOrder).toEqual(['b', 'a']);
    expect(state.currentTurnIndex).toBe(0);
    expect(rolls).toHaveLength(2);
  });
});

describe('GameService.applyDiceRoll', () => {
  it('move o jogador da vez e passa o turno (sem vitória)', async () => {
    const { repo, service } = build([3]);
    seedState(repo, [makePlayer({ id: 'a' }), makePlayer({ id: 'b' })]);
    const out = await service.applyDiceRoll('12345', 'a');
    expect(out.value).toBe(3);
    expect(out.fromSquare).toBe(0);
    expect(out.toSquare).toBe(3);
    expect(out.isWin).toBe(false);
    expect(out.nextPlayerId).toBe('b');
    expect(out.state.players.find((p) => p.id === 'a')!.square).toBe(3);
    expect(out.state.currentTurnIndex).toBe(1);
  });

  it('declara vitória ao atingir/ultrapassar N (chega-ou-passa)', async () => {
    const { repo, service } = build([5]);
    seedState(repo, [
      makePlayer({ id: 'a', square: 22 }),
      makePlayer({ id: 'b', square: 10 }),
    ]);
    const out = await service.applyDiceRoll('12345', 'a');
    expect(out.isWin).toBe(true);
    expect(out.toSquare).toBe(25);
    expect(out.state.status).toBe('finished');
    expect(out.state.winner).toBe('a');
    expect(out.ranking).not.toBeNull();
    expect(out.ranking!.map((r) => r.playerId)).toEqual(['a', 'b']);
  });

  it('rejeita rolagem fora da vez com NOT_YOUR_TURN', async () => {
    const { repo, service } = build([3]);
    seedState(repo, [makePlayer({ id: 'a' }), makePlayer({ id: 'b' })]);
    await expect(service.applyDiceRoll('12345', 'b')).rejects.toMatchObject({
      code: ErrorCode.NOT_YOUR_TURN,
    });
  });

  it('rejeita rolagem com jogo não-ativo com GAME_NOT_ACTIVE', async () => {
    const { repo, service } = build([3]);
    seedState(repo, [makePlayer({ id: 'a' }), makePlayer({ id: 'b' })], {
      status: 'lobby',
    });
    await expect(service.applyDiceRoll('12345', 'a')).rejects.toMatchObject({
      code: ErrorCode.GAME_NOT_ACTIVE,
    });
  });

  it('rejeita rolagem em sessão inexistente com SESSION_NOT_FOUND', async () => {
    const { service } = build([3]);
    await expect(service.applyDiceRoll('00000', 'a')).rejects.toMatchObject({
      code: ErrorCode.SESSION_NOT_FOUND,
    });
  });

  it('rejeita rolagem quando a ordem ainda não foi resolvida (turnOrder vazio)', async () => {
    const { repo, service } = build([3]);
    seedState(repo, [makePlayer({ id: 'a' }), makePlayer({ id: 'b' })], {
      turnOrder: [],
    });
    await expect(service.applyDiceRoll('12345', 'a')).rejects.toMatchObject({
      code: ErrorCode.GAME_NOT_ACTIVE,
    });
  });

  it('rejeita novas rolagens após a partida terminar', async () => {
    const { repo, service } = build([5, 3]);
    seedState(repo, [
      makePlayer({ id: 'a', square: 22 }),
      makePlayer({ id: 'b', square: 10 }),
    ]);
    await service.applyDiceRoll('12345', 'a'); // a vence, status = finished
    await expect(service.applyDiceRoll('12345', 'b')).rejects.toMatchObject({
      code: ErrorCode.GAME_NOT_ACTIVE,
    });
  });

  it('pula jogador desconectado ao passar o turno', async () => {
    const { repo, service } = build([2]);
    seedState(repo, [
      makePlayer({ id: 'a' }),
      makePlayer({ id: 'b', connected: false }),
      makePlayer({ id: 'c' }),
    ]);
    const out = await service.applyDiceRoll('12345', 'a');
    expect(out.nextPlayerId).toBe('c');
    expect(out.state.currentTurnIndex).toBe(2);
  });
});

describe('GameService.passTurnIfDisconnected', () => {
  it('passa a vez quando o jogador atual está desconectado', async () => {
    const { repo, service } = build([]);
    seedState(
      repo,
      [makePlayer({ id: 'a', connected: false }), makePlayer({ id: 'b' })],
      { currentTurnIndex: 0 },
    );
    const result = await service.passTurnIfDisconnected('12345');
    expect(result).not.toBeNull();
    expect(result!.nextPlayerId).toBe('b');
    expect(result!.state.currentTurnIndex).toBe(1);
  });

  it('não faz nada quando o jogador atual está conectado', async () => {
    const { repo, service } = build([]);
    seedState(repo, [makePlayer({ id: 'a' }), makePlayer({ id: 'b' })], {
      currentTurnIndex: 0,
    });
    expect(await service.passTurnIfDisconnected('12345')).toBeNull();
  });

  it('retorna null quando a ordem ainda não foi resolvida (turnOrder vazio)', async () => {
    const { repo, service } = build([]);
    seedState(
      repo,
      [makePlayer({ id: 'a', connected: false }), makePlayer({ id: 'b' })],
      { turnOrder: [] },
    );
    expect(await service.passTurnIfDisconnected('12345')).toBeNull();
  });
});
