import { Module } from '@nestjs/common';
import { VoiceController } from './voice.controller.js';
import { SarvamModule } from '../sarvam/sarvam.module.js';
import { VoiceSessionModule } from './voice-session.module.js';
import { ConversationModule } from './conversation.module.js';
import { CallsModule } from './calls.module.js';

import { SupabaseModule } from '../supabase/supabase.module.js';

@Module({
  imports: [
    SupabaseModule,
    SarvamModule,
    VoiceSessionModule,
    ConversationModule,
    CallsModule,
  ],
  controllers: [VoiceController],
  exports: [
    SarvamModule,
    VoiceSessionModule,
    ConversationModule,
    CallsModule,
  ],
})
export class VoiceModule {}
