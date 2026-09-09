import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Moves a category's products back in time so a bulk import stops masquerading as new stock.
 *
 *   npx tsx scripts/backdate-products.ts tsantes 10            # dry run
 *   npx tsx scripts/backdate-products.ts tsantes 10 --apply    # write
 *
 * `/new-in` sorts by `createdAt` and applies no other filter, so importing 84 bags in one
 * afternoon put all of them at the top of New Arrivals ahead of stock that genuinely had just
 * landed. The date the row was written is not the date the product arrived in the shop, and
 * this is where those two facts get separated.
 *
 * Timestamps are spread across the target day by a minute per product rather than set to one
 * instant. Identical timestamps sort by `id` as a tiebreaker, which is stable but arbitrary —
 * an ordering nobody chose and nobody can change. A spread keeps the order the catalogue
 * already had.
 *
 * `updatedAt` is deliberately not touched: it means "when was this last edited", and this
 * edit really is happening now.
 */
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const positional = args.filter((a) => !a.startsWith("--"));
const categorySlug = positional[0];
const daysAgo = Number(positional[1]);

async function main() {
  if (!categorySlug || !Number.isFinite(daysAgo) || daysAgo <= 0) {
    console.error("\n  Usage: npx tsx scripts/backdate-products.ts <category-slug> <days-ago> [--apply]\n");
    process.exitCode = 1;
    return;
  }

  const products = await prisma.product.findMany({
    where: { category: { slug: categorySlug } },
    select: { id: true, name: true, createdAt: true, status: true },
    orderBy: { createdAt: "asc" },
  });

  if (products.length === 0) {
    console.log(`\n  No products in "${categorySlug}".\n`);
    return;
  }

  const target = new Date();
  target.setUTCDate(target.getUTCDate() - daysAgo);
  target.setUTCHours(9, 0, 0, 0);

  console.log(`\n  Backdate "${categorySlug}" — ${apply ? "APPLYING" : "dry run (pass --apply to write)"}\n`);
  console.log(`  ${products.length} products (all statuses) -> ${target.toISOString().slice(0, 16)}Z onwards, one minute apart\n`);
  console.log(`  from: ${products[0].createdAt.toISOString().slice(0, 16)}Z`);
  console.log(`  to:   ${products[products.length - 1].createdAt.toISOString().slice(0, 16)}Z`);

  if (!apply) {
    console.log("\n  Dry run — nothing written.\n");
    return;
  }

  for (const [index, product] of products.entries()) {
    await prisma.product.update({
      where: { id: product.id },
      data: { createdAt: new Date(target.getTime() + index * 60_000) },
    });
  }

  console.log(`\n  Moved ${products.length} product(s).`);
  console.log("  New Arrivals reads createdAt, so this takes effect on the next render.\n");
}

main()
  .catch((error) => {
    console.error("\n  Failed:", error instanceof Error ? error.message : error, "\n");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
