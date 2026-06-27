import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { env } from '../config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { UserRepo } from './user.repo';
import { SessionRepo } from './session.repo';
import { AccessTokenGuard } from './access-token.guard';

@Module({
  imports: [JwtModule.register({ secret: env.jwtSecret })],
  controllers: [AuthController],
  providers: [AuthService, TokenService, UserRepo, SessionRepo, AccessTokenGuard],
  // Exported so the lobby can sign ws-game tickets and guard its routes.
  exports: [TokenService, AccessTokenGuard, UserRepo],
})
export class AuthModule {}
