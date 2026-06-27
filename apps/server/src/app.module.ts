import { Module } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { DatabaseModule } from './db/database.module';
import { AuthModule } from './auth/auth.module';
import { GameModule } from './game/game.module';
import { LobbyModule } from './lobby/lobby.module';
import { HistoryModule } from './history/history.module';
import { HealthController } from './health/health.controller';
import { DocsController } from './openapi/docs.controller';
import { OpenApiHolder } from './openapi/openapi.holder';

// REST control plane: database, auth, lobby, match history, the realtime hub (DI),
// health, and API docs. A global ZodValidationPipe validates every request body.
@Module({
  imports: [DatabaseModule, AuthModule, GameModule, LobbyModule, HistoryModule],
  controllers: [HealthController, DocsController],
  providers: [OpenApiHolder, { provide: APP_PIPE, useClass: ZodValidationPipe }],
})
export class AppModule {}
