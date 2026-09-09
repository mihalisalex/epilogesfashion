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
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
