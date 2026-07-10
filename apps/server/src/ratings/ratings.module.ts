import { Module } from '@nestjs/common';
import { RatingsController } from './ratings.controller';
import { RatingsRepo } from './ratings.repo';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [RatingsController],
  providers: [RatingsRepo],
  exports: [RatingsRepo],
})
export class RatingsModule {}
