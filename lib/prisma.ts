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

function createPrismaClient() {
  /**
   * `POSTGRES_PRISMA_URL` is what Vercel's native Supabase integration names the pooled
   * connection string when a Supabase project is connected via the dashboard — same value
   * `DATABASE_URL` would hold otherwise, just under the integration's own name. See the
   * matching fallback in prisma.config.ts for the direct-connection half of this.
   */
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL;
  const adapter = new PrismaPg({
    connectionString,
    /**
     * Supabase's pooler presents a certificate chain Node's default trust store won't
     * validate — `pg` then refuses the connection with "self-signed certificate in
     * certificate chain" even though the connection is still encrypted. Prisma's own CLI
     * engine (what `prisma migrate deploy` uses) tolerates this chain natively; `pg`
     * (what this adapter wraps) enforces strict verification by default. Relaxed only when
     * actually routing through Supabase's URL — a directly configured `DATABASE_URL` (Neon
     * or otherwise) keeps full certificate verification.
     */
    ...(!process.env.DATABASE_URL && process.env.POSTGRES_PRISMA_URL
      ? { ssl: { rejectUnauthorized: false } }
      : {}),
  });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
