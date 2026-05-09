import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module.js';
import { RatesModule } from '../rates/rates.module.js';
import { JobsController } from './jobs.controller.js';
import { JobsService } from './jobs.service.js';

@Module({
  imports: [CustomersModule, RatesModule],
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
