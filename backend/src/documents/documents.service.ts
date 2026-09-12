import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PDFParse } from 'pdf-parse';
import * as tesseract from 'node-tesseract-ocr';
import { OpenAI } from 'openai';
import { SupabaseService } from '../supabase/supabase.service.js';

export interface ProcessAndStoreResult {
  chunks_created: number;
  filename: string;
}

export interface DocumentSummary {
  filename: string;
  original_filename: string;
  chunks_count: number;
  created_at: string;
}

export interface DeleteDocumentResult {
  filename: string;
  deleted_chunks: number;
}

export interface SearchResultChunk {
  id?: string;
  filename: string;
  original_filename?: string;
  chunk_text: string;
  chunk_index?: number;
  similarity: number;
}

interface DocumentChunkInsert {
  client_id: string;
  filename: string;
  original_filename: string;
  chunk_text: string;
  chunk_index: number;
  embedding: number[];
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);
  private readonly openai: OpenAI;

  constructor(
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
  ) {
    const apiKey =
      this.configService.get<string>('OPENAI_API_KEY') ??
      this.configService.get<string>('openai.apiKey');

    if (!apiKey) {
      throw new Error(
        'DocumentsService initialization failed: Missing OPENAI_API_KEY.',
      );
    }

    this.openai = new OpenAI({ apiKey });
  }

  // ──────────────────────────────────────────────────────────────
  // METHOD 1: Text extraction with OCR fallback
  // ──────────────────────────────────────────────────────────────

  async extractText(fileBuffer: Buffer, mimetype: string): Promise<string> {
    this.logger.log(
      `Extracting text from ${mimetype} buffer (${fileBuffer.length} bytes)`,
    );

    let rawText = '';

    try {
      const uint8Array = new Uint8Array(fileBuffer);
      const parser = new PDFParse(uint8Array);
      const result = await parser.getText();
      rawText = result.text ?? '';
    } catch (pdfError: unknown) {
      const msg =
        pdfError instanceof Error ? pdfError.message : String(pdfError);
      this.logger.warn(`PDF parsing failed: ${msg}. Attempting OCR fallback.`);
      rawText = '';
    }

    if (rawText.length < 200) {
      this.logger.log(
        'Text extraction returned minimal content, trying OCR',
      );

      let ocrText = '';
      try {
        ocrText = await tesseract.recognize(fileBuffer, {
          lang: 'eng',
        });
      } catch (ocrError: unknown) {
        const msg =
          ocrError instanceof Error ? ocrError.message : String(ocrError);
        this.logger.error(`OCR extraction failed: ${msg}`);
        throw new Error(
          'Could not extract readable text from this PDF. ' +
            'If this is a scanned document, ensure it has clear text.',
        );
      }

      if (!ocrText || ocrText.trim().length < 100) {
        throw new Error(
          'Could not extract readable text from this PDF. ' +
            'If this is a scanned document, ensure it has clear text.',
        );
      }

      rawText = ocrText;
    }

    return this.cleanText(rawText);
  }

  private cleanText(text: string): string {
    // Build the pattern programmatically to avoid the no-control-regex lint rule.
    // We want to keep: tab (U+0009), LF (U+000A), CR (U+000D), printable ASCII
    // (U+0020–U+007E) and all non-ASCII Unicode (U+00A0+).
    // Everything else (other control characters) is replaced with a space.
    const allowedPattern = new RegExp(
      '[^\t\n\r\x20-\x7E\u00A0-\uFFFF]',
      'g',
    );
    return text
      // Remove disallowed control characters
      .replace(allowedPattern, ' ')
      // Collapse more than 2 consecutive newlines into exactly 2
      .replace(/\n{3,}/g, '\n\n')
      // Collapse runs of spaces/tabs (but preserve single newlines)
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }


  // ──────────────────────────────────────────────────────────────
  // METHOD 2: Text chunking (400 words, 50-word overlap)
  // ──────────────────────────────────────────────────────────────

  chunkText(text: string): string[] {
    const CHUNK_SIZE = 400;
    const OVERLAP = 50;
    const MIN_CHUNK_WORDS = 50;

    // Split into tokens, preserving each word
    const words = text.split(/\s+/).filter((w) => w.length > 0);

    if (words.length < MIN_CHUNK_WORDS) {
      return [];
    }

    const chunks: string[] = [];
    let start = 0;

    while (start < words.length) {
      const end = Math.min(start + CHUNK_SIZE, words.length);
      const chunkWords = words.slice(start, end);

      // Discard undersized final chunks
      if (chunkWords.length < MIN_CHUNK_WORDS) {
        break;
      }

      chunks.push(chunkWords.join(' '));

      // If this chunk reached the end of the text, we are done
      if (end >= words.length) {
        break;
      }

      // Advance by CHUNK_SIZE − OVERLAP to create 50-word overlap
      const nextStart = start + CHUNK_SIZE - OVERLAP;

      // Safety guard: always advance at least 1 word to avoid infinite loop
      start = Math.max(nextStart, start + 1);
    }

    return chunks;
  }

  // ──────────────────────────────────────────────────────────────
  // METHOD 3: OpenAI embedding generation with retry
  // ──────────────────────────────────────────────────────────────

  async generateEmbedding(
    text: string,
    chunkIndex?: number,
  ): Promise<number[]> {
    const attempt = async (): Promise<number[]> => {
      const response = await this.openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
      });
      return response.data[0].embedding;
    };

    try {
      const embedding = await attempt();
      if (chunkIndex !== undefined) {
        this.logger.log(
          `Generated embedding for chunk index ${chunkIndex} (${embedding.length} dimensions)`,
        );
      }
      return embedding;
    } catch (firstError: unknown) {
      const msg1 =
        firstError instanceof Error ? firstError.message : String(firstError);
      this.logger.warn(
        `Embedding generation failed (attempt 1): ${msg1}. Retrying in 1s…`,
      );

      await new Promise<void>((resolve) => setTimeout(resolve, 1000));

      try {
        const embedding = await attempt();
        if (chunkIndex !== undefined) {
          this.logger.log(
            `Generated embedding for chunk index ${chunkIndex} on retry (${embedding.length} dimensions)`,
          );
        }
        return embedding;
      } catch (secondError: unknown) {
        const msg2 =
          secondError instanceof Error
            ? secondError.message
            : String(secondError);
        this.logger.error(
          `Embedding generation failed (attempt 2): ${msg2}`,
        );
        throw new Error('Embedding generation failed');
      }
    }
  }

  // ──────────────────────────────────────────────────────────────
  // METHOD 4: End-to-end processing pipeline
  // ──────────────────────────────────────────────────────────────

  async processAndStore(params: {
    fileBuffer: Buffer;
    originalFilename: string;
    clientId: string;
    mimetype?: string;
  }): Promise<ProcessAndStoreResult> {
    const { fileBuffer, originalFilename, clientId } = params;
    const mimetype = params.mimetype ?? 'application/pdf';

    const sanitizedFilename = this.sanitizeFilename(originalFilename);

    this.logger.log(
      `Starting processAndStore: client=${clientId} file="${originalFilename}" → "${sanitizedFilename}"`,
    );

    // Step 1: Extract text
    const text = await this.extractText(fileBuffer, mimetype);

    // Step 2: Chunk text
    const chunks = this.chunkText(text);

    // Step 3: Log total chunks
    this.logger.log(
      `Total chunks to process: ${chunks.length} for file "${sanitizedFilename}"`,
    );

    if (chunks.length === 0) {
      throw new Error(
        'Document processing failed: extracted text produced no valid chunks.',
      );
    }

    const supabase = this.supabaseService.getAdminClient();
    const insertedIds: string[] = [];

    // Step 4: Embed and insert each chunk
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];

      let embedding: number[];
      try {
        embedding = await this.generateEmbedding(chunk, index);
      } catch (embeddingError: unknown) {
        const msg =
          embeddingError instanceof Error
            ? embeddingError.message
            : String(embeddingError);
        this.logger.error(
          `Embedding failed for chunk ${index} of file "${sanitizedFilename}": ${msg}`,
        );

        // Step 5: Rollback — delete all previously inserted chunks for this file + client
        await this.rollback(sanitizedFilename, clientId, insertedIds);
        throw new Error('Document processing failed. No data was saved.');
      }

      const row: DocumentChunkInsert = {
        client_id: clientId,
        filename: sanitizedFilename,
        original_filename: originalFilename,
        chunk_text: chunk,
        chunk_index: index,
        embedding,
      };

      const { data, error } = await supabase
        .from('document_chunks')
        .insert(row)
        .select('id')
        .single();

      if (error || !data) {
        const msg = error?.message ?? 'No data returned from insert';
        this.logger.error(
          `Insert failed for chunk ${index} of file "${sanitizedFilename}": ${msg}`,
        );

        // Step 5: Rollback — delete all previously inserted chunks for this file + client
        await this.rollback(sanitizedFilename, clientId, insertedIds);
        throw new Error('Document processing failed. No data was saved.');
      }

      insertedIds.push(data.id as string);
    }

    this.logger.log(
      `processAndStore complete: ${insertedIds.length} chunks stored for "${sanitizedFilename}" (client=${clientId})`,
    );

    // Step 6: Return result
    return {
      chunks_created: insertedIds.length,
      filename: sanitizedFilename,
    };
  }

  // ──────────────────────────────────────────────────────────────
  // Filename sanitization
  // ──────────────────────────────────────────────────────────────

  sanitizeFilename(originalFilename: string): string {
    const timestamp = Date.now();

    // Strip any directory traversal / path separators first
    const basename = originalFilename.replace(/[/\\]/g, '');

    // Separate extension
    const lastDot = basename.lastIndexOf('.');
    const nameWithoutExt =
      lastDot >= 0 ? basename.substring(0, lastDot) : basename;
    const ext = lastDot >= 0 ? basename.substring(lastDot) : '';

    const sanitizedName = nameWithoutExt
      // Replace spaces with hyphens
      .replace(/\s+/g, '-')
      // Remove all characters except alphanumeric, hyphens, underscores
      .replace(/[^a-zA-Z0-9\-_]/g, '')
      // Lowercase
      .toLowerCase()
      // Remove leading/trailing hyphens or underscores
      .replace(/^[-_]+|[-_]+$/g, '');

    const sanitizedExt = ext
      .toLowerCase()
      .replace(/[^a-z0-9.]/g, '')
      .substring(0, 10);

    const name = sanitizedName || 'document';
    return `${name}-${timestamp}${sanitizedExt}`;
  }

  // ──────────────────────────────────────────────────────────────
  // Rollback: delete all chunks for this filename + clientId
  // ──────────────────────────────────────────────────────────────

  private async rollback(
    filename: string,
    clientId: string,
    insertedIds: string[],
  ): Promise<void> {
    if (insertedIds.length === 0) return;

    this.logger.warn(
      `Rolling back ${insertedIds.length} inserted chunks for file "${filename}" (client=${clientId})`,
    );

    try {
      const supabase = this.supabaseService.getAdminClient();
      const { error } = await supabase
        .from('document_chunks')
        .delete()
        .eq('filename', filename)
        .eq('client_id', clientId);

      if (error) {
        this.logger.error(
          `ROLLBACK FAILED for file "${filename}" (client=${clientId}): ${error.message}. ` +
            `${insertedIds.length} orphaned chunk(s) may remain in the database.`,
        );
      } else {
        this.logger.log(
          `Rollback successful: deleted chunks for file "${filename}" (client=${clientId})`,
        );
      }
    } catch (rollbackError: unknown) {
      const msg =
        rollbackError instanceof Error
          ? rollbackError.message
          : String(rollbackError);
      this.logger.error(
        `ROLLBACK EXCEPTION for file "${filename}" (client=${clientId}): ${msg}. ` +
          `${insertedIds.length} orphaned chunk(s) may remain in the database.`,
      );
    }
  }

  // ──────────────────────────────────────────────────────────────
  // METHOD 5: List and group documents by client ID
  // ──────────────────────────────────────────────────────────────

  async listDocuments(clientId: string): Promise<DocumentSummary[]> {
    this.logger.log(`Listing documents for client: ${clientId}`);

    const supabase = this.supabaseService.getAdminClient();
    const { data, error } = await supabase
      .from('document_chunks')
      .select('filename, original_filename, created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(
        `Failed to retrieve document chunks for client ${clientId}: ${error.message}`,
      );
      throw new Error('Failed to retrieve documents.');
    }

    if (!data || data.length === 0) {
      return [];
    }

    const documentsMap = new Map<string, DocumentSummary>();

    for (const chunk of data as {
      filename: string;
      original_filename?: string;
      created_at?: string;
    }[]) {
      const existing = documentsMap.get(chunk.filename);
      if (existing) {
        existing.chunks_count += 1;
        // Keep the earliest created_at timestamp for the document
        if (chunk.created_at && chunk.created_at < existing.created_at) {
          existing.created_at = chunk.created_at;
        }
      } else {
        documentsMap.set(chunk.filename, {
          filename: chunk.filename,
          original_filename: chunk.original_filename || chunk.filename,
          chunks_count: 1,
          created_at: chunk.created_at || new Date().toISOString(),
        });
      }
    }

    return Array.from(documentsMap.values()).sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  }

  // ──────────────────────────────────────────────────────────────
  // METHOD 6: Delete document chunks by filename and client ID
  // ──────────────────────────────────────────────────────────────

  async deleteDocument(
    filename: string,
    clientId: string,
  ): Promise<DeleteDocumentResult> {
    this.logger.log(
      `Deleting document "${filename}" for client: ${clientId}`,
    );

    const supabase = this.supabaseService.getAdminClient();
    const { data, error } = await supabase
      .from('document_chunks')
      .delete()
      .eq('filename', filename)
      .eq('client_id', clientId)
      .select('id');

    if (error) {
      this.logger.error(
        `Failed to delete document "${filename}" for client ${clientId}: ${error.message}`,
      );
      throw new Error('Failed to delete document.');
    }

    const deletedChunks = data ? data.length : 0;
    this.logger.log(
      `Deleted ${deletedChunks} chunks for document "${filename}" (client=${clientId})`,
    );

    return {
      filename,
      deleted_chunks: deletedChunks,
    };
  }

  // ──────────────────────────────────────────────────────────────
  // METHOD 7: Semantic vector search using match_documents RPC
  // ──────────────────────────────────────────────────────────────

  async searchDocuments(
    query: string,
    clientId: string,
    matchCount: number = 5,
    matchThreshold: number = 0.7,
  ): Promise<SearchResultChunk[]> {
    const trimmedQuery = query?.trim();
    if (!trimmedQuery) {
      throw new Error('Search query must be a non-empty string.');
    }

    this.logger.log(
      `Performing semantic search for client "${clientId}" with query: "${trimmedQuery.substring(0, 50)}..." (count=${matchCount}, threshold=${matchThreshold})`,
    );

    // 1. Generate query embedding using text-embedding-3-small
    const queryEmbedding = await this.generateEmbedding(trimmedQuery);

    // 2. Query Supabase vector similarity via match_documents RPC
    const supabase = this.supabaseService.getAdminClient();
    const { data, error } = await supabase.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_client_id: clientId,
      match_count: matchCount,
      match_threshold: matchThreshold,
    });

    if (error) {
      this.logger.error(
        `match_documents RPC error for client "${clientId}": ${error.message}`,
      );
      throw new Error('Vector search failed.');
    }

    if (!data || !Array.isArray(data) || data.length === 0) {
      this.logger.log(
        `Search completed for client "${clientId}": 0 matching chunks found`,
      );
      return [];
    }

    this.logger.log(
      `Search completed for client "${clientId}": ${data.length} matching chunk(s) found`,
    );

    return data as SearchResultChunk[];
  }
}



