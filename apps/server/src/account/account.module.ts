import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LobbyModule } from '../lobby/lobby.module';
import { HistoryModule } from '../history/history.module';
import { MapsModule } from '../maps/maps.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { PushModule } from '../push/push.module';
import { AccountController } from './account.controller';
import { AccountDeletionService } from './account-deletion.service';
import { APPLE_TOKEN_REVOKER, FetchAppleTokenRevoker } from './apple-token-revoker';

// Self-service account lifecycle. Separate module so it can import every domain it must
// cascade into without creating cycles (nothing imports AccountModule).
@Module({
  imports: [AuthModule, LobbyModule, HistoryModule, MapsModule, DashboardModule, PushModule],
  controllers: [AccountController],
  providers: [
    AccountDeletionService,
    { provide: APPLE_TOKEN_REVOKER, useClass: FetchAppleTokenRevoker },
  ],
})
export class AccountModule {}
