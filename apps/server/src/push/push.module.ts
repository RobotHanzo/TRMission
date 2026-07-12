import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ObservabilityModule } from '../observability/observability.module';
import { DeviceRepo } from './device.repo';
import { DevicesController } from './devices.controller';
import { PushService } from './push.service';
import { PUSH_TRANSPORTS, buildTransportsFromEnv } from './push.transports';

// Mobile push: device-token registry + PushService speaking FCM v1 / APNs HTTP/2 directly.
// With no credentials configured the transport list is empty and every notify is a no-op.
@Module({
  imports: [AuthModule, ObservabilityModule],
  controllers: [DevicesController],
  providers: [DeviceRepo, PushService, { provide: PUSH_TRANSPORTS, useFactory: buildTransportsFromEnv }],
  exports: [DeviceRepo, PushService],
})
export class PushModule {}
