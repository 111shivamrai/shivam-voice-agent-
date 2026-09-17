import { Module } from '@nestjs/common';
import { DeepgramService } from './deepgram.service.js';

@Module({
  providers: [DeepgramService],
  exports: [DeepgramService],
})
export class DeepgramModule {}
