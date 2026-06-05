import { Module } from '@nestjs/common';
import { RANDOM_SOURCE } from '../common/random/random.source';
import { DefaultRandomSource } from '../common/random/default-random.source';
import { ReconnectService } from './reconnect.service';
import { SessionRepository } from './session.repository';
import { SessionService } from './session.service';

// Provê o serviço de lobby, o repositório, a fonte de aleatoriedade padrão e o
// gerenciador de timers de reconexão (S2-10). RANDOM_SOURCE é exportado para o
// GameModule reutilizar a mesma implementação.
@Module({
  providers: [
    SessionRepository,
    SessionService,
    ReconnectService,
    { provide: RANDOM_SOURCE, useClass: DefaultRandomSource },
  ],
  exports: [SessionService, SessionRepository, ReconnectService, RANDOM_SOURCE],
})
export class SessionModule {}
