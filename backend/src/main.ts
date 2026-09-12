import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');
  const configService = app.get(ConfigService);

  // Security headers via Helmet
  app.use(helmet());

  // Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  // CORS Configuration: development frontend + configurable production / Vercel origins
  const configuredFrontendUrl =
    configService.get<string>('frontendUrl') ??
    configService.get<string>('FRONTEND_URL');

  const allowedOrigins: string[] = [
    'http://localhost:3000',
    ...(configuredFrontendUrl
      ? configuredFrontendUrl
          .split(',')
          .map((url) => url.trim())
          .filter((url) => url.length > 0)
      : []),
  ];

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Allow requests with no origin (e.g. mobile apps, server-to-server, curl)
      if (!origin) {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(
        new Error(`CORS error: Origin ${origin} is not allowed.`),
        false,
      );
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  const port =
    configService.get<number>('port') ??
    configService.get<number>('PORT') ??
    3001;

  await app.listen(port);
  logger.log(`Backend server listening on port ${port}`);
}

void bootstrap();
