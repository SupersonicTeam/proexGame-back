import { Module } from '@nestjs/common';
import { SessionModule } from '../session/session.module';
import { GameService } from './game.service';

// Reaproveita SessionRepository e RANDOM_SOURCE exportados pelo SessionModule.
@Module({
  imports: [SessionModule],
  providers: [GameService],
  exports: [GameService],
})
export class GameModule {}
