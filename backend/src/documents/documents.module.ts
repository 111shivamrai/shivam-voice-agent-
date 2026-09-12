import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service.js';

@Module({
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
