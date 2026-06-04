// Módulo do banco de perguntas (S2-02).
// Reutiliza o RANDOM_SOURCE exportado pelo SessionModule para manter uma
// única implementação de RandomSource em toda a aplicação.

import { Module } from '@nestjs/common';
import { SessionModule } from '../session/session.module';
import { QuestionBankService } from './question-bank.service';

@Module({
  imports: [SessionModule],
  providers: [QuestionBankService],
  exports: [QuestionBankService],
})
export class QuestionBankModule {}
