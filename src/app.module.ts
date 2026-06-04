import { Module } from '@nestjs/common';
import { RedisModule } from './redis/redis.module';
import { SessionModule } from './session/session.module';
import { GameModule } from './game/game.module';
import { GatewayModule } from './gateway/gateway.module';

@Module({
  imports: [RedisModule, SessionModule, GameModule, GatewayModule],
})
export class AppModule {}
