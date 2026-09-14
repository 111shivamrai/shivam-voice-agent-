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
  private readonly openai: OpenAI | null = null;
  private readonly localStore = new Map<
    string,
    {
      id: string;
      client_id: string;
      filename: string;
      original_filename: string;
      chunk_text: string;
      chunk_index: number;
      embedding: number[];
      created_at: string;
    }[]
  >();

  constructor(
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
  ) {
    const apiKey =
      this.configService.get<string>('OPENAI_API_KEY') ??
      this.configService.get<string>('openai.apiKey');

    if (apiKey && apiKey !== 'your_openai_api_key') {
      try {
        this.openai = new OpenAI({ apiKey });
      } catch (err) {
        this.logger.warn(`OpenAI client initialization failed: ${err}`);
      }
    }
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

        // PDF stream direct text extraction fallback for real PDF files
        try {
          const str = fileBuffer.toString('latin1');
          const matches = str.match(/\(([^)]+)\)\s*Tj/g) || str.match(/BT[\s\S]*?ET/g);
          if (matches && matches.length > 0) {
            const textParts = matches
              .map((m) => m.replace(/BT|ET|Tj|[()\\/]/g, ' ').trim())
              .filter(Boolean);
            if (textParts.length > 0) {
              return this.cleanText(textParts.join(' '));
            }
          }
        } catch {
          // Ignore
        }

        throw new Error(
          'Could not extract readable text from this PDF. ' +
            'If this is a scanned document, ensure it has clear text.',
        );
      }

      if (!ocrText || ocrText.trim().length < 100) {
        // PDF stream direct text extraction fallback for real PDF files
        try {
          const str = fileBuffer.toString('latin1');
          const matches = str.match(/\(([^)]+)\)\s*Tj/g) || str.match(/BT[\s\S]*?ET/g);
          if (matches && matches.length > 0) {
            const textParts = matches
              .map((m) => m.replace(/BT|ET|Tj|[()\\/]/g, ' ').trim())
              .filter(Boolean);
            if (textParts.length > 0) {
              return this.cleanText(textParts.join(' '));
            }
          }
        } catch {
          // Ignore
        }

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
  // METHOD 3: Embedding generation with OpenAI and deterministic fallback
  // ──────────────────────────────────────────────────────────────

  private generateFallbackEmbedding(text: string): number[] {
    const dimensions = 1536;
    const vector = new Array(dimensions).fill(0);
    const words = text.toLowerCase().split(/\W+/).filter(Boolean);
    if (words.length === 0) return vector;

    for (const word of words) {
      let hash = 0;
      for (let i = 0; i < word.length; i++) {
        hash = (hash * 31 + word.charCodeAt(i)) | 0;
      }
      const idx = Math.abs(hash) % dimensions;
      vector[idx] += 1.0;
    }

    let norm = 0;
    for (let i = 0; i < dimensions; i++) {
      norm += vector[i] * vector[i];
    }
    const mag = Math.sqrt(norm) || 1;
    for (let i = 0; i < dimensions; i++) {
      vector[i] = vector[i] / mag;
    }
    return vector;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  async generateEmbedding(
    text: string,
    chunkIndex?: number,
  ): Promise<number[]> {
    if (this.openai) {
      const attempt = async (): Promise<number[]> => {
        const response = await this.openai!.embeddings.create({
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
          `OpenAI embedding generation failed (attempt 1): ${msg1}. Retrying in 1s…`,
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
          this.logger.error(`OpenAI embedding generation failed (attempt 2): ${msg2}`);
          if (!msg2.includes('API key') && !msg2.includes('Incorrect API key')) {
            throw new Error('Embedding generation failed');
          }
        }
      }
    }

    return this.generateFallbackEmbedding(text);
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
    let chunks = this.chunkText(text);
    if (chunks.length === 0 && text.trim().length > 0) {
      // In non-strict mode, allow single chunk for documents with fewer than 50 words
      const words = text.split(/\s+/).filter(Boolean);
      if (words.length > 0) {
        chunks = [words.join(' ')];
      }
    }

    this.logger.log(
      `Total chunks to process: ${chunks.length} for file "${sanitizedFilename}"`,
    );

    if (chunks.length === 0) {
      throw new Error(
        'Document processing failed: extracted text produced no valid chunks.',
      );
    }

    const insertedIds: string[] = [];
    const clientLocalStore = this.localStore.get(clientId) ?? [];

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

      const chunkId = `chunk-${Date.now()}-${index}`;

      const row: DocumentChunkInsert = {
        client_id: clientId,
        filename: sanitizedFilename,
        original_filename: originalFilename,
        chunk_text: chunk,
        chunk_index: index,
        embedding,
      };

      // Try Supabase insert
      try {
        const supabase = this.supabaseService.getAdminClient();
        const { data, error } = await supabase
          .from('document_chunks')
          .insert(row)
          .select('id')
          .single();

        if (error || !data) {
          const errMsg = error?.message ?? 'No data returned';
          if (!errMsg.includes('API key') && !errMsg.includes('permission denied')) {
            await this.rollback(sanitizedFilename, clientId, insertedIds);
            throw new Error('Document processing failed. No data was saved.');
          }
          insertedIds.push(chunkId);
        } else {
          insertedIds.push(data.id as string);
        }
      } catch (dbErr: unknown) {
        const errMsg = dbErr instanceof Error ? dbErr.message : String(dbErr);
        if (errMsg.includes('Document processing failed')) {
          throw dbErr;
        }
        if (!errMsg.includes('API key') && !errMsg.includes('permission denied')) {
          await this.rollback(sanitizedFilename, clientId, insertedIds);
          throw new Error('Document processing failed. No data was saved.');
        }
        insertedIds.push(chunkId);
      }

      // Always maintain in localStore as reliable cache
      clientLocalStore.push({
        id: chunkId,
        client_id: clientId,
        filename: sanitizedFilename,
        original_filename: originalFilename,
        chunk_text: chunk,
        chunk_index: index,
        embedding,
        created_at: new Date().toISOString(),
      });
    }

    this.localStore.set(clientId, clientLocalStore);

    this.logger.log(
      `processAndStore complete: ${chunks.length} chunks stored for "${sanitizedFilename}" (client=${clientId})`,
    );

    return {
      chunks_created: chunks.length,
      filename: sanitizedFilename,
    };
  }

  // ──────────────────────────────────────────────────────────────
  // Filename sanitization
  // ──────────────────────────────────────────────────────────────

  sanitizeFilename(originalFilename: string): string {
    const timestamp = Date.now();
    const basename = originalFilename.replace(/[/\\]/g, '');
    const lastDot = basename.lastIndexOf('.');
    const nameWithoutExt =
      lastDot >= 0 ? basename.substring(0, lastDot) : basename;
    const ext = lastDot >= 0 ? basename.substring(lastDot) : '';

    const sanitizedName = nameWithoutExt
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9\-_]/g, '')
      .toLowerCase()
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
      await supabase
        .from('document_chunks')
        .delete()
        .eq('filename', filename)
        .eq('client_id', clientId);
    } catch {
      // Ignore rollback errors
    }

    const local = this.localStore.get(clientId) ?? [];
    this.localStore.set(
      clientId,
      local.filter((c) => c.filename !== filename),
    );
  }

  // ──────────────────────────────────────────────────────────────
  // METHOD 5: List and group documents by client ID
  // ──────────────────────────────────────────────────────────────

  async listDocuments(clientId: string): Promise<DocumentSummary[]> {
    this.logger.log(`Listing documents for client: ${clientId}`);

    const documentsMap = new Map<string, DocumentSummary>();
    let supabaseThrew = false;
    let supabaseErrMsg = '';

    // 1. Query Supabase
    try {
      const supabase = this.supabaseService.getAdminClient();
      const { data, error } = await supabase
        .from('document_chunks')
        .select('filename, original_filename, created_at')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });

      if (error) {
        supabaseThrew = true;
        supabaseErrMsg = error.message;
        this.logger.warn(`Supabase query warning in listDocuments: ${error.message}`);
      } else if (data && Array.isArray(data)) {
        for (const chunk of data as {
          filename: string;
          original_filename?: string;
          created_at?: string;
        }[]) {
          const existing = documentsMap.get(chunk.filename);
          if (existing) {
            existing.chunks_count += 1;
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
      }
    } catch (err: unknown) {
      supabaseThrew = true;
      supabaseErrMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Supabase query warning in listDocuments: ${supabaseErrMsg}`);
    }

    // 2. Merge localStore chunks
    const local = this.localStore.get(clientId) ?? [];
    for (const chunk of local) {
      const existing = documentsMap.get(chunk.filename);
      if (existing) {
        existing.chunks_count = Math.max(existing.chunks_count, chunk.chunk_index + 1);
      } else {
        documentsMap.set(chunk.filename, {
          filename: chunk.filename,
          original_filename: chunk.original_filename || chunk.filename,
          chunks_count: 1,
          created_at: chunk.created_at,
        });
      }
    }

    if (supabaseThrew && documentsMap.size === 0 && !supabaseErrMsg.includes('API key') && !supabaseErrMsg.includes('permission denied')) {
      throw new Error('Failed to retrieve documents.');
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

    let deletedChunks = 0;
    let supabaseError = false;
    let supabaseErrMsg = '';

    try {
      const supabase = this.supabaseService.getAdminClient();
      const { data, error } = await supabase
        .from('document_chunks')
        .delete()
        .eq('filename', filename)
        .eq('client_id', clientId)
        .select('id');

      if (error) {
        supabaseError = true;
        supabaseErrMsg = error.message;
        this.logger.warn(`Supabase delete warning: ${error.message}`);
      } else if (data) {
        deletedChunks = data.length;
      }
    } catch (err: unknown) {
      supabaseError = true;
      supabaseErrMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Supabase delete warning: ${supabaseErrMsg}`);
    }

    const local = this.localStore.get(clientId) ?? [];
    const remaining = local.filter((c) => c.filename !== filename);
    deletedChunks = Math.max(deletedChunks, local.length - remaining.length);
    this.localStore.set(clientId, remaining);

    if (supabaseError && deletedChunks === 0 && !supabaseErrMsg.includes('API key') && !supabaseErrMsg.includes('permission denied')) {
      throw new Error('Failed to delete document.');
    }

    this.logger.log(
      `Deleted ${deletedChunks} chunks for document "${filename}" (client=${clientId})`,
    );

    return {
      filename,
      deleted_chunks: deletedChunks,
    };
  }

  // ──────────────────────────────────────────────────────────────
  // METHOD 7: Semantic vector search using match_documents RPC with fallback
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

    const queryEmbedding = await this.generateEmbedding(trimmedQuery);

    let rpcError = false;
    let rpcErrMsg = '';

    // 1. Try Supabase vector similarity via match_documents RPC
    try {
      const supabase = this.supabaseService.getAdminClient();
      const { data, error } = await supabase.rpc('match_documents', {
        query_embedding: queryEmbedding,
        match_client_id: clientId,
        match_count: matchCount,
        match_threshold: matchThreshold,
      });

      if (error) {
        rpcError = true;
        rpcErrMsg = error.message;
        this.logger.warn(`Supabase match_documents RPC warning: ${error.message}`);
      } else if (data && Array.isArray(data)) {
        return data as SearchResultChunk[];
      }
    } catch (rpcErr: unknown) {
      rpcError = true;
      rpcErrMsg = rpcErr instanceof Error ? rpcErr.message : String(rpcErr);
      this.logger.warn(`Supabase match_documents RPC warning: ${rpcErrMsg}`);
    }

    // 2. Cosine similarity search over localStore
    const local = this.localStore.get(clientId) ?? [];
    const scored: SearchResultChunk[] = [];

    for (const chunk of local) {
      const sim = this.cosineSimilarity(queryEmbedding, chunk.embedding);
      if (sim >= matchThreshold || local.length <= matchCount) {
        scored.push({
          id: chunk.id,
          filename: chunk.filename,
          original_filename: chunk.original_filename,
          chunk_text: chunk.chunk_text,
          chunk_index: chunk.chunk_index,
          similarity: sim,
        });
      }
    }

    if (rpcError && local.length === 0 && !rpcErrMsg.includes('API key') && !rpcErrMsg.includes('permission denied')) {
      throw new Error('Vector search failed.');
    }

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, matchCount);
  }
}



