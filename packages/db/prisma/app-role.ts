/**
 * Lets the API's restricted database role (hmis_app, created by the row-level-security migration)
 * log in, using the password from APP_DATABASE_URL. Run after migrating: `pnpm db:app-role`.
 * Uses the owner connection (DATABASE_URL). Safe to re-run.
 */
import "dotenv/config";
import pg from "pg";

const ownerUrl = process.env.DATABASE_URL;
const appUrl = process.env.APP_DATABASE_URL;
if (!ownerUrl || !appUrl) {
  console.error("Set both DATABASE_URL (owner) and APP_DATABASE_URL (hmis_app) first.");
  process.exit(1);
}

const app = new URL(appUrl);
const role = decodeURIComponent(app.username);
const password = decodeURIComponent(app.password);
if (role !== "hmis_app") {
  console.error(`APP_DATABASE_URL must connect as hmis_app (got "${role}").`);
  process.exit(1);
}
if (!password || password.length < 12) {
  console.error("Give hmis_app a password of at least 12 characters in APP_DATABASE_URL.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: ownerUrl });
await client.connect();
try {
  const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'hmis_app'");
  if (!exists.rowCount) throw new Error("Role hmis_app does not exist yet: run the migrations first.");
  // Identifiers and passwords can't be bound as parameters in ALTER ROLE; escape the literal.
  await client.query(`ALTER ROLE hmis_app WITH LOGIN PASSWORD '${password.replace(/'/g, "''")}'`);
  console.log("hmis_app can now log in.");
} finally {
  await client.end();
}
