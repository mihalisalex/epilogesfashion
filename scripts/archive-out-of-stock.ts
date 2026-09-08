import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Takes the products in a category that have no stock out of the shop.
 *
 *   npx tsx scripts/archive-out-of-stock.ts tsantes            # dry run
 *   npx tsx scripts/archive-out-of-stock.ts tsantes --apply    # write
 *
 * **Archived, not deleted.** The catalogue's own note on `deleteProduct` is the reason:
 * deleting cascades into carts and wishlists and destroys the record of what was sold.
 * Archiving hides a product from the storefront and leaves everything else intact, so a
 * restock is one flip in the admin rather than importing the product again — which matters
 * here, where these arrived from a WooCommerce export that may not be repeatable.
 *
 * Stock is read from the size rows, not from `availableForSale`, because that flag is a
 * derived convenience while the size quantities are the thing the shop actually decrements
 * when someone buys. A product with a stale flag and real stock should stay.
 */
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const categorySlug = args.find((a) => !a.startsWith("--"));

async function main() {
  if (!categorySlug) {
    console.error("\n  Usage: npx tsx scripts/archive-out-of-stock.ts <category-slug> [--apply]\n");
    process.exitCode = 1;
    return;
  }

  const products = await prisma.product.findMany({
    where: { category: { slug: categorySlug }, status: { not: "archived" } },
    select: { id: true, name: true, status: true, sizes: { select: { quantity: true } } },
    orderBy: { name: "asc" },
  });

  const stockOf = (p: (typeof products)[number]) => p.sizes.reduce((total, size) => total + size.quantity, 0);
  const empty = products.filter((p) => stockOf(p) <= 0);
  const kept = products.filter((p) => stockOf(p) > 0);

  console.log(`\n  ${categorySlug} — ${apply ? "APPLYING" : "dry run (pass --apply to write)"}\n`);
  console.log(`  ${products.length} products, ${kept.length} with stock, ${empty.length} without\n`);
  console.log("  staying:");
  for (const p of kept) console.log(`    ${String(stockOf(p)).padStart(3)}  ${p.name.slice(0, 58)}`);

  if (empty.length === 0) {
    console.log("\n  Nothing to archive.\n");
    return;
  }

  if (!apply) {
    console.log(`\n  ${empty.length} would be archived. Dry run — nothing written.\n`);
    return;
  }

  const archived = await prisma.product.updateMany({
    where: { id: { in: empty.map((p) => p.id) } },
    data: { status: "archived", archivedAt: new Date() },
  });

  console.log(`\n  Archived ${archived.count}. They keep their images, prices and stock rows —`);
  console.log("  restoring one is a status change in the admin, not another import.\n");
}

main()
  .catch((error) => {
    console.error("\n  Failed:", error instanceof Error ? error.message : error, "\n");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
