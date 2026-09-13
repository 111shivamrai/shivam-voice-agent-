import { Module } from '@nestjs/common';
import { VoiceSessionService } from './voice-session.service.js';

@Module({
  providers: [VoiceSessionService],
  exports: [VoiceSessionService],
})
export class VoiceSessionModule {}
