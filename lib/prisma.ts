import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Prisma 7's generated client requires an explicit driver adapter (no more
 * schema-embedded connection string). Next dev's hot-reload would otherwise
 * spawn a new PrismaClient — and a new Postgres connection pool — on every
 * edit, exhausting Neon's connection limit within minutes; the
 * globalThis-cached singleton is what prevents that.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Supabase's pooler presents a certificate chain Node's default trust store won't validate
 * — `pg` then refuses the connection with "self-signed certificate in certificate chain"
 * even though the connection is still encrypted. Prisma's own CLI engine (what
 * `prisma migrate deploy` uses) tolerates this chain natively; `pg` (what the adapter below
 * wraps) enforces strict verification by default, so this needs fixing on our side.
 *
 * The obvious fix — passing `ssl: { rejectUnauthorized: false }` as a sibling of
 * `connectionString` — does NOT work: `pg`'s ConnectionParameters merges a parsed
 * connection string over the rest of the config with `Object.assign({}, config,
 * parse(connectionString))`, so any `ssl` key the string implies always wins over one passed
 * alongside it. Supabase's URL sets `sslmode=require`, which pg-connection-string treats as
 * an alias for full verification (the "SECURITY WARNING" this produces at connect time is
 * that library naming the exact thing biting us here) — so the only way to actually relax
 * verification is through the string itself. `sslmode=no-verify` is the one mode
 * pg-connection-string maps to `rejectUnauthorized: false`, so it's swapped in here rather
 * than trusting the sibling option to survive the merge.
 */
function withRelaxedSslForSupabasePooler(connectionString: string): string {
  const url = new URL(connectionString);
  url.searchParams.set("sslmode", "no-verify");
  return url.toString();
}

function createPrismaClient() {
  /**
   * `POSTGRES_PRISMA_URL` is what Vercel's native Supabase integration names the pooled
   * connection string when a Supabase project is connected via the dashboard — same value
   * `DATABASE_URL` would hold otherwise, just under the integration's own name. See the
   * matching fallback in prisma.config.ts for the direct-connection half of this.
   */
  const usingSupabasePooler = !process.env.DATABASE_URL && !!process.env.POSTGRES_PRISMA_URL;
  const rawConnectionString = process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL;
  const connectionString =
    usingSupabasePooler && rawConnectionString
      ? withRelaxedSslForSupabasePooler(rawConnectionString)
      : rawConnectionString;
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
