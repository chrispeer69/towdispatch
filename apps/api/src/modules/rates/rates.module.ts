import { Module } from '@nestjs/common';
import { DynamicPricingModule } from '../dynamic-pricing/dynamic-pricing.module.js';
import { RateEngineService } from './rate-engine.service.js';

@Module({
  imports: [DynamicPricingModule],
  providers: [RateEngineService],
  exports: [RateEngineService],
})
export class RatesModule {}
