import { Module } from '@nestjs/common';
import { ServiceRatesController } from './service-rates.controller.js';
import { ServiceRatesService } from './service-rates.service.js';

@Module({
  controllers: [ServiceRatesController],
  providers: [ServiceRatesService],
  exports: [ServiceRatesService],
})
export class ServiceRatesModule {}
