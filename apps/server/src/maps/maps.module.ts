import { Module } from '@nestjs/common';
import { MapsController } from './maps.controller';
import { MapsContentController } from './maps-content.controller';
import { MapsService } from './maps.service';
import { CustomMapRepo } from './custom-map.repo';
import { MapContentRepo } from './map-content.repo';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [MapsContentController, MapsController],
  providers: [MapsService, CustomMapRepo, MapContentRepo],
  exports: [MapsService, CustomMapRepo, MapContentRepo],
})
export class MapsModule {}
