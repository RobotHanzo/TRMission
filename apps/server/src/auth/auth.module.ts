import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { env } from '../config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { UserRepo } from './user.repo';
import { FeatureDefaultsRepo } from './feature-defaults.repo';
import { SessionRepo } from './session.repo';
import { MobileCodeRepo } from './mobile-code.repo';
import { AccessTokenGuard } from './access-token.guard';
import { FeatureGuard } from './feature.guard';
import { AuthConfig } from './auth-config';
import { OauthService } from './oauth.service';
import { OAUTH_HTTP, FetchOauthHttp } from './oauth.http';
import { GOOGLE_ID_TOKEN_VERIFIER, GoogleAuthLibraryVerifier } from './google-id-token.verifier';
import { APPLE_ID_TOKEN_VERIFIER, JoseAppleIdTokenVerifier } from './apple-id-token.verifier';
import { APPLE_REDIRECT_CLIENT, FetchAppleRedirectClient } from './apple-redirect.client';

@Module({
  imports: [JwtModule.register({ secret: env.jwtSecret })],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    UserRepo,
    FeatureDefaultsRepo,
    SessionRepo,
    MobileCodeRepo,
    AccessTokenGuard,
    FeatureGuard,
    AuthConfig,
    OauthService,
    { provide: OAUTH_HTTP, useClass: FetchOauthHttp },
    { provide: GOOGLE_ID_TOKEN_VERIFIER, useClass: GoogleAuthLibraryVerifier },
    { provide: APPLE_ID_TOKEN_VERIFIER, useClass: JoseAppleIdTokenVerifier },
    { provide: APPLE_REDIRECT_CLIENT, useClass: FetchAppleRedirectClient },
  ],
  // Exported so the lobby can sign ws-game tickets and guard its routes; SessionRepo
  // for the dashboard's per-user session counts + ban-time revocation; FeatureDefaultsRepo
  // for the dashboard's default-flags endpoint (Task 5).
  exports: [
    TokenService,
    AccessTokenGuard,
    FeatureGuard,
    UserRepo,
    FeatureDefaultsRepo,
    SessionRepo,
  ],
})
export class AuthModule {}
