import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DeviceRepo } from './device.repo';
import { DevicesController } from './devices.controller';

// Mobile push: device-token registry (this task) + PushService/transports (Task 2).
@Module({
  imports: [AuthModule],
  controllers: [DevicesController],
  providers: [DeviceRepo],
  exports: [DeviceRepo],
})
export class PushModule {}
