import { Module } from '@nestjs/common';
import { ConversationService } from './conversation.service.js';
import { SupabaseModule } from '../supabase/supabase.module.js';

@Module({
  imports: [SupabaseModule],
  providers: [ConversationService],
  exports: [ConversationService],
})
export class ConversationModule {}
