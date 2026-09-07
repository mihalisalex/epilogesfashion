import { describe, expect, it, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { mergeCarts } from "@/services/carts";

/**
 * BUG-004. Merging a guest cart at sign-in used to delete the guest cart row, which cascades
 * through `checkouts.cartId` and takes its checkout sessions with it — including the one an
 * order points at. `Order.checkoutId` has no foreign key, so the database permits it silently
 * and the order is left pointing at nothing. One production order was orphaned exactly this
 * way before the guard below existed.
 *
 * The regression is invisible from the outside: the merge succeeds, the customer's basket is
 * correct, and the damage is to an order they placed weeks earlier. Nothing fails, no error is
 * logged, and it is only ever noticed by someone joining the two tables on purpose. That is
 * precisely the shape of defect this suite exists for.
 *
 * Both directions are asserted, because a guard that never deletes anything would also pass a
 * one-sided test while quietly turning every sign-in into a leaked cart row.
 *
 * Creates its own carts and cleans them up. The order row it needs is faked with a
 * `checkoutId` pointing at this test's own checkout — no real order, catalogue or payment row
 * is read or written.
 */

const created = { cartIds: [] as string[], orderIds: [] as string[] };

afterAll(async () => {
  await prisma.order.deleteMany({ where: { id: { in: created.orderIds } } });
  await prisma.cart.deleteMany({ where: { id: { in: created.cartIds } } });
  await prisma.$disconnect();
});

async function makeCart(): Promise<string> {
  const cart = await prisma.cart.create({ data: {} });
  created.cartIds.push(cart.id);
  return cart.id;
}

/**
 * A real catalogue product, because `cart_line_items.productId` is a foreign key. Read rather
 * than created: this test is about cart lifecycle, and inventing a product would add rows to
 * the catalogue for no benefit and one more thing to clean up.
 */
let productId: string | null = null;
async function anyProductId(): Promise<string> {
  if (!productId) {
    const product = await prisma.product.findFirst({ select: { id: true } });
    if (!product) throw new Error("no products in the database — cannot build a cart line item");
    productId = product.id;
  }
  return productId;
}

async function addItem(cartId: string, name: string): Promise<void> {
  await prisma.cartLineItem.create({
    data: {
      cartId,
      productId: await anyProductId(),
      slug: `test-${name}`,
      name,
      imageSrc: "/x.jpg",
      imageAlt: name,
      color: "Black",
      size: "40",
      unitPriceAmount: 10,
      quantity: 1,
      maxQuantity: 5,
    },
  });
}

/** A checkout on `cartId` that an order points at — the situation the guard is about. */
async function makeOrderedCheckout(cartId: string): Promise<void> {
  const checkout = await prisma.checkout.create({ data: { cartId, email: "buyer@example-real.gr", status: "completed" } });
  const order = await prisma.order.create({
    data: {
      checkoutId: checkout.id,
      customerEmail: "buyer@example-real.gr",
      lineItems: [],
      totals: {},
      shippingAddress: {},
      billingAddress: {},
      shippingRate: {},
    },
  });
  created.orderIds.push(order.id);
}

describe("mergeCarts, against the real database", () => {
  it("deletes an ordinary guest cart, as it always has", async () => {
    const guest = await makeCart();
    const customer = await makeCart();
    await addItem(guest, "Loafer");

    await mergeCarts(guest, customer);

    expect(await prisma.cart.findUnique({ where: { id: guest } })).toBeNull();
    expect(await prisma.cartLineItem.count({ where: { cartId: customer } })).toBe(1);
  });

  it("keeps a guest cart whose checkout an order points at, and does not orphan the order", async () => {
    const guest = await makeCart();
    const customer = await makeCart();
    await addItem(guest, "Oxford");
    await makeOrderedCheckout(guest);

    await mergeCarts(guest, customer);

    // The row survives, so the cascade never reaches the checkout the order names.
    expect(await prisma.cart.findUnique({ where: { id: guest } })).not.toBeNull();
    expect(await prisma.checkout.count({ where: { cartId: guest } })).toBe(1);

    const orphans = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) FROM orders o
      LEFT JOIN checkouts c ON c.id = o."checkoutId"
      WHERE c.id IS NULL AND o.id = ANY(${created.orderIds})
    `;
    expect(Number(orphans[0].count)).toBe(0);
  });

  it("still empties the kept cart, so the basket is not duplicated", async () => {
    const guest = await makeCart();
    const customer = await makeCart();
    await addItem(guest, "Derby");
    await makeOrderedCheckout(guest);

    await mergeCarts(guest, customer);

    // The whole point of the merge: the items moved. Leaving them on the kept row would give
    // the shopper their basket twice the next time anything read it.
    expect(await prisma.cartLineItem.count({ where: { cartId: guest } })).toBe(0);
    expect(await prisma.cartLineItem.count({ where: { cartId: customer } })).toBe(1);
  });
});
