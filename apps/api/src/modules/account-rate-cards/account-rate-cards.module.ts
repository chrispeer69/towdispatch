import { Module } from '@nestjs/common';
import { AccountRateCardsController } from './account-rate-cards.controller.js';
import { AccountRateCardsService } from './account-rate-cards.service.js';

@Module({
  controllers: [AccountRateCardsController],
  providers: [AccountRateCardsService],
  exports: [AccountRateCardsService],
})
export class AccountRateCardsModule {}
