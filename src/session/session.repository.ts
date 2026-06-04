import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { SessionState } from './session.types';

// Persistência do SessionState no Redis — fonte única da verdade.
// O estado sobrevive a um restart do processo Node no meio da partida (RF-16).
// TTL por inatividade entra na Sprint 2 (RF-15); aqui o set é simples.
@Injectable()
export class SessionRepository {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private key(code: string): string {
    return `session:${code}`;
  }

  async create(state: SessionState): Promise<void> {
    await this.redis.set(this.key(state.code), JSON.stringify(state));
  }

  async findByCode(code: string): Promise<SessionState | null> {
    const raw = await this.redis.get(this.key(code));
    if (!raw) return null;
    return JSON.parse(raw) as SessionState;
  }

  async save(state: SessionState): Promise<void> {
    state.lastActivityAt = new Date().toISOString();
    await this.redis.set(this.key(state.code), JSON.stringify(state));
  }

  async exists(code: string): Promise<boolean> {
    return (await this.redis.exists(this.key(code))) === 1;
  }

  async delete(code: string): Promise<void> {
    await this.redis.del(this.key(code));
  }
}
