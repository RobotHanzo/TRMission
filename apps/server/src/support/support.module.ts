import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DISCORD_WEBHOOK, FetchDiscordWebhook } from './discord-webhook';
import { SupportConfig } from './support.config';
import { SupportController } from './support.controller';
import { SupportNotifier } from './support.notifier';

@Module({
  // For OptionalAccessTokenGuard's TokenService — the form itself needs no account.
  imports: [AuthModule],
  controllers: [SupportController],
  providers: [
    SupportConfig,
    SupportNotifier,
    { provide: DISCORD_WEBHOOK, useClass: FetchDiscordWebhook },
  ],
  // RatingsModule notifies the same webhook when a player rates the app.
  exports: [SupportNotifier, SupportConfig],
})
export class SupportModule {}
