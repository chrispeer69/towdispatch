import { Module } from '@nestjs/common';
import { ConvinicarService } from './convinicar.service';
import { ConvinicarController } from './convinicar.controller';

@Module({
  controllers: [ConvinicarController],
  providers: [ConvinicarService],
  exports: [ConvinicarService],
})
export class ConvinicarModule {}
