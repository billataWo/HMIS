import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Sync batches from clinic servers are up to about 0.5 MB of JSON.
  app.useBodyParser('json', { limit: '2mb' });
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' });
  await app.listen(process.env.API_PORT ?? 4000);
}
await bootstrap();
