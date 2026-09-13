import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module.js';
import { SarvamModule } from '../sarvam/sarvam.module.js';
import { VoiceSessionModule } from './voice-session.module.js';
import { ConversationModule } from './conversation.module.js';
import { CallsService } from './calls.service.js';
import { CallsController } from './calls.controller.js';
import { MediaStreamService } from './media-stream.service.js';
import { MediaStreamGateway } from './media-stream.gateway.js';

@Module({
  imports: [
    SupabaseModule,
    SarvamModule,
    VoiceSessionModule,
    ConversationModule,
  ],
  controllers: [CallsController],
  providers: [CallsService, MediaStreamService, MediaStreamGateway],
  exports: [CallsService, MediaStreamService, MediaStreamGateway],
})
export class CallsModule {}

