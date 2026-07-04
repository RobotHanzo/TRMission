import { Module } from '@nestjs/common';
import { LobbyController } from './lobby.controller';
import { LobbyPublicController } from './lobby.public.controller';
import { LobbyService } from './lobby.service';
import { LobbyConfig } from './lobby-config';
import { RoomRepo } from './room.repo';
import { GameModule } from '../game/game.module';
import { AuthModule } from '../auth/auth.module';
import { MapsModule } from '../maps/maps.module';

@Module({
  imports: [GameModule, AuthModule, MapsModule],
  // Public controller first so `GET /rooms/public` is not captured by the guarded `/rooms/:code`.
  controllers: [LobbyPublicController, LobbyController],
  providers: [LobbyService, LobbyConfig, RoomRepo],
  exports: [LobbyService, RoomRepo],
})
export class LobbyModule {}
