import { Module } from '@nestjs/common';
import { RANDOM_SOURCE } from '../common/random/random.source';
import { DefaultRandomSource } from '../common/random/default-random.source';
import { ReconnectService } from './reconnect.service';
import { SessionLock } from './session.lock';
import { SessionRepository } from './session.repository';
import { SessionService } from './session.service';

// Provê o serviço de lobby, o repositório, a fonte de aleatoriedade padrão, o
// gerenciador de timers de reconexão (S2-10) e o mutex de sessão (P2). O
// SessionLock é exportado para o GameModule injetar a MESMA instância — a
// serialização por código precisa ser global entre SessionService e GameService.
@Module({
  providers: [
    SessionRepository,
    SessionService,
    ReconnectService,
    SessionLock,
    { provide: RANDOM_SOURCE, useClass: DefaultRandomSource },
  ],
  exports: [
    SessionService,
    SessionRepository,
    ReconnectService,
    SessionLock,
    RANDOM_SOURCE,
  ],
})
export class SessionModule {}
