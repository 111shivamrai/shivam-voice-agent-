import { Module } from '@nestjs/common';
import { VoiceController } from './voice.controller.js';
import { SarvamModule } from '../sarvam/sarvam.module.js';
import { VoiceSessionModule } from './voice-session.module.js';
import { ConversationModule } from './conversation.module.js';

@Module({
  imports: [
    SarvamModule,
    VoiceSessionModule,
    ConversationModule,
  ],
  controllers: [VoiceController],
  exports: [
    SarvamModule,
    VoiceSessionModule,
    ConversationModule,
  ],
})
export class VoiceModule {}
