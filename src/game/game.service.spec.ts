import { ErrorCode } from '../common/errors/game-error';
import { RandomSource } from '../common/random/random.source';
import { QuestionBankService } from '../questions/question-bank.service';
import { PendingQuestion, Question } from '../questions/question.types';
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

// Banco de perguntas fake: implementa só o que o GameService consome.
class FakeQuestionBank {
  constructor(private readonly questions: Question[] = []) {}
  pickQuestion(
    subject: string,
    excludedIds: Set<string>,
    rng: RandomSource,
  ): Question | null {
    const available = this.questions.filter(
      (q) => q.subject === subject && !excludedIds.has(q.id),
    );
    if (available.length === 0) return null;
    return available[rng.int(0, available.length - 1)];
  }
  getById(id: string): Question | undefined {
    return this.questions.find((q) => q.id === id);
  }
  subjects(): string[] {
    return [...new Set(this.questions.map((q) => q.subject))];
  }
}

const SAMPLE_QUESTIONS: Question[] = [
  {
    id: 'mat-0001',
    subject: 'matematica',
    statement: '2 + 2?',
    correct: '4',
    proximal: '3',
    wrong: ['5', '22'],
  },
  {
    id: 'mat-0002',
    subject: 'matematica',
    statement: '3 + 3?',
    correct: '6',
    proximal: '5',
    wrong: ['9', '33'],
  },
];

// Pergunta pendente pré-montada (ordem conhecida): índice 0 = correta, 1 = proximal.
function makePending(over: Partial<PendingQuestion> = {}): PendingQuestion {
  return {
    questionId: 'mat-0001',
    subject: 'matematica',
    statement: '2 + 2?',
    options: ['4', '3', '5', '22'],
    correctIndex: 0,
    proximalIndex: 1,
    ...over,
  };
}

function makePlayer(over: Partial<Player> & { id: string }): Player {
  return {
    name: over.id,
    socketId: `sock-${over.id}`,
    square: 0,
    connected: true,
    isHost: false,
    usedQuestionIds: [],
    skipTurns: 0,
    pendingQuestion: null,
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
    board: {
      size: 25,
      tileTypeBySquare: { 0: 'start', 25: 'finish' },
      subjectBySquare: {},
    },
    players,
    turnOrder: players.map((p) => p.id),
    currentTurnIndex: 0,
    winner: null,
    createdAt: '2026-06-03T00:00:00.000Z',
    lastActivityAt: '2026-06-03T00:00:00.000Z',
    servedQuestionIds: [],
    ...over,
  };
  repo.store.set(state.code, structuredClone(state));
  return state;
}

