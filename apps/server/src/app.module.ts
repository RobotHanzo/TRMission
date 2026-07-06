import { Module } from '@nestjs/common';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ZodValidationPipe } from 'nestjs-zod';
import { DatabaseModule } from './db/database.module';
import { AuthModule } from './auth/auth.module';
import { GameModule } from './game/game.module';
import { LobbyModule } from './lobby/lobby.module';
import { HistoryModule } from './history/history.module';
import { MapsModule } from './maps/maps.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AccountModule } from './account/account.module';
import { PushModule } from './push/push.module';
import { OgModule } from './og/og.module';
import { ObservabilityModule } from './observability/observability.module';
import { HealthController } from './health/health.controller';
import { WellKnownController } from './health/well-known.controller';
import { MobileLinksConfig } from './config/mobile-links.config';
import { DocsController } from './openapi/docs.controller';
import { OpenApiHolder } from './openapi/openapi.holder';

// REST control plane: observability, database, auth, lobby, match history, the
// realtime hub (DI), health, and API docs. A global ZodValidationPipe validates every
// request body; a global ThrottlerGuard rate-limits the API (infra routes opt out).
@Module({
  imports: [
    ObservabilityModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 240 }]),
    DatabaseModule,
    AuthModule,
    MapsModule,
    GameModule,
    LobbyModule,
    HistoryModule,
    DashboardModule,
    AccountModule,
    PushModule,
    OgModule,
  ],
  controllers: [HealthController, DocsController, WellKnownController],
  providers: [
    OpenApiHolder,
    MobileLinksConfig,
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
