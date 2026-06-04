import { Player, SessionState } from '../session/session.types';
import { toLobbyState, toPlayerView } from './gateway.dto';

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
  it('expõe apenas id, name, connected e isHost — nunca socketId', () => {
    const view = toPlayerView(
      makePlayer({ id: 'a', name: 'Ana', isHost: true }),
    );
    expect(view).toEqual({
      id: 'a',
      name: 'Ana',
      connected: true,
      isHost: true,
    });
    expect(view).not.toHaveProperty('socketId');
    expect(view).not.toHaveProperty('square');
  });
});

describe('toLobbyState', () => {
  it('não vaza socketId de nenhum jogador', () => {
    const state = {
      code: '12345',
      status: 'lobby',
      players: [makePlayer({ id: 'a', isHost: true }), makePlayer({ id: 'b' })],
    } as unknown as SessionState;

    const lobby = toLobbyState(state);
    expect(lobby.hostId).toBe('a');
    expect(JSON.stringify(lobby)).not.toContain('secret-socket');
    for (const p of lobby.players) {
      expect(p).not.toHaveProperty('socketId');
    }
  });
});