function build(rngValues: number[], questions: Question[] = SAMPLE_QUESTIONS) {
  const repo = new InMemoryRepo();
  const rng = new FakeRandomSource(rngValues);
  const bank = new FakeQuestionBank(questions);
  const service = new GameService(
    repo as unknown as SessionRepository,
    rng,
    bank as unknown as QuestionBankService,
  );
  return { repo, service, bank };
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

  // --- S2-07: aterrissagem em casas especiais ---

  it('dispara pergunta ao cair em casa-pergunta e NÃO passa o turno', async () => {
    // dado=3 → casa 3 (question, materia matematica).
    // rng: [dado, pickQuestion idx, fy1, fy2, fy3]
    const { repo, service } = build([3, 0, 3, 2, 1]);
    seedState(repo, [makePlayer({ id: 'a' }), makePlayer({ id: 'b' })], {
      board: {
        size: 25,
        tileTypeBySquare: { 0: 'start', 25: 'finish', 3: 'question' },
        subjectBySquare: { 3: 'matematica' },
      },
    });
    const out = await service.applyDiceRoll('12345', 'a');
    expect(out.toSquare).toBe(3);
    expect(out.isWin).toBe(false);
    expect(out.nextPlayerId).toBeNull(); // turno NÃO passa
    expect(out.prompt).not.toBeNull();
    expect(out.prompt!.questionId).toBe('mat-0001');
    expect(out.prompt!.options).toHaveLength(4);
    // SEGURANÇA: o prompt não carrega a resposta correta.
    expect(JSON.stringify(out.prompt)).not.toContain('correctIndex');
    // Estado: pendência armada e id registrado globalmente + por jogador.
    const a = out.state.players.find((p) => p.id === 'a')!;
    expect(a.pendingQuestion).not.toBeNull();
    expect(out.state.servedQuestionIds).toContain('mat-0001');
    expect(a.usedQuestionIds).toContain('mat-0001');
    expect(out.state.currentTurnIndex).toBe(0); // não avançou
  });

  it('prende ao cair em presídio (skipTurns++) e passa o turno', async () => {
    const { repo, service } = build([3]);
    seedState(repo, [makePlayer({ id: 'a' }), makePlayer({ id: 'b' })], {
      board: {
        size: 25,
        tileTypeBySquare: { 0: 'start', 25: 'finish', 3: 'prison' },
        subjectBySquare: {},
      },
    });
    const out = await service.applyDiceRoll('12345', 'a');
    expect(out.toSquare).toBe(3);
    expect(out.prompt).toBeNull();
    expect(out.nextPlayerId).toBe('b'); // turno passa
    expect(out.state.players.find((p) => p.id === 'a')!.skipTurns).toBe(1);
    expect(out.state.currentTurnIndex).toBe(1);
  });

  it('trata casa-pergunta esgotada como normal (passa o turno, sem prompt)', async () => {
    // Banco vazio → pickQuestion retorna null → fallback para casa normal.
    const { repo, service } = build([3], []);
    seedState(repo, [makePlayer({ id: 'a' }), makePlayer({ id: 'b' })], {
      board: {
        size: 25,
        tileTypeBySquare: { 0: 'start', 25: 'finish', 3: 'question' },
        subjectBySquare: { 3: 'matematica' },
      },
    });
    const out = await service.applyDiceRoll('12345', 'a');
    expect(out.prompt).toBeNull();
    expect(out.nextPlayerId).toBe('b');
    expect(
      out.state.players.find((p) => p.id === 'a')!.pendingQuestion,
    ).toBeNull();
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

describe('GameService.submitAnswer', () => {
  // Tabuleiro com casa-pergunta em 5 (materia matematica) para testar encadeamento.
  const boardWithQ = {
    size: 25,
    tileTypeBySquare: { 0: 'start', 25: 'finish', 5: 'question' } as Record<
      number,
      'start' | 'normal' | 'question' | 'prison' | 'finish'
    >,
    subjectBySquare: { 5: 'matematica' },
  };

  it('acerto move pelo avanço (tier/dificuldade) e passa o turno', async () => {
    // a em 1 (leader), b em 0. normal/leader = +2 → casa 3 (normal). Sem nudge.
    const { repo, service } = build([]);
    seedState(repo, [
      makePlayer({ id: 'a', square: 1, pendingQuestion: makePending() }),
      makePlayer({ id: 'b', square: 0 }),
    ]);
    const out = await service.submitAnswer('12345', 'a', 'mat-0001', 0);
    expect(out.correct).toBe(true);
    expect(out.errorType).toBe('none');
    expect(out.fromSquare).toBe(1);
    expect(out.toSquare).toBe(3);
    expect(out.movement).toBe(2);
    expect(out.isWin).toBe(false);
    expect(out.nextPlayerId).toBe('b');
    expect(out.prompt).toBeNull();
    // Pendência limpa (anti double-submit).
    expect(
      out.state.players.find((p) => p.id === 'a')!.pendingQuestion,
    ).toBeNull();
  });

  it('erro proximal recua pouco e passa o turno sem disparar nada', async () => {
    const { repo, service } = build([]);
    seedState(repo, [
      makePlayer({ id: 'a', square: 5, pendingQuestion: makePending() }),
      makePlayer({ id: 'b', square: 0 }),
    ]);
    const out = await service.submitAnswer('12345', 'a', 'mat-0001', 1);
    expect(out.correct).toBe(false);
    expect(out.errorType).toBe('proximal');
    expect(out.toSquare).toBe(3); // 5 - 2 (normal proximal)
    expect(out.movement).toBe(-2);
    expect(out.nextPlayerId).toBe('b');
    expect(out.prompt).toBeNull();
  });

  it('erro total recua mais que o proximal', async () => {
    const { repo, service } = build([]);
    seedState(repo, [
      makePlayer({ id: 'a', square: 5, pendingQuestion: makePending() }),
      makePlayer({ id: 'b', square: 0 }),
    ]);
    const out = await service.submitAnswer('12345', 'a', 'mat-0001', 2);
    expect(out.errorType).toBe('wrong');
    expect(out.toSquare).toBe(2); // 5 - 3 (normal wrong)
  });

  it('acerto que cai em casa-pergunta encadeia (RF-11): novo prompt, turno não passa', async () => {
    // a em 3 (leader) → +2 → casa 5 (question). nudge não dispara (int>7 → fica em 5).
    // depois encadeia: pickQuestion(idx 0) + buildPendingQuestion(fy 3,2,1).
    const { repo, service } = build([8, 0, 3, 2, 1]);
    seedState(
      repo,
      [
        makePlayer({ id: 'a', square: 3, pendingQuestion: makePending() }),
        makePlayer({ id: 'b', square: 0 }),
      ],
      { board: boardWithQ, servedQuestionIds: ['mat-0001'] },
    );
    const out = await service.submitAnswer('12345', 'a', 'mat-0001', 0);
    expect(out.correct).toBe(true);
    expect(out.toSquare).toBe(5);
    expect(out.nextPlayerId).toBeNull(); // turno não passa
    expect(out.prompt).not.toBeNull();
    expect(out.prompt!.questionId).toBe('mat-0002'); // pergunta nova, não repetida
    const a = out.state.players.find((p) => p.id === 'a')!;
    expect(a.pendingQuestion!.questionId).toBe('mat-0002');
    expect(out.state.servedQuestionIds).toEqual(['mat-0001', 'mat-0002']);
  });

  it('acerto que alcança N vence (chega-ou-passa)', async () => {
    const { repo, service } = build([]);
    seedState(repo, [
      makePlayer({ id: 'a', square: 24, pendingQuestion: makePending() }),
      makePlayer({ id: 'b', square: 0 }),
    ]);
    const out = await service.submitAnswer('12345', 'a', 'mat-0001', 0);
    expect(out.isWin).toBe(true);
    expect(out.toSquare).toBe(25);
    expect(out.nextPlayerId).toBeNull();
    expect(out.ranking).not.toBeNull();
    expect(out.state.status).toBe('finished');
    expect(out.state.winner).toBe('a');
  });

  it('rejeita submitAnswer sem pergunta pendente (NO_PENDING_QUESTION)', async () => {
    const { repo, service } = build([]);
    seedState(repo, [makePlayer({ id: 'a' }), makePlayer({ id: 'b' })]);
    await expect(
      service.submitAnswer('12345', 'a', 'mat-0001', 0),
    ).rejects.toMatchObject({ code: ErrorCode.NO_PENDING_QUESTION });
  });

  it('rejeita questionId divergente (QUESTION_MISMATCH) sem alterar estado', async () => {
    const { repo, service } = build([]);
    seedState(repo, [
      makePlayer({ id: 'a', square: 5, pendingQuestion: makePending() }),
      makePlayer({ id: 'b' }),
    ]);
    await expect(
      service.submitAnswer('12345', 'a', 'OUTRA', 0),
    ).rejects.toMatchObject({ code: ErrorCode.QUESTION_MISMATCH });
    // Estado intacto: pendência preservada, posição inalterada.
    const a = (await repo.findByCode('12345'))!.players.find(
      (p) => p.id === 'a',
    )!;
    expect(a.pendingQuestion).not.toBeNull();
    expect(a.square).toBe(5);
  });

  it('rejeita optionIndex fora de [0,3] (INVALID_OPTION)', async () => {
    const { repo, service } = build([]);
    seedState(repo, [
      makePlayer({ id: 'a', square: 5, pendingQuestion: makePending() }),
      makePlayer({ id: 'b' }),
    ]);
    await expect(
      service.submitAnswer('12345', 'a', 'mat-0001', 7),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_OPTION });
    await expect(
      service.submitAnswer('12345', 'a', 'mat-0001', -1),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_OPTION });
  });
});

describe('GameService.startTurnSkipIfNeeded', () => {
  it('decrementa skipTurns, passa o turno e sinaliza turnSkipped', async () => {
    const { repo, service } = build([]);
    seedState(repo, [
      makePlayer({ id: 'a', skipTurns: 1 }),
      makePlayer({ id: 'b' }),
    ]);
    const out = await service.startTurnSkipIfNeeded('12345');
    expect(out).not.toBeNull();
    expect(out!.playerId).toBe('a');
    expect(out!.remaining).toBe(0);
    expect(out!.nextPlayerId).toBe('b');
    expect(out!.state.players.find((p) => p.id === 'a')!.skipTurns).toBe(0);
    expect(out!.state.currentTurnIndex).toBe(1);
  });

  it('com múltiplos turnos presos, decrementa de 1 em 1 (remaining > 0)', async () => {
    const { repo, service } = build([]);
    seedState(repo, [
      makePlayer({ id: 'a', skipTurns: 2 }),
      makePlayer({ id: 'b' }),
    ]);
    const out = await service.startTurnSkipIfNeeded('12345');
    expect(out!.remaining).toBe(1);
  });

  it('retorna null quando o jogador da vez não está preso', async () => {
    const { repo, service } = build([]);
    seedState(repo, [makePlayer({ id: 'a' }), makePlayer({ id: 'b' })]);
    expect(await service.startTurnSkipIfNeeded('12345')).toBeNull();
  });

  it('retorna null quando a partida não está ativa', async () => {
    const { repo, service } = build([]);
    seedState(repo, [makePlayer({ id: 'a', skipTurns: 1 })], {
      status: 'finished',
    });
    expect(await service.startTurnSkipIfNeeded('12345')).toBeNull();
  });

  it('retorna null para sessão inexistente', async () => {
    const { service } = build([]);
    expect(await service.startTurnSkipIfNeeded('00000')).toBeNull();
  });
});
