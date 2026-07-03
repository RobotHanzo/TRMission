import { Module } from '@nestjs/common';
import { OgController } from './og.controller';
import { OgService } from './og.service';
import { LobbyModule } from '../lobby/lobby.module';
import { HistoryModule } from '../history/history.module';

/** Social previews: crawler meta pages + dynamically rendered Open Graph card images. */
@Module({
  imports: [LobbyModule, HistoryModule],
  controllers: [OgController],
  providers: [OgService],
})
export class OgModule {}
