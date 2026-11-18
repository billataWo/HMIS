import { execSync } from 'node:child_process';
import path from 'node:path';
import { createPrismaClient } from '@hmis/db';

/**
 * Applies pending migrations to the separate hmis_test database and lets the restricted hmis_app
 * role log in. Nothing is wiped: each test run creates its own clinics and random phone numbers,
 * so data from earlier runs doesn't interfere.
 */
export default async function setup() {
  const env = {
    ...process.env,
    DATABASE_URL: 'postgresql://hmis:hmis_dev_password@localhost:5432/hmis_test?schema=public',
    APP_DATABASE_URL: 'postgresql://hmis_app:hmis_app_dev_password@localhost:5432/hmis_test?schema=public',
  };
  const cwd = path.resolve(import.meta.dirname, '../../../packages/db');
  execSync('npx prisma migrate deploy', { cwd, env, stdio: 'inherit' });
  execSync('npx tsx prisma/app-role.ts', { cwd, env, stdio: 'inherit' });

  // A second database playing a clinic server, for the sync tests (hmis_test plays the cloud).
  const admin = createPrismaClient(env.DATABASE_URL);
  await admin.$executeRawUnsafe('CREATE DATABASE hmis_test_edge').catch(() => undefined); // already there
  await admin.$disconnect();
  const edge = {
    ...process.env,
    DATABASE_URL: EDGE_URL,
    APP_DATABASE_URL: EDGE_APP_URL,
  };
  execSync('npx prisma migrate deploy', { cwd, env: edge, stdio: 'inherit' });
  execSync('npx tsx prisma/app-role.ts', { cwd, env: edge, stdio: 'inherit' });

  // A third, for the nightly backup's restore (it replaces all of that database's data).
  const admin2 = createPrismaClient(env.DATABASE_URL);
  await admin2.$executeRawUnsafe('CREATE DATABASE hmis_test_restore').catch(() => undefined);
  await admin2.$disconnect();
  execSync('npx prisma migrate deploy', { cwd, env: { ...process.env, DATABASE_URL: RESTORE_URL }, stdio: 'inherit' });
}

export const RESTORE_URL = 'postgresql://hmis:hmis_dev_password@localhost:5432/hmis_test_restore?schema=public';

export const EDGE_URL = 'postgresql://hmis:hmis_dev_password@localhost:5432/hmis_test_edge?schema=public';
export const EDGE_APP_URL = 'postgresql://hmis_app:hmis_app_dev_password@localhost:5432/hmis_test_edge?schema=public';
