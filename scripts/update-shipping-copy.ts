import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Renames the home-delivery rate and shortens its quoted lead time.
 *
 *   npx tsx scripts/update-shipping-copy.ts            # dry run — prints, writes nothing
 *   npx tsx scripts/update-shipping-copy.ts --apply    # actually writes
 *
 * ## Why a script and not just editing data/shipping.json
 *
 * That file is only the fallback for a fresh install. The authoritative copy lives in the
 * `site_content` row keyed "shipping", so editing the JSON alone changes nothing a customer
 * sees — the same trap that let the demo domain and an English announcement bar survive for
 * months. Both are updated: the JSON so a new install starts correct, this row so the live
 * shop does.
 *
 * Everything else in the row is left exactly as found — including the several hundred remote
 * postal codes, which is precisely why this edits one rate in place rather than writing a
 * fresh settings object over the top.
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const apply = process.argv.includes("--apply");

const CHANGES: Record<string, { label: string; description: string; estimatedDelivery: string }> = {
  standard: {
    label: "Παράδοση στον χώρο σας",
    description: "ACS Courier · 1–3 εργάσιμες ημέρες",
    estimatedDelivery: "1–3 εργάσιμες ημέρες",
  },
};

interface Rate {
  id: string;
  label: string;
  description?: string;
  estimatedDelivery?: string;
  [key: string]: unknown;
}

async function main() {
  console.log(`\n  Shipping copy — ${apply ? "APPLYING" : "dry run (pass --apply to write)"}\n`);

  const row = await prisma.siteContent.findUnique({ where: { key: "shipping" } });
  if (!row) {
    console.log("  No site_content row for 'shipping' — the shop is on data/shipping.json, which is already updated.\n");
    return;
  }

  const settings = row.data as unknown as { rates: Rate[] };
  let changed = 0;

  const rates = settings.rates.map((rate) => {
    const next = CHANGES[rate.id];
    if (!next) return rate;
    const diffs = (Object.keys(next) as (keyof typeof next)[]).filter((field) => rate[field] !== next[field]);
    if (diffs.length === 0) {
      console.log(`  ${rate.id}: already up to date`);
      return rate;
    }
    console.log(`  ${rate.id}:`);
    for (const field of diffs) console.log(`    ${field}\n      - ${JSON.stringify(rate[field])}\n      + ${JSON.stringify(next[field])}`);
    changed += 1;
    return { ...rate, ...next };
  });

  if (changed === 0 || !apply) {
    console.log(changed === 0 ? "\n  Nothing to change.\n" : "\n  Dry run — nothing written.\n");
    return;
  }

  await prisma.siteContent.update({
    where: { key: "shipping" },
    // Spread the original so any field this script does not know about survives untouched.
    data: { data: { ...settings, rates } as never },
  });
  console.log(`\n  Updated ${changed} rate(s).\n`);
  console.log("  The checkout reads these per request, so the new label shows immediately.\n");
}

main()
  .catch((error) => {
    console.error("\n  Failed:", error instanceof Error ? error.message : error, "\n");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
