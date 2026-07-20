import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ConvinicarService } from './convinicar.service.js';
import { ConvinicarController } from './convinicar.controller.js';

@Module({
  imports: [ConfigModule],
  controllers: [ConvinicarController],
  providers: [ConvinicarService],
  exports: [ConvinicarService],
})
export class ConvinicarModule {}
