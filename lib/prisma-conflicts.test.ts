import { describe, expect, it } from "vitest";
import { Prisma } from "@/lib/generated/prisma/client";
import { uniqueConflictMessage } from "@/lib/prisma-conflicts";

/**
 * Built the way Prisma builds them, rather than as a hand-shaped object, so the
 * `instanceof` check this function opens with is genuinely exercised. A plain literal would
 * pass every assertion below while the real thing fell through to `null` in production.
 */
function p2002(target: unknown) {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "7.9.1",
    meta: { target },
  });
}

describe("uniqueConflictMessage", () => {
  it("names the field the admin can actually see", () => {
    expect(uniqueConflictMessage(p2002(["sku"]), "product")).toBe("Another product already uses this SKU.");
    expect(uniqueConflictMessage(p2002(["slug"]), "product")).toBe("Another product already uses this slug.");
  });

  it("reads an index name as well as a column list", () => {
    // What Postgres reports through some Prisma versions instead of the field array.
    expect(uniqueConflictMessage(p2002("products_sku_key"), "product")).toBe("Another product already uses this SKU.");
  });

  /**
   * The case that produced the production 500 — a duplicate SKU has to come back as a
   * sentence, never as null, because null makes the caller rethrow.
   */
  it("never returns null for a P2002, whatever the target looks like", () => {
    for (const target of [undefined, [], ["internalOnlyColumn"], 42]) {
      expect(uniqueConflictMessage(p2002(target), "product")).toContain("Another product already uses");
    }
  });

  it("leaves anything that is not a uniqueness violation alone, so the caller rethrows", () => {
    const notFound = new Prisma.PrismaClientKnownRequestError("Record not found", {
      code: "P2025",
      clientVersion: "7.9.1",
    });
    expect(uniqueConflictMessage(notFound, "product")).toBeNull();
    expect(uniqueConflictMessage(new Error("connection reset"), "product")).toBeNull();
    expect(uniqueConflictMessage(null, "product")).toBeNull();
  });

  it("names the subject it was given", () => {
    expect(uniqueConflictMessage(p2002(["email"]), "account")).toBe("Another account already uses this email address.");
  });
});
