import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    env: {
      DATABASE_URL: 'postgresql://hmis:hmis_dev_password@localhost:5432/hmis_test?schema=public',
      // The API under test runs as the restricted role, so every test also exercises row-level security.
      APP_DATABASE_URL: 'postgresql://hmis_app:hmis_app_dev_password@localhost:5432/hmis_test?schema=public',
      JWT_SECRET: 'test-secret',
    },
  },
});
