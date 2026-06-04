import { Difficulty, Player, SessionState } from '../session/session.types';

// Payloads client → server (Sprint 1).
export interface CreateSessionDto {
  name: string;
  difficulty: Difficulty;
}

export interface JoinSessionDto {
  code: string;
  name: string;
}

// Dados guardados no socket para identificar o jogador na desconexão.
export interface SocketData {
  code?: string;
  playerId?: string;
}

// Visão pública de um jogador no contrato WS — NUNCA expõe `socketId`
// nem outros campos internos do estado.
export function toPlayerView(player: Player) {
  return {
    id: player.id,
    name: player.name,
    connected: player.connected,
    isHost: player.isHost,
  };
}

// Projeção do estado para o lobby (não vaza socketId nem dados internos).
export function toLobbyState(state: SessionState) {
  const host = state.players.find((p) => p.isHost);
  return {
    code: state.code,
    status: state.status,
    hostId: host?.id ?? null,
    players: state.players.map(toPlayerView),
  };
}
