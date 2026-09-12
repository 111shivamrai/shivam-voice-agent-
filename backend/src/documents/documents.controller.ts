import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  UseInterceptors,
  UploadedFile,
  Req,
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
  UnauthorizedException,
  InternalServerErrorException,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import 'multer';
import type { Request } from 'express';
import { DocumentsService, type DocumentSummary } from './documents.service.js';
import { SupabaseService } from '../supabase/supabase.service.js';

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export interface UploadResponse {
  success: boolean;
  chunks_created: number;
  filename: string;
}

export interface ListDocumentsResponse {
  success: boolean;
  documents: DocumentSummary[];
}

export interface DeleteDocumentResponse {
  success: boolean;
  filename: string;
  deleted_chunks: number;
}

@Controller('api/documents')
export class DocumentsController {
  private readonly logger = new Logger(DocumentsController.name);

  constructor(
    private readonly documentsService: DocumentsService,
    private readonly supabaseService: SupabaseService,
  ) {}

  /**
   * Resolves authenticated client ID from the request.
   *
   * Priority:
   * 1. req.user?.id or req.user?.sub (attached by an upstream AuthGuard / test context)
   * 2. Bearer token in Authorization header validated against Supabase Auth
   *
   * Rejects request if no valid authenticated identity is found.
   * NEVER reads or trusts clientId from the request body or query parameters.
   */
  async resolveAuthenticatedClientId(req: Request): Promise<string> {
    // 1. Check if user is already attached to request
    const reqUser = (req as unknown as { user?: { id?: string; sub?: string } })
      ?.user;
    if (reqUser?.id) {
      return reqUser.id;
    }
    if (reqUser?.sub) {
      return reqUser.sub;
    }

    // 2. Check Authorization: Bearer <token>
    const authHeader = req.headers?.authorization;
    if (
      authHeader &&
      typeof authHeader === 'string' &&
      authHeader.startsWith('Bearer ')
    ) {
      const token = authHeader.substring(7).trim();
      if (token) {
        try {
          const supabase = this.supabaseService.getClient();
          const { data, error } = await supabase.auth.getUser(token);
          if (!error && data?.user?.id) {
            return data.user.id;
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(`Bearer token verification failed: ${msg}`);
        }
      }
    }

    throw new UnauthorizedException(
      'Authentication required. Please provide a valid Bearer token in the Authorization header.',
    );
  }

  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: MAX_FILE_SIZE,
      },
      fileFilter: (_req, file, cb) => {
        if (file.mimetype !== 'application/pdf') {
          return cb(
            new UnsupportedMediaTypeException(
              'Unsupported media type. Only PDF documents (application/pdf) are allowed.',
            ),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ): Promise<UploadResponse> {
    // 1. Resolve and enforce authenticated client identity
    const authenticatedClientId =
      await this.resolveAuthenticatedClientId(req);

    // 2. Validate file presence
    if (!file) {
      throw new BadRequestException(
        'File is required. Please upload a PDF document using the "file" field.',
      );
    }

    // 3. Validate MIME type
    if (file.mimetype !== 'application/pdf') {
      throw new UnsupportedMediaTypeException(
        'Unsupported media type. Only PDF documents (application/pdf) are allowed.',
      );
    }

    // 4. Validate file size
    if (file.size > MAX_FILE_SIZE) {
      throw new PayloadTooLargeException(
        `File too large. Maximum allowed size is ${MAX_FILE_SIZE / (1024 * 1024)}MB.`,
      );
    }

    // 5. Validate file buffer content
    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Uploaded file buffer is empty.');
    }

    this.logger.log(
      `Processing document upload for client ${authenticatedClientId}: "${file.originalname}" (${file.size} bytes)`,
    );

    // 6. Process and store document with DocumentsService
    try {
      const result = await this.documentsService.processAndStore({
        fileBuffer: file.buffer,
        originalFilename: file.originalname || 'document.pdf',
        clientId: authenticatedClientId,
        mimetype: file.mimetype,
      });

      return {
        success: true,
        chunks_created: result.chunks_created,
        filename: result.filename,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);

      // Distinguish content/parsing validation errors from internal processing errors
      if (
        message.includes('Could not extract readable text') ||
        message.includes('produced no valid chunks')
      ) {
        this.logger.warn(
          `Document upload rejected for client ${authenticatedClientId}: ${message}`,
        );
        throw new BadRequestException(message);
      }

      // Sanitize unexpected or internal errors — do not leak credentials or internal details
      this.logger.error(
        `Document upload processing error for client ${authenticatedClientId}: ${message}`,
      );
      throw new InternalServerErrorException(
        'Document processing failed. Please verify the document and try again.',
      );
    }
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(@Req() req: Request): Promise<ListDocumentsResponse> {
    // 1. Resolve and enforce authenticated client identity
    const authenticatedClientId =
      await this.resolveAuthenticatedClientId(req);

    // 2. Query documents belonging strictly to the authenticated client
    try {
      const documents =
        await this.documentsService.listDocuments(authenticatedClientId);

      return {
        success: true,
        documents,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Document listing error for client ${authenticatedClientId}: ${message}`,
      );
      throw new InternalServerErrorException(
        'Failed to retrieve documents. Please try again later.',
      );
    }
  }

  @Delete(':filename')
  @HttpCode(HttpStatus.OK)
  async delete(
    @Param('filename') filename: string,
    @Req() req: Request,
  ): Promise<DeleteDocumentResponse> {
    // 1. Validate filename param
    if (!filename || filename.trim() === '') {
      throw new BadRequestException('Filename parameter is required.');
    }

    // 2. Resolve and enforce authenticated client identity
    const authenticatedClientId =
      await this.resolveAuthenticatedClientId(req);

    // 3. Delete document belonging strictly to the authenticated client
    try {
      const result = await this.documentsService.deleteDocument(
        filename.trim(),
        authenticatedClientId,
      );

      if (result.deleted_chunks === 0) {
        throw new NotFoundException(
          `Document "${filename}" not found.`,
        );
      }

      return {
        success: true,
        filename: result.filename,
        deleted_chunks: result.deleted_chunks,
      };
    } catch (err: unknown) {
      if (err instanceof NotFoundException) {
        throw err;
      }

      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Error deleting document "${filename}" for client ${authenticatedClientId}: ${message}`,
      );
      throw new InternalServerErrorException(
        'Failed to delete document. Please try again later.',
      );
    }
  }
}


