import { Module } from '@nestjs/common';
import { HistoryController } from './history.controller';
import { HistoryRepo } from './history.repo';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [HistoryController],
  providers: [HistoryRepo],
  exports: [HistoryRepo],
})
export class HistoryModule {}
