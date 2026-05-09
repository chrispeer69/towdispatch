import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtService } from './jwt.service.js';
import { PasswordService } from './password.service.js';
import { TotpService } from './totp.service.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, JwtService, PasswordService, TotpService],
  exports: [JwtService, PasswordService],
})
export class AuthModule {}
