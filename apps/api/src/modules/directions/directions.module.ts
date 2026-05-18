import { Module } from '@nestjs/common';
import { DirectionsService } from './directions.service.js';

@Module({
  providers: [DirectionsService],
  exports: [DirectionsService],
})
export class DirectionsModule {}
