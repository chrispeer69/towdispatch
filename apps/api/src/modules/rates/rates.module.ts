import { Module } from '@nestjs/common';
import { RateEngineService } from './rate-engine.service.js';

@Module({
  providers: [RateEngineService],
  exports: [RateEngineService],
})
export class RatesModule {}
