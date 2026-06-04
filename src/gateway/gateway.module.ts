import { Module } from '@nestjs/common';
import { GameModule } from '../game/game.module';
import { SessionModule } from '../session/session.module';
import { GameGateway } from './game.gateway';

@Module({
  imports: [SessionModule, GameModule],
  providers: [GameGateway],
})
export class GatewayModule {}
