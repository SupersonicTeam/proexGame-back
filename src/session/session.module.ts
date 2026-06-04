import { Module } from '@nestjs/common';
import { RANDOM_SOURCE } from '../common/random/random.source';
import { DefaultRandomSource } from '../common/random/default-random.source';
import { SessionRepository } from './session.repository';
import { SessionService } from './session.service';

// Provê o serviço de lobby, o repositório e a fonte de aleatoriedade padrão.
// RANDOM_SOURCE é exportado para o GameModule reutilizar a mesma implementação.
@Module({
  providers: [
    SessionRepository,
    SessionService,
    { provide: RANDOM_SOURCE, useClass: DefaultRandomSource },
  ],
  exports: [SessionService, SessionRepository, RANDOM_SOURCE],
})
export class SessionModule {}
