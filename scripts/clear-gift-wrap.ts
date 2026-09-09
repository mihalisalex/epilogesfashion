import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Clears the retired gift-wrap flag off checkouts that are still open.
 *
 *   npx tsx scripts/clear-gift-wrap.ts            # dry run — prints, writes nothing
 *   npx tsx scripts/clear-gift-wrap.ts --apply    # actually clears
 *
 * ## Why there is anything to clear
 *
 * Gift wrapping was retired from the UI, but `PATCH /api/checkout/[checkoutId]` went on
 * accepting `giftWrap` until it was closed today. So the note in `ShippingMethodStep` — that
 * nothing sets the flag any more — described the checkout steps rather than the system, and
 * two kinds of checkout can still be carrying it: any created before the checkbox came out,
 * and any that hit the route directly afterwards.
 *
 * That is not a stale display value. `OrderSummary` prices a live checkout through
 * `applyGiftWrap`, and order creation reads the same column, so an affected shopper is shown
 * a Δωροπεριτύλιξη fee, is charged it, **and has no control anywhere on the site that can take
 * it back off.** Which is how it was found: it appeared on the merchant's own cart.
 *
 * ## What this deliberately does not touch
 *
 * Completed checkouts and `Order` rows. An order that really was placed with wrapping was
 * charged for it and its confirmation email says so; rewriting that record to make a report
 * come out clean would be falsifying a receipt. Only checkouts a shopper can still return to
 * are in scope — for them the flag is a live charge, not history.
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const apply = process.argv.includes("--apply");

async function main() {
  console.log(`\n  Gift-wrap cleanup — ${apply ? "APPLYING" : "dry run (pass --apply to write)"}\n`);

  const affected = await prisma.checkout.findMany({
    where: { giftWrap: true, status: { not: "completed" } },
    select: { id: true, status: true, email: true, giftMessage: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  // Counted separately and left alone, so the number is visible rather than silently excluded.
  const completed = await prisma.checkout.count({ where: { giftWrap: true, status: "completed" } });

  if (affected.length === 0) {
    console.log("  No open checkout is carrying the flag.");
  } else {
    console.log(`  ${affected.length} open checkout(s) carrying a gift-wrap fee with no way to remove it:\n`);
    for (const checkout of affected) {
      console.log(
        `    ${checkout.id}  ${checkout.status.padEnd(16)} ${checkout.email ?? "(no email)"}` +
          `  started ${checkout.createdAt.toISOString()}${checkout.giftMessage ? "  [has a message]" : ""}`
      );
    }
  }
  console.log(`\n  ${completed} completed checkout(s) also carry it — left untouched, those were charged and delivered.\n`);

  if (!apply || affected.length === 0) return;

  // By explicit id, for the reason purge-e2e-data.ts gives: re-running the predicate at write
  // time could catch a row that appeared since the list above was printed.
  const cleared = await prisma.checkout.updateMany({
    where: { id: { in: affected.map((checkout) => checkout.id) } },
    data: { giftWrap: false, giftMessage: null },
  });

  console.log(`  Cleared ${cleared.count} checkout(s).\n`);
}

main()
  .catch((error) => {
    console.error("\n  Cleanup failed:", error instanceof Error ? error.message : error, "\n");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
