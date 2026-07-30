import { Module } from '@nestjs/common';
import { SelfUpdateController } from './selfupdate.controller';
import { SelfUpdateService } from './selfupdate.service';

// Server OTA: hot-apply a signed source bundle instead of re-pulling a ~2GB image
// (docs/release/server-ota.md). Inert unless TRM_SELFUPDATE_MANIFEST_URL and
// TRM_SELFUPDATE_PUBLIC_KEY are both set.
@Module({
  controllers: [SelfUpdateController],
  providers: [SelfUpdateService],
  exports: [SelfUpdateService],
})
export class SelfUpdateModule {}
