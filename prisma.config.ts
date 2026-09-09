import "dotenv/config";
import { defineConfig, env } from "@prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    /**
     * `DIRECT_URL` when set, otherwise the normal connection.
     *
     * This file is read ONLY by the Prisma CLI — migrate, db, studio. The running app
     * builds its own client from `process.env.DATABASE_URL` in lib/prisma.ts and never
     * loads this config, so changing it cannot affect the deployed shop.
     *
     * It matters because `DATABASE_URL` points at the pooled endpoint (PgBouncer in
     * transaction mode — Neon's `-pooler` host, or Supabase's connection pooler). That is
     * the right choice for the app — it is what keeps a serverless deployment from
     * exhausting the database's connection limit — but migrations take a session-level
     * advisory lock to stop two deploys applying the same migration at once, and a
     * transaction-mode pooler cannot hold one across statements. `prisma migrate deploy`
     * therefore fails against the pooled URL while ordinary queries through it work
     * perfectly, which is a confusing way to be blocked.
     *
     * `DIRECT_URL` is the same database without pooling. Set it in `.env` locally; it is
     * not needed in production, where nothing runs migrations.
     *
     * `POSTGRES_URL_NON_POOLING` / `POSTGRES_PRISMA_URL` are the names Vercel's native
     * Supabase integration writes instead of `DIRECT_URL` / `DATABASE_URL` when a Supabase
     * project is connected via the dashboard rather than typed into `.env` by hand — they
     * carry the same two connection strings this file already wants, just under the
     * integration's own names, so they're accepted as a fallback rather than requiring a
     * project connected that way to also duplicate both values under our names.
     */
    url:
      process.env.DIRECT_URL ||
      process.env.POSTGRES_URL_NON_POOLING ||
      env("DATABASE_URL"),
  },
  migrations: {
    seed: "tsx scripts/seed.ts",
  },
});
