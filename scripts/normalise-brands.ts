import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Sets each product's `brand` by finding a known brand inside its NAME.
 *
 *   npx tsx scripts/normalise-brands.ts tsantes            # dry run
 *   npx tsx scripts/normalise-brands.ts tsantes --apply    # write
 *
 * The bags import derived the brand from the first word of the name, which is wrong often
 * enough to matter once a brand filter exists: it produced "Guess" and "GUESS" as two brands,
 * cut "Versace V1969" to "Versace" and "Calvin Klein" to "Calvin", split "Polo VQF" into
 * "Polo" and "VQF" depending on word order, and read "Πορτοφόλι Valentino" as a brand called
 * Πορτοφόλι — the Greek word for wallet.
 *
 * A filter is only as good as the values behind it. Two spellings of one brand mean a shopper
 * filtering by Guess sees two thirds of the Guess bags and no hint that the rest exist.
 *
 * Matching a known list inside the name is deliberately not clever. It cannot invent a brand,
 * it is order-independent — "Polo VQF" and "VQF POLO" both resolve — and anything unmatched is
 * reported rather than guessed at.
 */
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const categorySlug = args.find((a) => !a.startsWith("--"));

/**
 * Longest first, so "Polo VQF" is tried before a bare "Polo" could ever match, and the
 * canonical spelling on the left is what gets stored.
 */
const BRANDS: { canonical: string; pattern: RegExp }[] = [
  { canonical: "Calvin Klein", pattern: /calvin\s*klein/i },
  { canonical: "Versace V1969", pattern: /versace/i },
  { canonical: "Polo VQF", pattern: /vqf/i },
  { canonical: "Valentino", pattern: /valentino/i },
  { canonical: "Guess", pattern: /guess/i },
  { canonical: "Desigual", pattern: /desigual/i },
  { canonical: "ELLE", pattern: /\belle\b/i },
];

async function main() {
  if (!categorySlug) {
    console.error("\n  Usage: npx tsx scripts/normalise-brands.ts <category-slug> [--apply]\n");
    process.exitCode = 1;
    return;
  }

  const products = await prisma.product.findMany({
    where: { category: { slug: categorySlug } },
    select: { id: true, name: true, brand: true },
    orderBy: { name: "asc" },
  });

  console.log(`\n  Brands in "${categorySlug}" — ${apply ? "APPLYING" : "dry run (pass --apply to write)"}\n`);

  const changes: { id: string; from: string; to: string; name: string }[] = [];
  const unmatched: string[] = [];

  for (const product of products) {
    const hit = BRANDS.find((brand) => brand.pattern.test(product.name));
    if (!hit) {
      unmatched.push(product.name);
      continue;
    }
    if (product.brand !== hit.canonical) {
      changes.push({ id: product.id, from: product.brand ?? "(none)", to: hit.canonical, name: product.name });
    }
  }

  const after = new Map<string, number>();
  for (const product of products) {
    const hit = BRANDS.find((b) => b.pattern.test(product.name));
    const value = hit?.canonical ?? product.brand ?? "(none)";
    after.set(value, (after.get(value) ?? 0) + 1);
  }

  console.log("  brands after this runs:");
  for (const [brand, count] of [...after].sort((a, b) => b[1] - a[1])) console.log(`    ${String(count).padStart(3)}  ${brand}`);

  console.log(`\n  ${changes.length} product(s) change brand:`);
  for (const change of changes.slice(0, 12)) console.log(`    ${change.from.padEnd(14)} -> ${change.to.padEnd(14)} ${change.name.slice(0, 44)}`);
  if (changes.length > 12) console.log(`    …and ${changes.length - 12} more`);

  if (unmatched.length) {
    console.log(`\n  ${unmatched.length} product(s) match no known brand and are left alone:`);
    for (const name of unmatched.slice(0, 8)) console.log(`    ${name.slice(0, 60)}`);
  }

  if (!apply || changes.length === 0) {
    console.log(changes.length ? "\n  Dry run — nothing written.\n" : "\n  Nothing to change.\n");
    return;
  }

  // Grouped by target so this is one statement per brand rather than one per product.
  const byBrand = new Map<string, string[]>();
  for (const change of changes) byBrand.set(change.to, [...(byBrand.get(change.to) ?? []), change.id]);
  for (const [brand, ids] of byBrand) {
    await prisma.product.updateMany({ where: { id: { in: ids } }, data: { brand } });
  }

  console.log(`\n  Updated ${changes.length} product(s).\n`);
}

main()
  .catch((error) => {
    console.error("\n  Failed:", error instanceof Error ? error.message : error, "\n");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
