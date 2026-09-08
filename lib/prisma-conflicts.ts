import { Prisma } from "@/lib/generated/prisma/client";

/**
 * Turns a unique-constraint violation into something a person can act on.
 *
 * Written after a real production 500: saving a product whose SKU already existed threw an
 * unhandled `PrismaClientKnownRequestError` straight out of a server action. `slug` had a prior
 * lookup guarding it and `sku` had nothing, so the admin got a crash where they should have got
 * a sentence. It reached Sentry before it reached anyone reading the code.
 *
 * **The constraint is the authority, not a prior lookup.** `admin/users/actions.ts` already
 * says why for duplicate emails: a lookup races two admins saving the same value at once, and
 * it only ever guards the one field somebody remembered to check. Catching P2002 covers every
 * unique column on the row, including ones added after this was written.
 *
 * Lives here rather than beside its caller because a `"use server"` module may only export
 * async functions — exporting this from the actions file type-checks and lints cleanly, then
 * fails `next build`.
 *
 * Returns null for anything that is not a uniqueness violation, so callers rethrow and the
 * error still reaches Sentry.
 */
export function uniqueConflictMessage(error: unknown, subject = "record"): string | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return null;

  const target = error.meta?.target;
  // Postgres reports an array of field names; some versions report the index name instead.
  const fields = Array.isArray(target) ? target.map(String) : typeof target === "string" ? [target] : [];

  /**
   * Only fields a person can see and edit on the form. An internal column colliding is a bug
   * rather than a typo, and naming it would send someone looking for a field that is not on
   * their screen — so those fall through to the generic sentence.
   */
  const readable: Record<string, string> = {
    sku: "SKU",
    slug: "slug",
    barcode: "barcode",
    email: "email address",
    code: "code",
  };

  // An index name like "products_sku_key" still contains the column, so match on inclusion.
  const field = fields
    .map((name) => Object.keys(readable).find((key) => name === key || name.includes(`_${key}_`)))
    .map((key) => (key ? readable[key] : undefined))
    .find(Boolean);

  return field
    ? `Another ${subject} already uses this ${field}.`
    : `Another ${subject} already uses one of these values.`;
}
