import './bootstrap/load-env.js';
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { loadEnv } from '@cacqa/config/env';
import { createLogger } from '@cacqa/core';

import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger({ service: 'api' }, { level: env.LOG_LEVEL });

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
    bodyParser: true,
  });

  app.enableCors({
    origin: env.API_CORS_ORIGIN.split(',').map((s) => s.trim()),
    credentials: true,
  });
  app.setGlobalPrefix('api');

  await app.listen(env.API_PORT);
  logger.info({ port: env.API_PORT }, 'API listening');
}

bootstrap().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('API boot failed:', err);
  process.exit(1);
});
