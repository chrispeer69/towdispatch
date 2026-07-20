import { Module } from '@nestjs/common';
import { ConvinicarService } from './convinicar.service.js';
import { ConvinicarController } from './convinicar.controller.js';

@Module({
  controllers: [ConvinicarController],
  providers: [ConvinicarService],
  exports: [ConvinicarService],
})
export class ConvinicarModule {}
