import { Module, type OnModuleInit } from '@nestjs/common';
import { LobbyController } from './lobby.controller';
import { LobbyPublicController } from './lobby.public.controller';
import { LobbyService } from './lobby.service';
import { RoomRepo } from './room.repo';
import { GameModule } from '../game/game.module';
import { AuthModule } from '../auth/auth.module';
import { MapsModule } from '../maps/maps.module';
import { PushModule } from '../push/push.module';
import { PushService } from '../push/push.service';

@Module({
  imports: [GameModule, AuthModule, MapsModule, PushModule],
  // Public controller first so `GET /rooms/public` is not captured by the guarded `/rooms/:code`.
  controllers: [LobbyPublicController, LobbyController],
  providers: [LobbyService, RoomRepo],
  exports: [LobbyService, RoomRepo],
})
export class LobbyModule implements OnModuleInit {
  constructor(
    private readonly push: PushService,
    private readonly rooms: RoomRepo,
  ) {}

  /** Adapt RoomRepo into PushService's plain game→room port so every push payload carries the room
   *  code its tap must navigate to (issue #63). Wired here, not injected into PushService, because
   *  PushModule must stay free of a dependency on this module — which imports it. */
  onModuleInit(): void {
    this.push.setRoomCodeResolver(
      async (gameId) => (await this.rooms.findByGameId(gameId))?._id ?? null,
    );
  }
}
