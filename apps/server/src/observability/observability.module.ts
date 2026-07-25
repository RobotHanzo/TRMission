import { Global, Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { SentryErrorReporter } from './error-reporter';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, SentryErrorReporter],
  exports: [MetricsService, SentryErrorReporter],
})
export class ObservabilityModule {}
