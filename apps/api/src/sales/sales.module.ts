import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller.js';
import { SalesService } from './sales.service.js';
import { TransactionsService } from './transactions.service.js';

@Module({
  controllers: [SalesController],
  providers: [SalesService, TransactionsService],
  exports: [SalesService],
})
export class SalesModule {}
