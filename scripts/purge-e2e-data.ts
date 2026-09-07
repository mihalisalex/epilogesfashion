import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { isUndeliverableAddress } from "@/lib/email/deliverability";

/**
 * Removes the carts the browser suite leaves in the production database (BUG-003).
 *
 *   npx tsx scripts/purge-e2e-data.ts            # dry run — prints, writes nothing
 *   npx tsx scripts/purge-e2e-data.ts --apply    # actually deletes
 *
 * `playwright.config.ts` explains why the suite runs against production, and the price is
 * that every run leaves rows behind: a checkout holding `e2e-test@example.com`, and one empty
 * cart per browser context because `CartProvider` creates a cart on first page load. The mail
 * those first ones triggered is fixed at the sending boundary (`BUG-003`); this clears the
 * rows themselves.
 *
 * **Dry run is the DEFAULT here, unlike `purge-test-orders.ts`, which deletes unless told
 * otherwise.** That script worked from a hand-checked list of six known order ids. This one
 * selects by rule, and a rule that is slightly wrong on a live shop deletes a real shopper's
 * basket — the failure is silent, immediate, and looks to them like the site losing their
 * items. Opt in to writing.
 *
 * ## The rule that matters most
 *
 * **`Order.checkoutId` has no foreign key.** There is no `orders_checkoutId_fkey` in any
 * migration — it is a plain unique column. Meanwhile `checkouts.cartId` is `ON DELETE
 * CASCADE`. So deleting a cart silently deletes its checkouts, and *nothing in the database
 * will stop that from orphaning an order's pointer to the session that produced it*
 * (services/checkout.ts calls it "a permanent unique pointer"). Postgres will not save us
 * here, so the guard is in this file: **nothing an order references is ever a candidate.**
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

/**
 * How old an empty cart must be before it counts as debris rather than a shopper.
 *
 * A visitor reading a product page RIGHT NOW owns a cart with no line items, no customer and
 * no checkout — byte for byte what the e2e suite leaves behind. The only thing separating
 * them is age, so this is the entire safety margin for that group. Seven days is far past any
 * session and still clears the backlog.
 */
const EMPTY_CART_MIN_AGE_DAYS = 7;

interface Skipped {
  cartId: string;
  reason: string;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  /**
   * Every checkout id an order points at. Fetched up front and in full rather than checked
   * per candidate: this is the guard the database does not enforce, and it should not depend
   * on getting a per-row query right in two places.
   */
  const orderedCheckoutIds = new Set(
    (await prisma.order.findMany({ select: { checkoutId: true } })).map((order) => order.checkoutId),
  );

  // ── Group A: carts carrying a test/QA checkout ──────────────────────────────────────────
  const withCheckouts = await prisma.cart.findMany({
    where: { checkouts: { some: {} } },
    select: {
      id: true,
      customerId: true,
      createdAt: true,
      checkouts: { select: { id: true, email: true, status: true } },
      _count: { select: { lineItems: true } },
    },
  });

  const testCarts: typeof withCheckouts = [];
  const skipped: Skipped[] = [];

  for (const cart of withCheckouts) {
    const emails = cart.checkouts.map((checkout) => checkout.email).filter((email): email is string => Boolean(email));
    if (emails.length === 0 || !emails.some(isUndeliverableAddress)) continue;

    // The guard Postgres will not give us.
    if (cart.checkouts.some((checkout) => orderedCheckoutIds.has(checkout.id))) {
      skipped.push({ cartId: cart.id, reason: "an order points at one of its checkouts" });
      continue;
    }
    // A cart that carries BOTH a test address and a real one is a cart a real person touched.
    if (emails.some((email) => !isUndeliverableAddress(email))) {
      skipped.push({ cartId: cart.id, reason: `also holds a real address (${emails.filter((e) => !isUndeliverableAddress(e)).join(", ")})` });
      continue;
    }
    if (cart.customerId) {
      skipped.push({ cartId: cart.id, reason: "belongs to a signed-in customer" });
      continue;
    }
    testCarts.push(cart);
  }

