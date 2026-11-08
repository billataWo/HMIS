import type { NestExpressApplication } from '@nestjs/platform-express';

/** HTTP settings of the API, shared by the server (main.ts) and the tests. */
export function configureApp(app: NestExpressApplication) {
  // Sync batches from clinic servers are up to about 0.5 MB of JSON.
  app.useBodyParser('json', { limit: '2mb' });
  // Don't advertise the server software.
  app.disable('x-powered-by');
  // Browsers never call the API directly (the web app does, server to server): allow only it.
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' });
}
