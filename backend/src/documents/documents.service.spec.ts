/**
 * Unit tests for DocumentsService.
 *
 * External dependencies (pdf-parse, node-tesseract-ocr, openai) are all
 * mocked via jest.mock(). In ESM mode the mock factories run first and the
 * real module code is never executed, so we do NOT re-import those packages
 * directly in the test file — we retrieve them through jest.requireMock()
 * inside the tests to avoid the "exports is not defined" ESM/CJS clash.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DocumentsService } from './documents.service';
import { SupabaseService } from '../supabase/supabase.service';

// ──────────────────────────────────────────────────────────────
// Module-level mocks
// ──────────────────────────────────────────────────────────────

// pdf-parse — mocked as a named export { PDFParse }
jest.mock('pdf-parse', () => {
  const mockGetText = jest.fn();
  const MockPDFParse = jest.fn().mockImplementation(() => ({
    getText: mockGetText,
  }));
  return { PDFParse: MockPDFParse };
});

// node-tesseract-ocr — mocked as { recognize }
jest.mock('node-tesseract-ocr', () => ({
  recognize: jest.fn(),
}));

// openai — mocked so we never call the real API
jest.mock('openai', () => {
  const mockCreate = jest.fn();
  const MockOpenAI = jest.fn().mockImplementation(() => ({
    embeddings: { create: mockCreate },
  }));
  return { OpenAI: MockOpenAI };
});

// ──────────────────────────────────────────────────────────────
// Helpers to reach mock functions without importing the real modules
// ──────────────────────────────────────────────────────────────

function getPdfParseMock() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = jest.requireMock<any>('pdf-parse');
  // The MockPDFParse factory creates a new instance per `new PDFParse(...)`.
  // We need the mockGetText that the last-created instance holds.
  // Since the factory always re-uses the same jest.fn() for getText, we can
  // reach it via any instance created by the constructor mock.
  const instance = new mod.PDFParse();
  return instance.getText as jest.Mock;
}

function getEmbeddingsCreateMock(): jest.Mock {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = jest.requireMock<any>('openai');
  const instance = new mod.OpenAI();
  return instance.embeddings.create as jest.Mock;
}

function getTesseractRecognize(): jest.Mock {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (jest.requireMock<any>('node-tesseract-ocr') as { recognize: jest.Mock })
    .recognize;
}

// ──────────────────────────────────────────────────────────────
// Supabase builder factories
// ──────────────────────────────────────────────────────────────

let supabaseInsert: jest.Mock;
let supabaseDelete: jest.Mock;
let supabaseSelect: jest.Mock;
let selectEqMock: jest.Mock;
let selectOrderMock: jest.Mock;

function makeMockSupabaseClient() {
  const selectBuilder = {
    single: jest.fn().mockResolvedValue({ data: { id: 'uuid-1' }, error: null }),
  };

  const insertBuilder = {
    select: jest.fn().mockReturnValue(selectBuilder),
  };

  supabaseInsert = jest.fn().mockReturnValue(insertBuilder);

  const deleteBuilder = {
    eq: jest.fn(),
    error: null,
  };
  // each .eq() call returns the same builder (for chaining)
  deleteBuilder.eq.mockReturnValue(deleteBuilder);
  supabaseDelete = jest.fn().mockReturnValue(deleteBuilder);

  selectOrderMock = jest.fn().mockResolvedValue({ data: [], error: null });
  const orderChain = { order: selectOrderMock };
  selectEqMock = jest.fn().mockReturnValue(orderChain);
  const eqChain = { eq: selectEqMock };
  supabaseSelect = jest.fn().mockReturnValue(eqChain);

  return {
    from: jest.fn().mockReturnValue({
      insert: supabaseInsert,
      delete: supabaseDelete,
      select: supabaseSelect,
    }),
  };
}

// ──────────────────────────────────────────────────────────────
// Test suite
// ──────────────────────────────────────────────────────────────

describe('DocumentsService', () => {
  let service: DocumentsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const mockSupabaseClient = makeMockSupabaseClient();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'OPENAI_API_KEY' || key === 'openai.apiKey')
                return 'sk-test-key';
              return undefined;
            }),
          },
        },
        {
          provide: SupabaseService,
          useValue: {
            getAdminClient: jest.fn().mockReturnValue(mockSupabaseClient),
          },
        },
      ],
    }).compile();

    service = module.get<DocumentsService>(DocumentsService);
  });

  // ────────────────────────────────────────────────────────────
  // 1. Text cleaning
  // ────────────────────────────────────────────────────────────
  describe('cleanText (via extractText)', () => {
    it('removes non-printable control characters', async () => {
      const dirtySuffix = '\x00\x01\x02';
      const longText = 'word '.repeat(50) + dirtySuffix;
      getPdfParseMock().mockResolvedValue({ text: longText });

      const result = await service.extractText(Buffer.alloc(10), 'application/pdf');
      expect(result).not.toContain('\x00');
      expect(result).not.toContain('\x01');
    });

    it('collapses more than 2 consecutive newlines to at most 2', async () => {
      const text = 'word\n\n\n\n\nword ' + 'filler '.repeat(50);
      getPdfParseMock().mockResolvedValue({ text });

      const result = await service.extractText(Buffer.alloc(10), 'application/pdf');
      expect(result).not.toMatch(/\n{3,}/);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 2. Normal text extraction path (≥200 chars)
  // ────────────────────────────────────────────────────────────
  describe('extractText — normal path', () => {
    it('returns cleaned text when pdf-parse returns ≥200 chars', async () => {
      const longText = 'word '.repeat(60);
      getPdfParseMock().mockResolvedValue({ text: longText });

      const result = await service.extractText(Buffer.alloc(10), 'application/pdf');
      expect(result.length).toBeGreaterThanOrEqual(200);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 3. OCR fallback when extracted text is under 200 chars
  // ────────────────────────────────────────────────────────────
  describe('extractText — OCR fallback', () => {
    it('falls back to OCR when PDF text is under 200 chars', async () => {
      getPdfParseMock().mockResolvedValue({ text: 'short' });
      const ocrText = 'ocr word '.repeat(30);
      getTesseractRecognize().mockResolvedValue(ocrText);

      const result = await service.extractText(Buffer.alloc(10), 'application/pdf');

      expect(getTesseractRecognize()).toHaveBeenCalledTimes(1);
      expect(result.trim().length).toBeGreaterThan(0);
    });

    // ──────────────────────────────────────────────────────────
    // 4. Failure when OCR produces under 100 chars
    // ──────────────────────────────────────────────────────────
    it('throws when OCR returns under 100 chars', async () => {
      getPdfParseMock().mockResolvedValue({ text: 'tiny' });
      getTesseractRecognize().mockResolvedValue('barely');

      await expect(
        service.extractText(Buffer.alloc(10), 'application/pdf'),
      ).rejects.toThrow('Could not extract readable text from this PDF.');
    });

    it('throws when OCR itself throws an error', async () => {
      getPdfParseMock().mockResolvedValue({ text: 'tiny' });
      getTesseractRecognize().mockRejectedValue(new Error('Tesseract crashed'));

      await expect(
        service.extractText(Buffer.alloc(10), 'application/pdf'),
      ).rejects.toThrow('Could not extract readable text from this PDF.');
    });
  });

  // ────────────────────────────────────────────────────────────
  // 5 & 6. 400-word chunking with 50-word overlap
  // ────────────────────────────────────────────────────────────
  describe('chunkText', () => {
    const makeWords = (n: number) =>
      Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

    // 5. 400-word chunks
    it('produces chunks of exactly 400 words', () => {
      const text = makeWords(450);
      const chunks = service.chunkText(text);
      const firstChunkWords = chunks[0].split(' ');
      expect(firstChunkWords).toHaveLength(400);
    });

    // 6. 50-word overlap
    it('overlaps by 50 words between consecutive chunks', () => {
      const text = makeWords(800);
      const chunks = service.chunkText(text);
      expect(chunks.length).toBeGreaterThanOrEqual(2);

      const chunk0Words = chunks[0].split(' ');
      const chunk1Words = chunks[1].split(' ');

      const tail = chunk0Words.slice(-50).join(' ');
      const head = chunk1Words.slice(0, 50).join(' ');
      expect(head).toBe(tail);
    });

    // 7. Minimum 50-word chunk rule
    it('discards chunks smaller than 50 words', () => {
      const text = makeWords(30);
      const chunks = service.chunkText(text);
      expect(chunks).toHaveLength(0);
    });

    it('returns a single chunk for 50–400 words', () => {
      const text = makeWords(200);
      const chunks = service.chunkText(text);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].split(' ')).toHaveLength(200);
    });

    it('handles exactly 400 words as a single chunk', () => {
      const text = makeWords(400);
      const chunks = service.chunkText(text);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].split(' ')).toHaveLength(400);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 8. Filename sanitization
  // ────────────────────────────────────────────────────────────
  describe('sanitizeFilename', () => {
    it('lowercases and replaces spaces with hyphens', () => {
      const result = service.sanitizeFilename('My Document.pdf');
      expect(result).toMatch(/^my-document-\d+\.pdf$/);
    });

    it('removes special characters', () => {
      const result = service.sanitizeFilename('Report #1 & More!.pdf');
      expect(result).not.toMatch(/[#&!]/);
    });

    it('adds a numeric timestamp suffix', () => {
      const result = service.sanitizeFilename('test.pdf');
      expect(result).toMatch(/^test-\d+\.pdf$/);
    });

    it('strips path traversal characters', () => {
      const result = service.sanitizeFilename('../etc/passwd.pdf');
      expect(result).not.toContain('/');
    });

    it('falls back to "document" when the name part is empty', () => {
      const result = service.sanitizeFilename('.pdf');
      expect(result).toMatch(/^document-\d+\.pdf$/);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 9 & 10. Embedding success and retry behavior
  // ────────────────────────────────────────────────────────────
  describe('generateEmbedding', () => {
    const fakeEmbedding = Array.from({ length: 1536 }, () => 0.1);

    // 9. Embedding success
    it('returns a 1536-dimension embedding on first success', async () => {
      getEmbeddingsCreateMock().mockResolvedValue({
        data: [{ embedding: fakeEmbedding }],
      });

      const result = await service.generateEmbedding('some text', 0);
      expect(result).toHaveLength(1536);
      expect(getEmbeddingsCreateMock()).toHaveBeenCalledTimes(1);
    });

    // 10. Retry behavior
    it('retries once after a first failure and succeeds', async () => {
      getEmbeddingsCreateMock()
        .mockRejectedValueOnce(new Error('rate limit'))
        .mockResolvedValueOnce({ data: [{ embedding: fakeEmbedding }] });

      const result = await service.generateEmbedding('text', 1);
      expect(result).toHaveLength(1536);
      expect(getEmbeddingsCreateMock()).toHaveBeenCalledTimes(2);
    });

    // 11. Embedding second failure
    it('throws "Embedding generation failed" after two failures', async () => {
      getEmbeddingsCreateMock()
        .mockRejectedValueOnce(new Error('rate limit'))
        .mockRejectedValueOnce(new Error('rate limit again'));

      await expect(service.generateEmbedding('text', 2)).rejects.toThrow(
        'Embedding generation failed',
      );
      expect(getEmbeddingsCreateMock()).toHaveBeenCalledTimes(2);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 12. Successful document processing
  // ────────────────────────────────────────────────────────────
  describe('processAndStore', () => {
    const fakeEmbedding = Array.from({ length: 1536 }, () => 0.1);
    const longText = 'word '.repeat(500);

    beforeEach(() => {
      getPdfParseMock().mockResolvedValue({ text: longText });
      getEmbeddingsCreateMock().mockResolvedValue({
        data: [{ embedding: fakeEmbedding }],
      });
    });

    it('returns chunks_created and sanitized filename on success', async () => {
      const result = await service.processAndStore({
        fileBuffer: Buffer.alloc(10),
        originalFilename: 'Test Doc.pdf',
        clientId: 'client-abc',
      });

      expect(result.chunks_created).toBeGreaterThan(0);
      expect(result.filename).toMatch(/^test-doc-\d+\.pdf$/);
    });

    // ──────────────────────────────────────────────────────────
    // 13. Rollback when a chunk insert fails
    // ──────────────────────────────────────────────────────────
    it('rolls back and throws when a chunk insert fails', async () => {
      let callCount = 0;
      supabaseInsert.mockImplementation(() => {
        callCount++;
        if (callCount >= 2) {
          return {
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: null,
                error: { message: 'DB error' },
              }),
            }),
          };
        }
        return {
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: { id: 'uuid-1' }, error: null }),
          }),
        };
      });

      await expect(
        service.processAndStore({
          fileBuffer: Buffer.alloc(10),
          originalFilename: 'fail.pdf',
          clientId: 'client-xyz',
        }),
      ).rejects.toThrow('Document processing failed. No data was saved.');

      expect(supabaseDelete).toHaveBeenCalledTimes(1);
    });

    // ──────────────────────────────────────────────────────────
    // 14. Client ID isolation in database operations
    // ──────────────────────────────────────────────────────────
    it('includes clientId in every insert row', async () => {
      await service.processAndStore({
        fileBuffer: Buffer.alloc(10),
        originalFilename: 'secure.pdf',
        clientId: 'tenant-99',
      });

      for (const call of supabaseInsert.mock.calls) {
        const rowArg = call[0] as { client_id: string };
        expect(rowArg.client_id).toBe('tenant-99');
      }
    });

    it('includes clientId in rollback delete .eq() calls', async () => {
      // Force second insert to fail
      let n = 0;
      supabaseInsert.mockImplementation(() => {
        n++;
        if (n >= 2) {
          return {
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: null, error: { message: 'err' } }),
            }),
          };
        }
        return {
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: { id: 'id-1' }, error: null }),
          }),
        };
      });

      const eqSpy = jest.fn().mockReturnThis();
      const deleteResult = { eq: eqSpy };
      supabaseDelete.mockReturnValue(deleteResult);

      await expect(
        service.processAndStore({
          fileBuffer: Buffer.alloc(10),
          originalFilename: 'iso.pdf',
          clientId: 'client-isolation-test',
        }),
      ).rejects.toThrow('Document processing failed. No data was saved.');

      const eqCalls = eqSpy.mock.calls as [string, string][];
      const clientIdCall = eqCalls.find(([key]) => key === 'client_id');
      expect(clientIdCall).toBeDefined();
      expect(clientIdCall![1]).toBe('client-isolation-test');
    });
  });

  // ────────────────────────────────────────────────────────────
  // 15. listDocuments
  // ────────────────────────────────────────────────────────────
  describe('listDocuments', () => {
    it('queries document_chunks filtered strictly by clientId and ordered by created_at', async () => {
      selectOrderMock.mockResolvedValueOnce({
        data: [],
        error: null,
      });

      await service.listDocuments('client-alpha-100');

      expect(supabaseSelect).toHaveBeenCalledWith(
        'filename, original_filename, created_at',
      );
      expect(selectEqMock).toHaveBeenCalledWith('client_id', 'client-alpha-100');
      expect(selectOrderMock).toHaveBeenCalledWith('created_at', {
        ascending: false,
      });
    });

    it('groups multiple chunks belonging to the same document and aggregates chunk count', async () => {
      selectOrderMock.mockResolvedValueOnce({
        data: [
          {
            filename: 'handbook-1.pdf',
            original_filename: 'Employee Handbook.pdf',
            created_at: '2026-09-12T10:00:00.000Z',
          },
          {
            filename: 'handbook-1.pdf',
            original_filename: 'Employee Handbook.pdf',
            created_at: '2026-09-12T10:01:00.000Z',
          },
          {
            filename: 'handbook-1.pdf',
            original_filename: 'Employee Handbook.pdf',
            created_at: '2026-09-12T10:02:00.000Z',
          },
          {
            filename: 'guide-2.pdf',
            original_filename: 'User Guide.pdf',
            created_at: '2026-09-12T11:00:00.000Z',
          },
          {
            filename: 'guide-2.pdf',
            original_filename: 'User Guide.pdf',
            created_at: '2026-09-12T11:01:00.000Z',
          },
        ],
        error: null,
      });

      const documents = await service.listDocuments('client-beta-200');

      expect(documents).toHaveLength(2);

      const handbook = documents.find((d) => d.filename === 'handbook-1.pdf');
      expect(handbook).toBeDefined();
      expect(handbook?.original_filename).toBe('Employee Handbook.pdf');
      expect(handbook?.chunks_count).toBe(3);
      expect(handbook?.created_at).toBe('2026-09-12T10:00:00.000Z');

      const guide = documents.find((d) => d.filename === 'guide-2.pdf');
      expect(guide).toBeDefined();
      expect(guide?.original_filename).toBe('User Guide.pdf');
      expect(guide?.chunks_count).toBe(2);
      expect(guide?.created_at).toBe('2026-09-12T11:00:00.000Z');
    });

    it('returns an empty array when no chunks exist for client', async () => {
      selectOrderMock.mockResolvedValueOnce({
        data: [],
        error: null,
      });

      const documents = await service.listDocuments('client-empty');
      expect(documents).toEqual([]);
    });

    it('throws error when database query fails', async () => {
      selectOrderMock.mockResolvedValueOnce({
        data: null,
        error: { message: 'Database query failure' },
      });

      await expect(service.listDocuments('client-fail')).rejects.toThrow(
        'Failed to retrieve documents.',
      );
    });
  });
});
