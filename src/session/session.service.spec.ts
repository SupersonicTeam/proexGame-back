import { ErrorCode } from '../common/errors/game-error';
import { RandomSource } from '../common/random/random.source';
import { SessionLock } from './session.lock';
import { SessionRepository } from './session.repository';
import { SessionService } from './session.service';
import { SessionState } from './session.types';

// Repositório em memória para testar o serviço sem Redis.
class InMemoryRepo {
  store = new Map<string, SessionState>();
  create(s: SessionState) {
    this.store.set(s.code, structuredClone(s));
    return Promise.resolve();
  }
  createIfAbsent(s: SessionState) {
    if (this.store.has(s.code)) return Promise.resolve(false);
    this.store.set(s.code, structuredClone(s));
    return Promise.resolve(true);
  }
  findByCode(c: string) {
    const s = this.store.get(c);
    return Promise.resolve(s ? structuredClone(s) : null);
  }
  save(s: SessionState) {
    s.lastActivityAt = new Date().toISOString();
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

// RNG fixo: dígitos para o código + valores subsequentes.
class FakeRandomSource implements RandomSource {
  private queue: number[];
  constructor(values: number[]) {
    this.queue = [...values];
  }
  int(): number {
    return this.queue.length ? (this.queue.shift() as number) : 0;
  }
  rollD6(): number {
    return this.int();
  }
}

function build(rngValues: number[] = [1, 2, 3, 4, 5]) {
  const repo = new InMemoryRepo();
  const rng = new FakeRandomSource(rngValues);
  const service = new SessionService(
    repo as unknown as SessionRepository,
    rng,
    new SessionLock(),
  );
  return { repo, service };
}

describe('SessionService.createSession', () => {
  it('cria sessão em lobby com o criador como host', async () => {
    const { service } = build();
    const { state, playerId } = await service.createSession(
      'Ana',
      'normal',
      'sock-1',
    );
    expect(state.code).toBe('12345');
    expect(state.status).toBe('lobby');
    expect(state.players).toHaveLength(1);
    const host = state.players[0];
    expect(host.id).toBe(playerId);
    expect(host.isHost).toBe(true);
    expect(host.name).toBe('Ana');
    expect(host.square).toBe(0);
  });

  it('re-gera o código quando colide com uma sessão existente', async () => {
    // Primeiro código 12345 (ocupado); segundo 67890 (livre) → re-gera.
    const { repo, service } = build([1, 2, 3, 4, 5, 6, 7, 8, 9, 0]);
    repo.store.set('12345', {} as SessionState); // ocupa o primeiro código
    const { state } = await service.createSession('Ana', 'normal', 'sock-1');
    expect(state.code).toBe('67890');
  });

  it('rejeita nome vazio com INVALID_NAME', async () => {
    const { service } = build();
    await expect(
      service.createSession('   ', 'normal', 'sock-1'),
    ).rejects.toMatchObject({
      code: ErrorCode.INVALID_NAME,
    });
  });
});

describe('SessionService — saneamento do nome', () => {
  const NAME_LIMIT = 24;

  it('mantém um nome exatamente no limite de 24 caracteres', async () => {
    const { service } = build();
    const name = 'A'.repeat(NAME_LIMIT);
    const { state } = await service.createSession(name, 'normal', 'sock-1');
    expect(state.players[0].name).toBe(name);
    expect(state.players[0].name).toHaveLength(NAME_LIMIT);
  });

  it('trunca um nome acima do limite para 24 caracteres', async () => {
    const { service } = build();
    const name = 'A'.repeat(NAME_LIMIT + 10);
    const { state } = await service.createSession(name, 'normal', 'sock-1');
    expect(state.players[0].name).toBe('A'.repeat(NAME_LIMIT));
    expect(state.players[0].name).toHaveLength(NAME_LIMIT);
  });

  it('remove caracteres de controle, preservando espaços internos', async () => {
    const { service } = build();
    // NUL e BEL no meio, DEL no fim → removidos; o espaço entre nomes fica.
    const { state } = await service.createSession(
      'An\x00a \x07Bia\x7f',
      'normal',
      'sock-1',
    );
    expect(state.players[0].name).toBe('Ana Bia');
  });

  it('rejeita com INVALID_NAME um nome só com caracteres de controle', async () => {
    const { service } = build();
    await expect(
      service.createSession('\x00\x07\x7f', 'normal', 'sock-1'),
    ).rejects.toMatchObject({
      code: ErrorCode.INVALID_NAME,
    });
  });

  it('trunca por code points sem quebrar um par substituto (emoji)', async () => {
    const { service } = build();
    // 23 letras + emoji (2 unidades UTF-16) no exato limite, + sobra a descartar.
    const name = 'A'.repeat(NAME_LIMIT - 1) + '😀' + 'BBB';
    const { state } = await service.createSession(name, 'normal', 'sock-1');
    const result = state.players[0].name;
    // 24 code points, com o emoji preservado inteiro (sem surrogate solitário).
    expect(Array.from(result)).toHaveLength(NAME_LIMIT);
    expect(result).toBe('A'.repeat(NAME_LIMIT - 1) + '😀');
  });
});

describe('SessionService.joinSession', () => {
  async function withLobby() {
    const ctx = build([1, 2, 3, 4, 5]);
    const created = await ctx.service.createSession('Ana', 'normal', 'sock-1');
    return { ...ctx, code: created.state.code };
  }

  it('adiciona um segundo jogador ao lobby', async () => {
    const { service, code } = await withLobby();
    const { state, playerId } = await service.joinSession(
      code,
      'Bia',
      'sock-2',
    );
    expect(state.players).toHaveLength(2);
    expect(
      state.players.some((p) => p.id === playerId && p.name === 'Bia'),
    ).toBe(true);
    expect(state.players[1].isHost).toBe(false);
  });

  it('rejeita código inexistente com SESSION_NOT_FOUND', async () => {
    const { service } = build();
    await expect(
      service.joinSession('00000', 'Bia', 'sock-2'),
    ).rejects.toMatchObject({
      code: ErrorCode.SESSION_NOT_FOUND,
    });
  });

  it('rejeita nome vazio com INVALID_NAME', async () => {
    const { service, code } = await withLobby();
    await expect(service.joinSession(code, '', 'sock-2')).rejects.toMatchObject(
      {
        code: ErrorCode.INVALID_NAME,
      },
    );
  });

  it('rejeita entrada quando o lobby está cheio (4) com SESSION_FULL', async () => {
    const { service, code } = await withLobby();
    await service.joinSession(code, 'Bia', 'sock-2');
    await service.joinSession(code, 'Caio', 'sock-3');
    await service.joinSession(code, 'Davi', 'sock-4');
    await expect(
      service.joinSession(code, 'Eva', 'sock-5'),
    ).rejects.toMatchObject({
      code: ErrorCode.SESSION_FULL,
    });
  });

  it('rejeita entrada em sessão já iniciada com SESSION_ALREADY_STARTED', async () => {
    const { service, code } = await withLobby();
    await service.joinSession(code, 'Bia', 'sock-2');
    await service.startGame(
      code,
      (await service.getState(code))!.players[0].id,
    );
    await expect(
      service.joinSession(code, 'Caio', 'sock-3'),
    ).rejects.toMatchObject({
      code: ErrorCode.SESSION_ALREADY_STARTED,
    });
  });
});

describe('SessionService.startGame', () => {
  async function withTwoPlayers() {
    const ctx = build([1, 2, 3, 4, 5]);
    const host = await ctx.service.createSession('Ana', 'normal', 'sock-1');
    await ctx.service.joinSession(host.state.code, 'Bia', 'sock-2');
    return { ...ctx, code: host.state.code, hostId: host.playerId };
  }

  it('host inicia: entra na fase de ordem (status ordering) e zera os peões', async () => {
    const { service, code, hostId } = await withTwoPlayers();
    const state = await service.startGame(code, hostId);
    // RF-04: o jogo entra na fase de ordem; vira 'playing' só após as rolagens.
    expect(state.status).toBe('ordering');
    // P3: startGame não gera board; o placeholder do lobby (size 25) persiste até
    // o GameService.setupBoard gerar o procedural.
    expect(state.board.tileTypeBySquare[0]).toBe('start');
    expect(state.players.every((p) => p.square === 0)).toBe(true);
  });

  it('rejeita início por quem não é host com NOT_HOST', async () => {
    const { service, code } = await withTwoPlayers();
    const nonHost = (await service.getState(code))!.players[1].id;
    await expect(service.startGame(code, nonHost)).rejects.toMatchObject({
      code: ErrorCode.NOT_HOST,
    });
  });

  it('rejeita início com menos de 2 jogadores com NOT_ENOUGH_PLAYERS', async () => {
    const ctx = build([1, 2, 3, 4, 5]);
    const host = await ctx.service.createSession('Ana', 'normal', 'sock-1');
    await expect(
      ctx.service.startGame(host.state.code, host.playerId),
    ).rejects.toMatchObject({
      code: ErrorCode.NOT_ENOUGH_PLAYERS,
    });
  });
});

describe('SessionService.returnToLobby', () => {
  it('volta de ordering para lobby limpando ordem e ordenação (RF-04)', async () => {
    const ctx = build([1, 2, 3, 4, 5]);
    const host = await ctx.service.createSession('Ana', 'normal', 'sock-1');
    await ctx.service.joinSession(host.state.code, 'Bia', 'sock-2');
    await ctx.service.startGame(host.state.code, host.playerId); // → ordering
    const state = await ctx.service.returnToLobby(host.state.code);
    expect(state!.status).toBe('lobby');
    expect(state!.ordering).toBeNull();
    expect(state!.turnOrder).toEqual([]);
  });
});

describe('SessionService.markDisconnected / leaveSession', () => {
  async function withTwoPlayers() {
    const ctx = build([1, 2, 3, 4, 5]);
    const host = await ctx.service.createSession('Ana', 'normal', 'sock-1');
    const joiner = await ctx.service.joinSession(
      host.state.code,
      'Bia',
      'sock-2',
    );
    return {
      ...ctx,
      code: host.state.code,
      hostId: host.playerId,
      joinerId: joiner.playerId,
    };
  }

  it('markDisconnected marca o jogador como connected=false', async () => {
    const { service, code, joinerId } = await withTwoPlayers();
    const state = await service.markDisconnected(code, joinerId);
    expect(state).not.toBeNull();
    expect(state!.players.find((p) => p.id === joinerId)!.connected).toBe(
      false,
    );
  });

  it('leaveSession remove o jogador da sessão', async () => {
    const { service, code, joinerId } = await withTwoPlayers();
    const state = await service.leaveSession(code, joinerId);
    expect(state!.players.some((p) => p.id === joinerId)).toBe(false);
  });
});

describe('SessionService.reconnect', () => {
  it('revincula o socket e marca o jogador como conectado', async () => {
    const { repo, service } = build();
    const { state, playerId } = await service.createSession(
      'Ana',
      'normal',
      'sock-old',
    );
    await service.markDisconnected(state.code, playerId);

    const out = await service.reconnect(state.code, playerId, 'sock-new');
    const player = out.players.find((p) => p.id === playerId)!;
    expect(player.connected).toBe(true);
    expect(player.socketId).toBe('sock-new');
    // Persistido.
    const stored = (await repo.findByCode(state.code))!.players.find(
      (p) => p.id === playerId,
    )!;
    expect(stored.connected).toBe(true);
  });

  it('rejeita reconexão em sessão inexistente com RECONNECT_FAILED', async () => {
    const { service } = build();
    await expect(
      service.reconnect('00000', 'qualquer', 'sock'),
    ).rejects.toMatchObject({ code: ErrorCode.RECONNECT_FAILED });
  });

  it('rejeita reconexão com playerId desconhecido com RECONNECT_FAILED', async () => {
    const { service } = build();
    const { state } = await service.createSession('Ana', 'normal', 'sock');
    await expect(
      service.reconnect(state.code, 'fantasma', 'sock'),
    ).rejects.toMatchObject({ code: ErrorCode.RECONNECT_FAILED });
  });
});

describe('SessionService.setAppearance (CONTRACT-S5)', () => {
  async function withTwoPlayers() {
    const ctx = build([1, 2, 3, 4, 5]);
    const host = await ctx.service.createSession('Ana', 'normal', 'sock-1');
    const joiner = await ctx.service.joinSession(
      host.state.code,
      'Bia',
      'sock-2',
    );
    return {
      ...ctx,
      code: host.state.code,
      hostId: host.playerId,
      joinerId: joiner.playerId,
    };
  }

  it('grava cor e emoji do jogador e persiste no estado', async () => {
    const { repo, service, code, joinerId } = await withTwoPlayers();
    const state = await service.setAppearance(code, joinerId, '#ff8800', '🦊');
    expect(state.players.find((p) => p.id === joinerId)!.color).toBe('#ff8800');
    expect(state.players.find((p) => p.id === joinerId)!.emoji).toBe('🦊');
    const stored = (await repo.findByCode(code))!.players.find(
      (p) => p.id === joinerId,
    )!;
    expect(stored.color).toBe('#ff8800');
    expect(stored.emoji).toBe('🦊');
  });

  it('funciona em jogo (status playing), não só no lobby', async () => {
    const { repo, service, code, hostId } = await withTwoPlayers();
    const seeded = (await repo.findByCode(code))!;
    seeded.status = 'playing';
    await repo.save(seeded);
    const state = await service.setAppearance(code, hostId, '#00aa55', '🐸');
    expect(state.status).toBe('playing');
    expect(state.players.find((p) => p.id === hostId)!.emoji).toBe('🐸');
  });

  it('rejeita jogador fora da sessão com NOT_IN_SESSION', async () => {
    const { service, code } = await withTwoPlayers();
    await expect(
      service.setAppearance(code, 'fantasma', '#000000', '😀'),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_IN_SESSION });
  });

  it('rejeita sessão inexistente com NOT_IN_SESSION (não vaza existência)', async () => {
    const { service } = build();
    await expect(
      service.setAppearance('00000', 'x', '#000000', '😀'),
    ).rejects.toMatchObject({ code: ErrorCode.NOT_IN_SESSION });
  });
});

describe('SessionService.expireDisconnectedPlayer', () => {
  it('remove o jogador desconectado, mantendo a sessão se restarem outros', async () => {
    const { repo, service } = build();
    const { state, playerId: hostId } = await service.createSession(
      'Ana',
      'normal',
      'sock-a',
    );
    const { playerId: guestId } = await service.joinSession(
      state.code,
      'Bia',
      'sock-b',
    );
    await service.markDisconnected(state.code, guestId);

    const out = await service.expireDisconnectedPlayer(state.code, guestId);
    expect(out.removed).toBe(true);
    expect(out.sessionDeleted).toBe(false);
    const stored = await repo.findByCode(state.code);
    expect(stored!.players.map((p) => p.id)).toEqual([hostId]);
  });

  it('apaga a sessão quando o último jogador expira (RF-15)', async () => {
    const { repo, service } = build();
    const { state, playerId } = await service.createSession(
      'Ana',
      'normal',
      'sock-a',
    );
    await service.markDisconnected(state.code, playerId);

    const out = await service.expireDisconnectedPlayer(state.code, playerId);
    expect(out.removed).toBe(true);
    expect(out.sessionDeleted).toBe(true);
    expect(await repo.findByCode(state.code)).toBeNull();
  });

  it('não remove se o jogador reconectou no intervalo', async () => {
    const { repo, service } = build();
    const { state, playerId } = await service.createSession(
      'Ana',
      'normal',
      'sock-a',
    );
    await service.joinSession(state.code, 'Bia', 'sock-b');
    await service.markDisconnected(state.code, playerId);
    await service.reconnect(state.code, playerId, 'sock-a2'); // voltou

    const out = await service.expireDisconnectedPlayer(state.code, playerId);
    expect(out.removed).toBe(false);
    expect((await repo.findByCode(state.code))!.players).toHaveLength(2);
  });

  it('é no-op seguro para sessão inexistente', async () => {
    const { service } = build();
    const out = await service.expireDisconnectedPlayer('00000', 'x');
    expect(out).toEqual({ state: null, removed: false, sessionDeleted: false });
  });

  it('remove o jogador da ordem de turnos e mantém currentTurnIndex válido', async () => {
    const { repo, service } = build();
    const { state, playerId: a } = await service.createSession(
      'Ana',
      'normal',
      's',
    );
    const { playerId: b } = await service.joinSession(state.code, 'Bia', 's');
    const { playerId: c } = await service.joinSession(state.code, 'Caio', 's');

    // Coloca a partida em andamento com ordem [a,b,c] e a vez de 'a' (índice 0).
    const seeded = (await repo.findByCode(state.code))!;
    seeded.status = 'playing';
    seeded.turnOrder = [a, b, c];
    seeded.currentTurnIndex = 0;
    await repo.save(seeded);
    await service.markDisconnected(state.code, a);

    const out = await service.expireDisconnectedPlayer(state.code, a);
    expect(out.removed).toBe(true);
    expect(out.state!.turnOrder).toEqual([b, c]);
    // O índice continua apontando para um jogador existente, dentro dos limites.
    expect(out.state!.currentTurnIndex).toBeLessThan(
      out.state!.turnOrder.length,
    );
    expect([b, c]).toContain(out.state!.turnOrder[out.state!.currentTurnIndex]);
  });
});
