import "dotenv/config";
import { Prisma, PrismaClient } from "@/lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import navigationData from "@/data/navigation.json";
import homepageData from "@/data/homepage.json";
import seoData from "@/data/seo.json";
import settingsData from "@/data/settings.json";

/**
 * Overwrites a `SiteContent` row with the current contents of its `data/*.json` file.
 *
 *   npx tsx scripts/sync-site-content.ts navigation           # dry run
 *   npx tsx scripts/sync-site-content.ts navigation --apply
 *
 * `scripts/seed.ts` seeds these four rows ONLY when they don't exist yet
 * (`seedSiteContentIfMissing`) — deliberately, so a real edit made through the admin CMS
 * is never silently clobbered by a redeploy. The flip side: once a row exists, editing its
 * `data/*.json` fixture and redeploying does nothing, because the seed step sees the row
 * is already there and skips it. This script is the other half — an explicit, opt-in
 * overwrite for when the JSON *is* the source of truth you want live (early-stage content
 * work, before anyone has used the CMS editors), matching the same dry-run/--apply shape
 * as apply-navigation-hrefs.ts and friends.
 *
 * Uses the same POSTGRES_PRISMA_URL fallback and Supabase sslmode rewrite as lib/prisma.ts
 * — see that file's comment for why the sslmode rewrite specifically, not a sibling `ssl`
 * option — so this runs the same way locally and inside a Vercel build step.
 */
const SOURCES: Record<string, unknown> = {
  navigation: navigationData,
  homepage: homepageData,
  seo: seoData,
  settings: settingsData,
};

/**
 * A plain `JSON.stringify(a) === JSON.stringify(b)` false-positives on every real diff check
 * here: Prisma round-trips `Json` fields through Postgres, which does not promise to
 * preserve object key order, so two semantically identical documents can stringify
 * differently purely because a key landed in a different position. Sorting keys
 * recursively before comparing (and only for the comparison — the written payload is the
 * data as authored) makes the diff check about content, not storage order.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonicalize(v)])
    );
  }
  return value;
}

function withRelaxedSslForSupabasePooler(connectionString: string): string {
  const url = new URL(connectionString);
  url.searchParams.set("sslmode", "no-verify");
  return url.toString();
}

const usingSupabasePooler = !process.env.DATABASE_URL && !!process.env.POSTGRES_PRISMA_URL;
const rawConnectionString = process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL;
const adapter = new PrismaPg({
  connectionString:
    usingSupabasePooler && rawConnectionString
      ? withRelaxedSslForSupabasePooler(rawConnectionString)
      : rawConnectionString,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  const [key, ...rest] = process.argv.slice(2).filter((arg) => arg !== "--apply");
  const apply = process.argv.includes("--apply");

  if (!key || !(key in SOURCES) || rest.length > 0) {
    console.error(`Usage: tsx scripts/sync-site-content.ts <${Object.keys(SOURCES).join("|")}> [--apply]`);
    process.exitCode = 1;
    return;
  }

  console.log(apply ? "APPLYING\n" : "DRY RUN — nothing will be written. Re-run with --apply.\n");

  const existing = await prisma.siteContent.findUnique({ where: { key } });
  const next = SOURCES[key];

  if (existing && JSON.stringify(canonicalize(existing.data)) === JSON.stringify(canonicalize(next))) {
    console.log(`"${key}" already matches data/${key}.json. Nothing to do.`);
    return;
  }

  console.log(existing ? `"${key}" exists and differs from data/${key}.json.` : `"${key}" does not exist yet.`);

  if (!apply) {
    console.log("Re-run with --apply to write it.");
    return;
  }

  await prisma.siteContent.upsert({
    where: { key },
    create: { key, data: next as Prisma.InputJsonValue },
    update: { data: next as Prisma.InputJsonValue },
  });
  console.log(`Wrote "${key}" from data/${key}.json.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
