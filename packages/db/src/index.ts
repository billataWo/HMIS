import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

export * from "./generated/prisma/client.js";

export type Db = PrismaClient;

const RAW = new Set(["$queryRaw", "$executeRaw", "$queryRawUnsafe", "$executeRawUnsafe"]);

/**
 * Wraps a client so every query runs with `app.tenant_id` set for its own transaction
 * (set_config(..., true)), which PostgreSQL row-level security policies read.
 *
 * The tenant is read synchronously when application code calls the query, i.e. still inside the
 * request's context. (Prisma 7's query interpreter does not carry Node's async context down to
 * the connection pool, so stamping connections at checkout is not reliable.)
 *
 * - `db.model.op(args)` and top-level raw queries become a two-statement batch transaction.
 * - `db.$transaction(async (tx) => …)` sets the tenant first; `tx` is the plain transaction client.
 * - `db.$transaction([...])` gets the setting prepended.
 */
function tenantScoped(base: PrismaClient, currentTenant: () => string | undefined): PrismaClient {
  const setTenant = (client: Pick<PrismaClient, "$executeRaw">, tenant: string) =>
    client.$executeRaw`SELECT set_config('app.tenant_id', ${tenant}, true)`;

  const scoped = <T>(run: () => Promise<T>): Promise<T> => {
    const tenant = currentTenant() ?? "";
    // `run()` must return an un-awaited PrismaPromise so it can join the batch.
    return base.$transaction([setTenant(base, tenant), run() as never]).then((r) => r[1] as T);
  };

  const modelProxy = (delegate: object) =>
    new Proxy(delegate, {
      get(target, op, receiver) {
        const value = Reflect.get(target, op, receiver);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => scoped(() => value.apply(target, args));
      },
    });

  return new Proxy(base, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "$transaction") {
        return (arg: unknown, options?: unknown) => {
          const tenant = currentTenant() ?? "";
          if (typeof arg === "function") {
            return target.$transaction(async (tx) => {
              await setTenant(tx, tenant);
              return (arg as (tx: unknown) => Promise<unknown>)(tx);
            }, options as never);
          }
          return target.$transaction([setTenant(target, tenant), ...(arg as never[])], options as never).then((r) => r.slice(1));
        };
      }
      if (typeof prop === "string" && RAW.has(prop) && typeof value === "function") {
        return (...args: unknown[]) => scoped(() => value.apply(target, args));
      }
      // Model delegates (patient, visit, …) are objects whose methods run queries.
      if (typeof prop === "string" && !prop.startsWith("$") && !prop.startsWith("_") && value && typeof value === "object") {
        return modelProxy(value);
      }
      return value;
    },
  });
}

/**
 * Creates a Prisma client. With `tenant`, queries run under row-level security for the tenant it
 * returns (connect as the non-owner hmis_app role); without it, the client is unrestricted (owner
 * role: migrations, seed, tests, and the few lookups that must span clinics, such as sign-in).
 */
export function createPrismaClient(databaseUrl = process.env.DATABASE_URL, opts: { tenant?: () => string | undefined } = {}): Db {
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  return opts.tenant ? tenantScoped(client, opts.tenant) : client;
}
