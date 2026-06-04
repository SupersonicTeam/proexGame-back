import { Module } from '@nestjs/common';

// Os módulos de feature (redis, session, game, gateway) são registrados
// nas tasks seguintes (T5, T8, T9, T10).
@Module({
  imports: [],
  controllers: [],
  providers: [],
})
export class AppModule {}
