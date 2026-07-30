import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ZodValidationPipe } from 'nestjs-zod';
import { DatabaseModule } from './db/database.module';
import { AuthModule } from './auth/auth.module';
import { GameModule } from './game/game.module';
import { LobbyModule } from './lobby/lobby.module';
import { HistoryModule } from './history/history.module';
import { MapsModule } from './maps/maps.module';
import { RatingsModule } from './ratings/ratings.module';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AccountModule } from './account/account.module';
import { PushModule } from './push/push.module';
import { ModerationModule } from './moderation/moderation.module';
import { OgModule } from './og/og.module';
import { SelfUpdateModule } from './selfupdate/selfupdate.module';
import { ObservabilityModule } from './observability/observability.module';
import { HealthController } from './health/health.controller';
import { WellKnownController } from './health/well-known.controller';
import { MobileLinksConfig } from './config/mobile-links.config';
import { DocsController } from './openapi/docs.controller';
import { OpenApiHolder } from './openapi/openapi.holder';

// REST control plane: observability, database, auth, lobby, match history, the
// realtime hub (DI), health, and API docs. A global ZodValidationPipe validates every
// request body; a global ThrottlerGuard rate-limits the API (infra routes opt out); a global
// SentryGlobalFilter reports unhandled exceptions (it delegates to Nest's BaseExceptionFilter,
// so HttpExceptions keep their status/body and are NOT reported as errors).
@Module({
  imports: [
    // Inert unless src/instrument.ts brought Sentry up with a DSN — see observability/sentry.ts.
    SentryModule.forRoot(),
    ObservabilityModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 240 }]),
    DatabaseModule,
    AuthModule,
    MapsModule,
    GameModule,
    LobbyModule,
    HistoryModule,
    RatingsModule,
    LeaderboardModule,
    DashboardModule,
    AccountModule,
    PushModule,
    ModerationModule,
    OgModule,
    SelfUpdateModule,
  ],
  controllers: [HealthController, DocsController, WellKnownController],
  providers: [
    OpenApiHolder,
    MobileLinksConfig,
    { provide: APP_FILTER, useClass: SentryGlobalFilter },
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
