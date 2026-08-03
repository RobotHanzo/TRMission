import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SkinsController } from './skins.controller';
import { SkinsService } from './skins.service';
import { TrainCarSkinConfigRepo } from './train-car-skin-config.repo';

@Module({
  imports: [AuthModule],
  controllers: [SkinsController],
  providers: [SkinsService, TrainCarSkinConfigRepo],
  exports: [SkinsService],
})
export class SkinsModule {}
