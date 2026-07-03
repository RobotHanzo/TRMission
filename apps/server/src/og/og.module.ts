import { Module } from '@nestjs/common';
import { OgController } from './og.controller';
import { OgService } from './og.service';
import { LobbyModule } from '../lobby/lobby.module';
import { HistoryModule } from '../history/history.module';
import { MapsModule } from '../maps/maps.module';

/** Social previews: crawler meta pages + dynamically rendered Open Graph card images. */
@Module({
  imports: [LobbyModule, HistoryModule, MapsModule],
  controllers: [OgController],
  providers: [OgService],
})
export class OgModule {}
