import type { NestExpressApplication } from '@nestjs/platform-express';
import { RequestShapePipe } from './common/request-shape.pipe.js';

/** HTTP settings of the API, shared by the server (main.ts) and the tests. */
export function configureApp(app: NestExpressApplication) {
  // Sync batches from clinic servers are up to about 0.5 MB of JSON.
  app.useBodyParser('json', { limit: '2mb' });
  // Record ids in paths must be UUIDs, query parameters single pieces of text (before each route's own schema).
  app.useGlobalPipes(new RequestShapePipe());
  // Don't advertise the server software.
  app.disable('x-powered-by');
  // API_BASE_PATH: serve every route under this path, e.g. "api" when a hosting platform routes
  // https://<site>/api to the API without removing the prefix (AletCloud app hosting).
  const basePath = process.env.API_BASE_PATH?.replace(/^\/+|\/+$/g, '');
  if (basePath) app.setGlobalPrefix(basePath);
  // Browsers never call the API directly (the web app does, server to server): allow only it.
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' });
}
