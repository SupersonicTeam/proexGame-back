import { Module } from '@nestjs/common';
import { QuestionBankModule } from '../questions/question-bank.module';
import { SessionModule } from '../session/session.module';
import { GameService } from './game.service';

// Reaproveita SessionRepository e RANDOM_SOURCE exportados pelo SessionModule;
// o QuestionBankModule provê o banco de perguntas em memória (S2-02).
@Module({
  imports: [SessionModule, QuestionBankModule],
  providers: [GameService],
  exports: [GameService],
})
export class GameModule {}
