import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BlocksController } from './blocks.controller';

// UGC compliance surface (Apple 1.2 / Play UGC): block/mute lists + abuse reports.
@Module({
  imports: [AuthModule],
  controllers: [BlocksController],
  providers: [],
  exports: [],
})
export class ModerationModule {}
