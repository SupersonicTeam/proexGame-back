import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { SessionState } from './session.types';

// TTL (segundos) da chave de sessão no Redis. Backstop de RF-15: mesmo que os
// timers in-process se percam (restart do processo), a sessão expira sozinha.
// Folgado sobre os 5 min de grace para não apagar partidas ativas; deslizante
// (renovado a cada save).
export const SESSION_TTL_SECONDS = 1800;

// Persistência do SessionState no Redis — fonte única da verdade.
// O estado sobrevive a um restart do processo Node no meio da partida (RF-16),
// com TTL deslizante por inatividade (RF-15).
@Injectable()
export class SessionRepository {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private key(code: string): string {
    return `session:${code}`;
  }

  async create(state: SessionState): Promise<void> {
    await this.redis.set(
      this.key(state.code),
      JSON.stringify(state),
      'EX',
      SESSION_TTL_SECONDS,
    );
  }

  // Cria a sessão de forma ATÔMICA: só grava se a chave ainda não existir (SET NX).
  // Retorna false em colisão de código, sem sobrescrever a sessão existente.
  // Elimina a corrida entre verificar-e-criar sob `createSession` concorrentes.
  async createIfAbsent(state: SessionState): Promise<boolean> {
    const result = await this.redis.set(
      this.key(state.code),
      JSON.stringify(state),
      'EX',
      SESSION_TTL_SECONDS,
      'NX',
    );
    return result === 'OK';
  }

  async findByCode(code: string): Promise<SessionState | null> {
    const raw = await this.redis.get(this.key(code));
    if (!raw) return null;
    return JSON.parse(raw) as SessionState;
  }

  async save(state: SessionState): Promise<void> {
    state.lastActivityAt = new Date().toISOString();
    await this.redis.set(
      this.key(state.code),
      JSON.stringify(state),
      'EX',
      SESSION_TTL_SECONDS,
    );
  }

  async exists(code: string): Promise<boolean> {
    return (await this.redis.exists(this.key(code))) === 1;
  }

  async delete(code: string): Promise<void> {
    await this.redis.del(this.key(code));
  }
}
