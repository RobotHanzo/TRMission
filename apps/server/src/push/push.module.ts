import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ObservabilityModule } from '../observability/observability.module';
import { DeviceRepo } from './device.repo';
import { DevicesController } from './devices.controller';
import { LiveActivitiesController } from './live-activities.controller';
import { LiveActivityRepo } from './live-activity.repo';
import { PushService } from './push.service';
import { PUSH_TRANSPORTS, buildTransportsFromEnv } from './push.transports';

// Mobile push: device-token registry + the iOS Live Activity registry + PushService speaking
// FCM v1 / APNs HTTP/2 directly. With no credentials configured the transport list is empty and
// every notify (and every activity update) is a no-op.
@Module({
  imports: [AuthModule, ObservabilityModule],
  controllers: [DevicesController, LiveActivitiesController],
  providers: [
    DeviceRepo,
    LiveActivityRepo,
    PushService,
    { provide: PUSH_TRANSPORTS, useFactory: buildTransportsFromEnv },
  ],
  exports: [DeviceRepo, LiveActivityRepo, PushService],
})
export class PushModule {}
