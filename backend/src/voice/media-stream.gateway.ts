import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { URL } from 'url';
import { MediaStreamService } from './media-stream.service.js';

@Injectable()
export class MediaStreamGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MediaStreamGateway.name);
  private wss: WebSocketServer | null = null;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly mediaStreamService: MediaStreamService,
  ) {}

  public onModuleInit(): void {
    const server = this.adapterHost?.httpAdapter?.getHttpServer?.();
    if (!server) {
      this.logger.warn('HTTP server instance not available for WebSocket media streaming attachment.');
      return;
    }

    this.wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request: IncomingMessage, socket: any, head: Buffer) => {
      try {
        const parsedUrl = new URL(request.url ?? '', 'http://localhost');
        if (parsedUrl.pathname === '/voice/stream' || parsedUrl.pathname === '/voice/media-stream') {
          this.wss!.handleUpgrade(request, socket, head, (ws: WebSocket) => {
            this.wss!.emit('connection', ws, request);
          });
        }
      } catch (err: unknown) {
        this.logger.warn(`Error handling WebSocket upgrade: ${err}`);
      }
    });

    this.wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
      try {
        const parsedUrl = new URL(request.url ?? '', 'http://localhost');
        const urlCallControlId = parsedUrl.searchParams.get('call_control_id') ?? undefined;

        this.logger.log(`Telnyx Media WebSocket connected (callControlId: ${urlCallControlId ?? 'pending'})`);

        ws.on('message', async (data: string | Buffer) => {
          await this.mediaStreamService.handleWebSocketMessage(ws, data, urlCallControlId);
        });

        ws.on('close', () => {
          this.mediaStreamService.handleWebSocketClose(ws);
        });

        ws.on('error', (err) => {
          this.logger.warn(`Media WebSocket error: ${err}`);
          this.mediaStreamService.handleWebSocketClose(ws);
        });
      } catch (err: unknown) {
        this.logger.warn(`Error initializing WebSocket connection: ${err}`);
      }
    });

    this.logger.log('Telnyx MediaStreamGateway initialized on /voice/stream');
  }

  public onModuleDestroy(): void {
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
  }

  /**
   * Helper to access underlying WebSocketServer in testing.
   */
  public getWss(): WebSocketServer | null {
    return this.wss;
  }
}
