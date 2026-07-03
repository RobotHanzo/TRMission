import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { env } from '../config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { UserRepo } from './user.repo';
import { SessionRepo } from './session.repo';
import { AccessTokenGuard } from './access-token.guard';
import { AuthConfig } from './auth-config';
import { OauthService } from './oauth.service';
import { OAUTH_HTTP, FetchOauthHttp } from './oauth.http';

@Module({
  imports: [JwtModule.register({ secret: env.jwtSecret })],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    UserRepo,
    SessionRepo,
    AccessTokenGuard,
    AuthConfig,
    OauthService,
    { provide: OAUTH_HTTP, useClass: FetchOauthHttp },
  ],
  // Exported so the lobby can sign ws-game tickets and guard its routes; SessionRepo
  // for the dashboard's per-user session counts + ban-time revocation.
  exports: [TokenService, AccessTokenGuard, UserRepo, SessionRepo],
})
export class AuthModule {}
