import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ConvinicarService } from './convinicar.service.js';
import { ConvinicarController } from './convinicar.controller.js';
import { DispatchEventsModule } from '../../modules/dispatch/dispatch-events.module.js';

@Module({
  imports: [ConfigModule, DispatchEventsModule],
  controllers: [ConvinicarController],
  providers: [ConvinicarService],
  exports: [ConvinicarService],
})
export class ConvinicarModule {}
