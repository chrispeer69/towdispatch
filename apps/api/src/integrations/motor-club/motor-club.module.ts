import { Module } from '@nestjs/common';
import { AgeroStubProvider } from './agero-stub.provider.js';
import { MotorClubController } from './motor-club.controller.js';

@Module({
  controllers: [MotorClubController],
  providers: [AgeroStubProvider],
  exports: [AgeroStubProvider],
})
export class MotorClubModule {}