  // ── Group B: empty guest carts left by browsing ─────────────────────────────────────────
  const cutoff = new Date(Date.now() - EMPTY_CART_MIN_AGE_DAYS * 24 * 60 * 60 * 1000);
  const emptyCarts = await prisma.cart.findMany({
    where: {
      customerId: null,
      createdAt: { lt: cutoff },
      lineItems: { none: {} },
      checkouts: { none: {} },
      discounts: { none: {} },
      giftCards: { none: {} },
    },
    select: { id: true, createdAt: true },
  });

  // ── Report ──────────────────────────────────────────────────────────────────────────────
  console.log(`\n  ${apply ? "PURGING" : "DRY RUN — nothing will be written"}\n`);

  console.log(`  A. Carts holding a test/QA checkout: ${testCarts.length}`);
  for (const cart of testCarts) {
    const addresses = cart.checkouts.map((checkout) => checkout.email ?? "—").join(", ");
    console.log(
      `     ${cart.id}  ${cart.createdAt.toISOString().slice(0, 10)}  ` +
        `${cart.checkouts.length} checkout(s), ${cart._count.lineItems} item(s)  ${addresses}`,
    );
  }

  if (skipped.length > 0) {
    console.log(`\n  Kept despite a test address: ${skipped.length}`);
    for (const entry of skipped) console.log(`     ${entry.cartId}  ${entry.reason}`);
  }

  console.log(`\n  B. Empty guest carts older than ${EMPTY_CART_MIN_AGE_DAYS} days: ${emptyCarts.length}`);
  if (emptyCarts.length > 0) {
    const oldest = emptyCarts.reduce((a, b) => (a.createdAt < b.createdAt ? a : b));
    const newest = emptyCarts.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
    console.log(`     ${oldest.createdAt.toISOString().slice(0, 10)} → ${newest.createdAt.toISOString().slice(0, 10)}`);
  }

  const total = await prisma.cart.count();
  console.log(`\n  ${testCarts.length + emptyCarts.length} of ${total} carts would go.`);

  /**
   * `BUG-004`'s regression check, reported here because this script already holds every
   * ordered checkout id and the invariant is the same one its safety guard exists to protect.
   *
   * It belongs somewhere runnable rather than in a remembered SQL string — the first version
   * of this check was handed over as a shell one-liner and did not survive the quoting around
   * `"checkoutId"`.
   *
   * Counted against the ids loaded BEFORE any deletion, so the number describes the database
   * as it was found, not as this script left it.
   */
  const liveCheckoutIds = new Set(
    (await prisma.checkout.findMany({ select: { id: true } })).map((checkout) => checkout.id),
  );
  const orphaned = [...orderedCheckoutIds].filter((id) => !liveCheckoutIds.has(id));
  console.log(
    `\n  Orders whose checkout pointer resolves to nothing (BUG-004): ${orphaned.length}` +
      (orphaned.length > 0 ? " — expected 1, more means it happened again" : ""),
  );

  if (!apply) {
    console.log("\n  Re-run with --apply to delete.\n");
    return;
  }

  /**
   * One `deleteMany` per group, by explicit id — never by re-running the predicates. The rows
   * were chosen and printed above; re-deriving them at write time would open a window in
   * which a cart created since the report qualifies for group B and is deleted without ever
   * having been shown.
   */
  const ids = [...testCarts.map((cart) => cart.id), ...emptyCarts.map((cart) => cart.id)];
  const deleted = await prisma.cart.deleteMany({ where: { id: { in: ids } } });

  console.log(`\n  Deleted ${deleted.count} carts (their checkouts, line items, discounts and`);
  console.log("  gift-card links went with them by cascade).\n");
}

main()
  .catch((error) => {
    console.error("\n  Purge failed:", error instanceof Error ? error.message : error, "\n");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
