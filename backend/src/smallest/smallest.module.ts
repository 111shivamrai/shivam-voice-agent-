import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SmallestService } from './smallest.service.js';

@Module({
  imports: [ConfigModule],
  providers: [SmallestService],
  exports: [SmallestService],
})
export class SmallestModule {}
