import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import type { Request } from 'express';
import { DocumentsController, MAX_FILE_SIZE } from './documents.controller';
import type { DocumentsService } from './documents.service';
import type { SupabaseService } from '../supabase/supabase.service';

describe('DocumentsController', () => {
  let controller: DocumentsController;
  let mockDocumentsService: jest.Mocked<DocumentsService>;
  let mockSupabaseService: {
    getClient: jest.Mock;
    getAdminClient: jest.Mock;
  };
  let mockGetUser: jest.Mock;

  const validPdfBuffer = Buffer.from('%PDF-1.4 test valid content');

  const createMockFile = (
    overrides?: Partial<Express.Multer.File>,
  ): Express.Multer.File =>
    ({
      fieldname: 'file',
      originalname: 'test-document.pdf',
      encoding: '7bit',
      mimetype: 'application/pdf',
      size: validPdfBuffer.length,
      buffer: validPdfBuffer,
      destination: '',
      filename: '',
      path: '',
      stream: null as unknown,
      ...overrides,
    }) as Express.Multer.File;

  beforeEach(() => {
    jest.clearAllMocks();

    mockDocumentsService = {
      processAndStore: jest.fn().mockResolvedValue({
        chunks_created: 4,
        filename: 'test-document-1789211140000.pdf',
      }),
      listDocuments: jest.fn().mockResolvedValue([]),
      extractText: jest.fn(),
      chunkText: jest.fn(),
      generateEmbedding: jest.fn(),
      sanitizeFilename: jest.fn(),
    } as unknown as jest.Mocked<DocumentsService>;

    mockGetUser = jest.fn();
    mockSupabaseService = {
      getClient: jest.fn().mockReturnValue({
        auth: {
          getUser: mockGetUser,
        },
      }),
      getAdminClient: jest.fn().mockReturnValue({
        auth: {
          getUser: mockGetUser,
        },
      }),
    };

    controller = new DocumentsController(
      mockDocumentsService as unknown as DocumentsService,
      mockSupabaseService as unknown as SupabaseService,
    );
  });

  // ────────────────────────────────────────────────────────────
  // 1. Successful PDF upload
  // ────────────────────────────────────────────────────────────
  describe('1. Successful PDF upload', () => {
    it('returns success: true with chunks_created and sanitized filename', async () => {
      const mockFile = createMockFile();
      const mockReq = {
        user: { id: 'client-uuid-1' },
        headers: {},
        body: {},
      } as unknown as Request;

      const result = await controller.upload(mockFile, mockReq);

      expect(result).toEqual({
        success: true,
        chunks_created: 4,
        filename: 'test-document-1789211140000.pdf',
      });
      expect(mockDocumentsService.processAndStore).toHaveBeenCalledTimes(1);
    });
  });

  // ────────────────────────────────────────────────────────────
  // 2. Missing file
  // ────────────────────────────────────────────────────────────
  describe('2. Missing file', () => {
    it('throws BadRequestException (400) when file is undefined', async () => {
      const mockReq = {
        user: { id: 'client-uuid-1' },
        headers: {},
        body: {},
      } as unknown as Request;

      await expect(controller.upload(undefined, mockReq)).rejects.toThrow(
        BadRequestException,
      );
      await expect(controller.upload(undefined, mockReq)).rejects.toThrow(
        'File is required',
      );
      expect(mockDocumentsService.processAndStore).not.toHaveBeenCalled();
    });

    it('throws BadRequestException (400) when file buffer is empty', async () => {
      const emptyFile = createMockFile({
        buffer: Buffer.alloc(0),
        size: 0,
      });
      const mockReq = {
        user: { id: 'client-uuid-1' },
        headers: {},
        body: {},
      } as unknown as Request;

      await expect(controller.upload(emptyFile, mockReq)).rejects.toThrow(
        BadRequestException,
      );
      await expect(controller.upload(emptyFile, mockReq)).rejects.toThrow(
        'Uploaded file buffer is empty',
      );
      expect(mockDocumentsService.processAndStore).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────
  // 3. Unsupported file type
  // ────────────────────────────────────────────────────────────
  describe('3. Unsupported file type', () => {
    it('throws UnsupportedMediaTypeException (415) for PNG images', async () => {
      const imageFile = createMockFile({
        mimetype: 'image/png',
        originalname: 'photo.png',
      });
      const mockReq = {
        user: { id: 'client-uuid-1' },
        headers: {},
        body: {},
      } as unknown as Request;

      await expect(controller.upload(imageFile, mockReq)).rejects.toThrow(
        UnsupportedMediaTypeException,
      );
      expect(mockDocumentsService.processAndStore).not.toHaveBeenCalled();
    });

    it('throws UnsupportedMediaTypeException (415) for text files', async () => {
      const textFile = createMockFile({
        mimetype: 'text/plain',
        originalname: 'notes.txt',
      });
      const mockReq = {
        user: { id: 'client-uuid-1' },
        headers: {},
        body: {},
      } as unknown as Request;

      await expect(controller.upload(textFile, mockReq)).rejects.toThrow(
        UnsupportedMediaTypeException,
      );
      expect(mockDocumentsService.processAndStore).not.toHaveBeenCalled();
    });

    it('throws UnsupportedMediaTypeException (415) for JSON files', async () => {
      const jsonFile = createMockFile({
        mimetype: 'application/json',
        originalname: 'data.json',
      });
      const mockReq = {
        user: { id: 'client-uuid-1' },
        headers: {},
        body: {},
      } as unknown as Request;

      await expect(controller.upload(jsonFile, mockReq)).rejects.toThrow(
        UnsupportedMediaTypeException,
      );
      expect(mockDocumentsService.processAndStore).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────
  // 4. File too large
  // ────────────────────────────────────────────────────────────
  describe('4. File too large', () => {
    it('throws PayloadTooLargeException (413) when file exceeds MAX_FILE_SIZE', async () => {
      const oversizedFile = createMockFile({
        size: MAX_FILE_SIZE + 1,
      });
      const mockReq = {
        user: { id: 'client-uuid-1' },
        headers: {},
        body: {},
      } as unknown as Request;

      await expect(controller.upload(oversizedFile, mockReq)).rejects.toThrow(
        PayloadTooLargeException,
      );
      expect(mockDocumentsService.processAndStore).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────
  // 5. DocumentsService success
  // ────────────────────────────────────────────────────────────
  describe('5. DocumentsService success', () => {
    it('passes file buffer, original filename, authenticated client ID and mimetype to DocumentsService', async () => {
      const mockFile = createMockFile({
        originalname: 'quarterly-report.pdf',
        mimetype: 'application/pdf',
      });
      const mockReq = {
        user: { id: 'org-tenant-42' },
        headers: {},
        body: {},
      } as unknown as Request;

      mockDocumentsService.processAndStore.mockResolvedValueOnce({
        chunks_created: 12,
        filename: 'quarterly-report-1789211140000.pdf',
      });

      const response = await controller.upload(mockFile, mockReq);

      expect(mockDocumentsService.processAndStore).toHaveBeenCalledWith({
        fileBuffer: mockFile.buffer,
        originalFilename: 'quarterly-report.pdf',
        clientId: 'org-tenant-42',
        mimetype: 'application/pdf',
      });
      expect(response).toEqual({
        success: true,
        chunks_created: 12,
        filename: 'quarterly-report-1789211140000.pdf',
      });
    });
  });

  // ────────────────────────────────────────────────────────────
  // 6. DocumentsService failure
  // ────────────────────────────────────────────────────────────
  describe('6. DocumentsService failure', () => {
    it('converts internal/database processing errors into sanitized InternalServerErrorException (500)', async () => {
      const mockFile = createMockFile();
      const mockReq = {
        user: { id: 'client-uuid-1' },
        headers: {},
        body: {},
      } as unknown as Request;

      mockDocumentsService.processAndStore.mockRejectedValue(
        new Error('Database connection failed: secret_db_key_123'),
      );

      await expect(controller.upload(mockFile, mockReq)).rejects.toThrow(
        InternalServerErrorException,
      );

      // Verify sanitized error message does NOT leak internal keys or DB details
      try {
        await controller.upload(mockFile, mockReq);
      } catch (err: unknown) {
        const error = err as Error;
        expect(error.message).not.toContain('secret_db_key_123');
        expect(error.message).not.toContain('Database connection failed');
        expect(error.message).toContain('Document processing failed');
      }
    });

    it('converts unreadable text/chunk errors into BadRequestException (400)', async () => {
      const mockFile = createMockFile();
      const mockReq = {
        user: { id: 'client-uuid-1' },
        headers: {},
        body: {},
      } as unknown as Request;

      mockDocumentsService.processAndStore.mockRejectedValue(
        new Error(
          'Could not extract readable text from this PDF. If this is a scanned document, ensure it has clear text.',
        ),
      );

      await expect(controller.upload(mockFile, mockReq)).rejects.toThrow(
        BadRequestException,
      );
      await expect(controller.upload(mockFile, mockReq)).rejects.toThrow(
        'Could not extract readable text from this PDF',
      );
    });
  });

  // ────────────────────────────────────────────────────────────
  // 7. Authenticated client ID passed correctly
  // ────────────────────────────────────────────────────────────
  describe('7. Authenticated client ID passed correctly', () => {
    it('uses req.user.id when present', async () => {
      const mockFile = createMockFile();
      const mockReq = {
        user: { id: 'client-authenticated-999' },
        headers: {},
        body: {},
      } as unknown as Request;

      await controller.upload(mockFile, mockReq);

      expect(mockDocumentsService.processAndStore).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'client-authenticated-999',
        }),
      );
    });

    it('resolves authenticated user from Bearer token via Supabase Auth when req.user is absent', async () => {
      const mockFile = createMockFile();
      const mockReq = {
        headers: {
          authorization: 'Bearer supabase.valid.jwt.token',
        },
        body: {},
      } as unknown as Request;

      mockGetUser.mockResolvedValueOnce({
        data: {
          user: { id: 'supabase-user-xyz' },
        },
        error: null,
      });

      await controller.upload(mockFile, mockReq);

      expect(mockGetUser).toHaveBeenCalledWith('supabase.valid.jwt.token');
      expect(mockDocumentsService.processAndStore).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'supabase-user-xyz',
        }),
      );
    });

    it('rejects with UnauthorizedException (401) when neither req.user nor valid Bearer token is provided', async () => {
      const mockFile = createMockFile();
      const mockReq = {
        headers: {},
        body: {},
      } as unknown as Request;

      await expect(controller.upload(mockFile, mockReq)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockDocumentsService.processAndStore).not.toHaveBeenCalled();
    });

    it('rejects with UnauthorizedException (401) when Bearer token is invalid/expired in Supabase', async () => {
      const mockFile = createMockFile();
      const mockReq = {
        headers: {
          authorization: 'Bearer invalid.or.expired.jwt',
        },
        body: {},
      } as unknown as Request;

      mockGetUser.mockResolvedValueOnce({
        data: { user: null },
        error: { message: 'Token expired' },
      });

      await expect(controller.upload(mockFile, mockReq)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockDocumentsService.processAndStore).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────
  // 8. Arbitrary clientId from body cannot override authenticated identity
  // ────────────────────────────────────────────────────────────
  describe('8. Arbitrary clientId from request body cannot override authenticated identity', () => {
    it('ignores clientId in request body and strictly uses authenticated identity', async () => {
      const mockFile = createMockFile();
      const mockReq = {
        user: { id: 'legitimate-tenant-123' },
        headers: {},
        body: {
          clientId: 'malicious-attacker-id',
          client_id: 'malicious-attacker-id-2',
        },
      } as unknown as Request;

      await controller.upload(mockFile, mockReq);

      expect(mockDocumentsService.processAndStore).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'legitimate-tenant-123',
        }),
      );
      expect(mockDocumentsService.processAndStore).not.toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'malicious-attacker-id',
        }),
      );
    });
  });

  // ────────────────────────────────────────────────────────────
  // 9. GET /api/documents (list)
  // ────────────────────────────────────────────────────────────
  describe('GET /api/documents', () => {
    it('returns documents for the authenticated client', async () => {
      const mockDocs = [
        {
          filename: 'doc-1.pdf',
          original_filename: 'Doc 1.pdf',
          chunks_count: 5,
          created_at: '2026-09-12T10:00:00.000Z',
        },
        {
          filename: 'doc-2.pdf',
          original_filename: 'Doc 2.pdf',
          chunks_count: 2,
          created_at: '2026-09-12T11:00:00.000Z',
        },
      ];

      mockDocumentsService.listDocuments.mockResolvedValueOnce(mockDocs);

      const mockReq = {
        user: { id: 'client-alpha-123' },
        headers: {},
      } as unknown as Request;

      const response = await controller.list(mockReq);

      expect(mockDocumentsService.listDocuments).toHaveBeenCalledWith(
        'client-alpha-123',
      );
      expect(response).toEqual({
        success: true,
        documents: mockDocs,
      });
    });

    it('excludes another client documents and queries strictly by authenticated client', async () => {
      mockDocumentsService.listDocuments.mockResolvedValueOnce([]);

      const mockReq = {
        user: { id: 'client-current' },
        headers: {},
      } as unknown as Request;

      await controller.list(mockReq);

      expect(mockDocumentsService.listDocuments).toHaveBeenCalledWith(
        'client-current',
      );
      expect(mockDocumentsService.listDocuments).not.toHaveBeenCalledWith(
        'client-other',
      );
    });

    it('ignores any clientId/client_id in query params or body', async () => {
      mockDocumentsService.listDocuments.mockResolvedValueOnce([]);

      const mockReq = {
        user: { id: 'legit-authenticated-user' },
        query: {
          clientId: 'attacker-client-query',
          client_id: 'attacker-client-query-2',
        },
        body: {
          clientId: 'attacker-client-body',
        },
        headers: {},
      } as unknown as Request;

      await controller.list(mockReq);

      expect(mockDocumentsService.listDocuments).toHaveBeenCalledWith(
        'legit-authenticated-user',
      );
      expect(mockDocumentsService.listDocuments).not.toHaveBeenCalledWith(
        'attacker-client-query',
      );
      expect(mockDocumentsService.listDocuments).not.toHaveBeenCalledWith(
        'attacker-client-body',
      );
    });

    it('returns empty array when client has no documents', async () => {
      mockDocumentsService.listDocuments.mockResolvedValueOnce([]);

      const mockReq = {
        user: { id: 'client-with-no-docs' },
        headers: {},
      } as unknown as Request;

      const response = await controller.list(mockReq);

      expect(response).toEqual({
        success: true,
        documents: [],
      });
    });

    it('resolves authenticated identity from Bearer token via Supabase Auth', async () => {
      mockDocumentsService.listDocuments.mockResolvedValueOnce([]);

      const mockReq = {
        headers: {
          authorization: 'Bearer supabase.token.list',
        },
      } as unknown as Request;

      mockGetUser.mockResolvedValueOnce({
        data: {
          user: { id: 'supabase-token-client' },
        },
        error: null,
      });

      const response = await controller.list(mockReq);

      expect(mockGetUser).toHaveBeenCalledWith('supabase.token.list');
      expect(mockDocumentsService.listDocuments).toHaveBeenCalledWith(
        'supabase-token-client',
      );
      expect(response).toEqual({
        success: true,
        documents: [],
      });
    });

    it('throws UnauthorizedException (401) for unauthenticated requests', async () => {
      const mockReq = {
        headers: {},
      } as unknown as Request;

      await expect(controller.list(mockReq)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockDocumentsService.listDocuments).not.toHaveBeenCalled();
    });

    it('throws sanitized InternalServerErrorException (500) on service/database failure', async () => {
      mockDocumentsService.listDocuments.mockRejectedValue(
        new Error('Database query failure: confidential_error_details'),
      );

      const mockReq = {
        user: { id: 'client-err' },
        headers: {},
      } as unknown as Request;

      await expect(controller.list(mockReq)).rejects.toThrow(
        InternalServerErrorException,
      );

      try {
        await controller.list(mockReq);
      } catch (err: unknown) {
        const error = err as Error;
        expect(error.message).not.toContain('confidential_error_details');
        expect(error.message).toContain('Failed to retrieve documents');
      }
    });
  });
});
