import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SarvamService } from './sarvam.service.js';

@Module({
  imports: [ConfigModule],
  providers: [SarvamService],
  exports: [SarvamService],
})
export class SarvamModule {}
