import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TwilioService } from './twilio.service.js';

@Module({
  imports: [ConfigModule],
  providers: [TwilioService],
  exports: [TwilioService],
})
export class TwilioModule {}
