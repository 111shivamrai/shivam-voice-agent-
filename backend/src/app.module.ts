import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { SupabaseModule } from './supabase/supabase.module';
import { DocumentsModule } from './documents/documents.module';
import { PaymentsModule } from './payments/payments.module.js';
import { SarvamModule } from './sarvam/sarvam.module.js';
import { VoiceSessionModule } from './voice/voice-session.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    SupabaseModule,
    DocumentsModule,
    PaymentsModule,
    SarvamModule,
    VoiceSessionModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

