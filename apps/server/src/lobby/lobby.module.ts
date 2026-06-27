import { Module } from '@nestjs/common';
import { LobbyController } from './lobby.controller';
import { LobbyService } from './lobby.service';
import { RoomRepo } from './room.repo';
import { GameModule } from '../game/game.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [GameModule, AuthModule],
  controllers: [LobbyController],
  providers: [LobbyService, RoomRepo],
})
export class LobbyModule {}
