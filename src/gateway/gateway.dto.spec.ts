import { ErrorCode } from '../common/errors/game-error';
import { Board, Player, SessionState } from '../session/session.types';
import {
  parseReconnect,
  parseSubmitAnswer,
  toGameState,
  toLobbyState,
  toPlayerView,
} from './gateway.dto';

function makePlayer(over: Partial<Player> & { id: string }): Player {
  return {
    name: over.id,
    socketId: `secret-socket-${over.id}`,
    square: 0,
    connected: true,
    isHost: false,
    usedQuestionIds: [],
    skipTurns: 0,
    pendingQuestion: null,
    ...over,
  };
}

describe('toPlayerView', () => {
  it('expõe id, name, connected, isHost e square — nunca socketId', () => {
    const view = toPlayerView(
      makePlayer({ id: 'a', name: 'Ana', isHost: true, square: 5 }),
    );
    expect(view).toEqual({
      id: 'a',
      name: 'Ana',
      connected: true,
      isHost: true,
      square: 5,
    });
    expect(view).not.toHaveProperty('socketId');
  });
});

describe('toLobbyState', () => {
  it('não vaza socketId de nenhum jogador e inclui difficulty', () => {
    const state = {
      code: '12345',
      status: 'lobby',
      difficulty: 'hard',
      players: [makePlayer({ id: 'a', isHost: true }), makePlayer({ id: 'b' })],
    } as unknown as SessionState;

    const lobby = toLobbyState(state);
    expect(lobby.hostId).toBe('a');
    expect(lobby.difficulty).toBe('hard');
    expect(JSON.stringify(lobby)).not.toContain('secret-socket');
    for (const p of lobby.players) {
      expect(p).not.toHaveProperty('socketId');
    }
  });
});

describe('toGameState', () => {
  const board: Board = {
    size: 20,
    tileTypeBySquare: { 5: 'question' },
    subjectBySquare: { 5: 'matematica' },
  };

  function makeState(over: Partial<SessionState> = {}): SessionState {
    return {
      code: '99999',
      status: 'playing',
      difficulty: 'normal',
      board,
      players: [
        makePlayer({ id: 'p1', name: 'Ana', isHost: true, square: 3 }),
        makePlayer({ id: 'p2', name: 'Bia', square: 1 }),
      ],
      turnOrder: ['p1', 'p2'],
      currentTurnIndex: 0,
      winner: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastActivityAt: '2026-01-01T00:00:00.000Z',
      servedQuestionIds: [],
      ...over,
    };
  }

  it('retorna shape completo com currentTurnPlayerId e sem campos internos', () => {
    const snap = toGameState(makeState());
    expect(snap.code).toBe('99999');
    expect(snap.status).toBe('playing');
    expect(snap.difficulty).toBe('normal');
    expect(snap.board).toEqual(board);
    expect(snap.players).toHaveLength(2);
    expect(snap.players[0].square).toBe(3);
    expect(snap.currentTurnPlayerId).toBe('p1');
    expect(snap.winner).toBeNull();
    expect(snap.ranking).toBeNull();
  });

  it('currentTurnPlayerId é null quando status não é playing', () => {
    const snap = toGameState(makeState({ status: 'lobby' }));
    expect(snap.currentTurnPlayerId).toBeNull();
  });

  it('ranking é preenchido no status finished', () => {
    const snap = toGameState(makeState({ status: 'finished', winner: 'p1' }));
    expect(snap.ranking).not.toBeNull();
    expect(snap.ranking![0].playerId).toBe('p1');
  });

  it('JSON serializado não contém socketId, correctIndex nem pendingQuestion', () => {
    const serialized = JSON.stringify(toGameState(makeState()));
    expect(serialized).not.toContain('secret-socket');
    expect(serialized).not.toContain('correctIndex');
    expect(serialized).not.toContain('pendingQuestion');
  });
});

describe('parseSubmitAnswer', () => {
  it('aceita payload válido', () => {
    expect(
      parseSubmitAnswer({ questionId: 'mat-0001', optionIndex: 2 }),
    ).toEqual({ questionId: 'mat-0001', optionIndex: 2 });
  });

  it('rejeita questionId ausente/vazio com QUESTION_MISMATCH', () => {
    expect(() => parseSubmitAnswer({ optionIndex: 0 })).toThrow(
      expect.objectContaining({ code: ErrorCode.QUESTION_MISMATCH }),
    );
    expect(() =>
      parseSubmitAnswer({ questionId: '  ', optionIndex: 0 }),
    ).toThrow(expect.objectContaining({ code: ErrorCode.QUESTION_MISMATCH }));
  });

  it('rejeita optionIndex não-inteiro com INVALID_OPTION', () => {
    expect(() =>
      parseSubmitAnswer({ questionId: 'x', optionIndex: 1.5 }),
    ).toThrow(expect.objectContaining({ code: ErrorCode.INVALID_OPTION }));
    expect(() =>
      parseSubmitAnswer({ questionId: 'x', optionIndex: 'a' }),
    ).toThrow(expect.objectContaining({ code: ErrorCode.INVALID_OPTION }));
  });
});

describe('parseReconnect', () => {
  it('aceita code de 5 dígitos e playerId não-vazio', () => {
    expect(parseReconnect({ code: '12345', playerId: 'uuid-x' })).toEqual({
      code: '12345',
      playerId: 'uuid-x',
    });
  });

  it('rejeita code mal-formado com RECONNECT_FAILED', () => {
    expect(() => parseReconnect({ code: '12', playerId: 'x' })).toThrow(
      expect.objectContaining({ code: ErrorCode.RECONNECT_FAILED }),
    );
    expect(() => parseReconnect({ code: 'abcde', playerId: 'x' })).toThrow(
      expect.objectContaining({ code: ErrorCode.RECONNECT_FAILED }),
    );
  });

  it('rejeita playerId ausente com RECONNECT_FAILED', () => {
    expect(() => parseReconnect({ code: '12345' })).toThrow(
      expect.objectContaining({ code: ErrorCode.RECONNECT_FAILED }),
    );
  });
});
