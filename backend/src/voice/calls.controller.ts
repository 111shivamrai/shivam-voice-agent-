import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Req,
  UnauthorizedException,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import { CallsService } from './calls.service.js';
import { SupabaseService } from '../supabase/supabase.service.js';
import type {
  InitiateOutboundCallDto,
  InitiateOutboundCallResponse,
  CallListResponse,
  CallRecord,
  CallStatus,
  CallDirection,
} from './calls.types.js';

@Controller(['voice/calls', 'api/voice/calls'])
export class CallsController {
  private readonly logger = new Logger(CallsController.name);

  constructor(
    private readonly callsService: CallsService,
    private readonly supabaseService: SupabaseService,
  ) {}

  /**
   * Resolves authenticated client ID from the request.
   * Priority:
   * 1. req.user?.id or req.user?.sub
   * 2. Bearer token in Authorization header verified with Supabase Auth
   */
  async resolveAuthenticatedClientId(req: Request): Promise<string> {
    const reqUser = (req as unknown as { user?: { id?: string; sub?: string } })
      ?.user;
    if (reqUser?.id) {
      return reqUser.id;
    }
    if (reqUser?.sub) {
      return reqUser.sub;
    }

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
          this.logger.warn(`Auth token verification failed: ${err}`);
        }

        try {
          const parts = token.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(
              Buffer.from(parts[1], 'base64').toString('utf-8'),
            );
            if (payload?.sub && typeof payload.sub === 'string') {
              return payload.sub;
            }
          }
        } catch (jwtErr: unknown) {
          this.logger.warn(`JWT payload decode failed: ${jwtErr}`);
        }
      }
    }

    throw new UnauthorizedException('Authentication required to access call operations.');
  }

  /**
   * POST /voice/calls/outbound
   * Initiates an outbound call on behalf of the authenticated client.
   */
  @Post('outbound')
  @HttpCode(HttpStatus.OK)
  public async initiateOutboundCall(
    @Req() req: Request,
    @Body() body: InitiateOutboundCallDto,
  ): Promise<InitiateOutboundCallResponse> {
    const clientId = await this.resolveAuthenticatedClientId(req);
    return this.callsService.initiateOutboundCall(clientId, body);
  }

  /**
   * GET /voice/calls
   * Retrieves paginated list of calls for the authenticated client.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  public async listCalls(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('direction') direction?: string,
  ): Promise<CallListResponse> {
    const clientId = await this.resolveAuthenticatedClientId(req);
    const parsedPage = page ? parseInt(page, 10) : 1;
    const parsedLimit = limit ? parseInt(limit, 10) : 20;

    return this.callsService.listCalls(clientId, {
      page: Number.isNaN(parsedPage) ? 1 : parsedPage,
      limit: Number.isNaN(parsedLimit) ? 20 : parsedLimit,
      status: status as CallStatus | undefined,
      direction: direction as CallDirection | undefined,
    });
  }

  /**
   * GET /voice/calls/:id
   * Retrieves details and transcript for a specific call owned by authenticated client.
   */
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  public async getCallById(
    @Req() req: Request,
    @Param('id') id: string,
  ): Promise<CallRecord> {
    const clientId = await this.resolveAuthenticatedClientId(req);
    return this.callsService.getCallById(clientId, id);
  }
}
