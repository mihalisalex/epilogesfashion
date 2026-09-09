import { describe, expect, it } from "vitest";
import { SIZE_ORDER, SIZE_RUNS, expandSizeRun } from "@/constants/size-runs";

function totalPieces(id: string): number {
  const run = SIZE_RUNS.find((r) => r.id === id)!;
  return expandSizeRun(run).reduce((sum, size) => sum + size.quantity, 0);
}

describe("size runs", () => {
  it("each run holds the number of pieces its name claims", () => {
    // The label is what an owner checks against the delivery, so it has to be true.
    expect(totalPieces("A")).toBe(8);
    expect(totalPieces("B")).toBe(8);
    expect(totalPieces("C")).toBe(12);
  });

  it("A is the men's run, weighted to the middle sizes", () => {
    expect(expandSizeRun(SIZE_RUNS[0])).toEqual([
      { name: "S", quantity: 1 },
      { name: "M", quantity: 2 },
      { name: "L", quantity: 2 },
      { name: "XL", quantity: 2 },
      { name: "XXL", quantity: 1 },
    ]);
  });

  it("B is the women's run, weighted the same way", () => {
    expect(expandSizeRun(SIZE_RUNS[1])).toEqual([
      { name: "XS", quantity: 1 },
      { name: "S", quantity: 2 },
      { name: "M", quantity: 2 },
      { name: "L", quantity: 2 },
      { name: "XL", quantity: 1 },
    ]);
  });

  it("C is B plus four more pieces across S, M, L and XL", () => {
    const b = new Map(expandSizeRun(SIZE_RUNS[1]).map((s) => [s.name, s.quantity]));
    const c = new Map(expandSizeRun(SIZE_RUNS[2]).map((s) => [s.name, s.quantity]));
    const extra = [...c].reduce((sum, [name, qty]) => sum + (qty - (b.get(name) ?? 0)), 0);
    expect(extra).toBe(4);
    expect(c.get("XXL")).toBe(1); // a size B does not carry at all
  });

  it("returns sizes ordered by the shop's size ladder, matching how they are shown and positioned", () => {
    for (const run of SIZE_RUNS) {
      const names = expandSizeRun(run).map((s) => s.name);
      const indices = names.map((name) => SIZE_ORDER.indexOf(name as (typeof SIZE_ORDER)[number]));
      expect(indices).toEqual([...indices].sort((a, b) => a - b));
    }
  });

  it("lists each size exactly once, however many pieces of it there are", () => {
    for (const run of SIZE_RUNS) {
      const names = expandSizeRun(run).map((s) => s.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it("the written notation agrees with the run it documents", () => {
    // The notation is what gets read off a supplier sheet; if the two drift, the button
    // says one thing and does another.
    for (const run of SIZE_RUNS) {
      expect(run.notation.split("-").sort()).toEqual([...run.sizes].sort());
    }
  });
});
