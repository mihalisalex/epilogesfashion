import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Ends the sale on one category — clears `salePriceAmount` so the product shows its ordinary
 * price and no "ΠΡΟΣΦΟΡΑ" badge.
 *
 *   npx tsx scripts/clear-sale-prices.ts gynaikeia-boots           # dry run — prints, writes nothing
 *   npx tsx scripts/clear-sale-prices.ts gynaikeia-boots --apply   # actually clears
 *
 * Dry run is the default because this changes what customers are charged. The list it prints
 * is the thing to check: every row shows the sale price being removed and the price that will
 * take its place, so a wrong category is obvious before anything is written.
 *
 * **Only `salePriceAmount` is touched.** `priceAmount` is the original price and is never
 * written, so this is reversible by putting the sale prices back — the dry run above is also
 * the record of what they were, which is why it prints them even in `--apply` mode.
 *
 * Carts already holding one of these products are deliberately NOT repriced. A cart stores the
 * price at the time it was added, and a shopper who put a boot in their basket at the sale
 * price should get it — quietly raising the price under them between adding and checking out is
 * the kind of thing that ends up in a consumer-protection complaint.
 */
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const slug = args.find((a) => !a.startsWith("--"));

async function main() {
  if (!slug) {
    console.error("\n  Usage: npx tsx scripts/clear-sale-prices.ts <category-slug> [--apply]\n");
    process.exitCode = 1;
    return;
  }

  const category = await prisma.category.findUnique({
    where: { slug },
    select: { id: true, name: true, nameEl: true },
  });
  if (!category) {
    console.error(`\n  No category with slug "${slug}".\n`);
    process.exitCode = 1;
    return;
  }

  const products = await prisma.product.findMany({
    where: { categoryId: category.id },
    select: { id: true, sku: true, name: true, status: true, priceAmount: true, salePriceAmount: true },
    orderBy: { name: "asc" },
  });

  const onSale = products.filter((p) => p.salePriceAmount != null);

  console.log(`\n  ${category.name} (${category.nameEl ?? "—"}) — ${apply ? "APPLYING" : "dry run (pass --apply to write)"}`);
  console.log(`  ${products.length} products in the category, ${onSale.length} currently on sale\n`);

  if (onSale.length === 0) {
    console.log("  Nothing to do.\n");
    return;
  }

  for (const p of onSale) {
    const was = Number(p.salePriceAmount);
    const now = Number(p.priceAmount);
    console.log(
      `    ${p.sku.padEnd(14)} ${p.name.slice(0, 46).padEnd(48)} ${was.toFixed(2)} -> ${now.toFixed(2)}` +
        `${p.status === "active" ? "" : `   [${p.status}]`}`
    );
  }

  if (!apply) {
    console.log("\n  Dry run — nothing written. The prices above are the record of what to restore.\n");
    return;
  }

  const cleared = await prisma.product.updateMany({
    // By explicit id: the list above was already printed, and re-running the predicate at write
    // time could pick up a product put on sale since.
    where: { id: { in: onSale.map((p) => p.id) } },
    data: { salePriceAmount: null },
  });

  console.log(`\n  Cleared the sale on ${cleared.count} product(s).`);
  console.log("  The storefront caches product pages, so run a redeploy or wait for revalidation.\n");
}

main()
  .catch((error) => {
    console.error("\n  Failed:", error instanceof Error ? error.message : error, "\n");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
