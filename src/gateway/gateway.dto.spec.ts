import { ErrorCode } from '../common/errors/game-error';
import { Player, SessionState } from '../session/session.types';
import {
  parseReconnect,
  parseSubmitAnswer,
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
