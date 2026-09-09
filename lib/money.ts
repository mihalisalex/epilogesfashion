/**
 * Rounding to the cent — one definition, for the server and the browser both.
 *
 * This lived in `lib/commerce/postgres/cart-totals.ts`, which is `server-only`, so anything
 * client-side that needed it copied it instead. `lib/commerce/checkout-totals.ts` had done
 * exactly that — and copied the version from *before* `MONEY-001` was fixed:
 *
 *   Math.round(value * 100) / 100
 *
 * `Math.round(1.005 * 100)` is 100, not 101, because 1.005 is held as 1.00499999999999989…
 * That is the half-cent bug the audit closed on the server while the browser kept rounding a
 * cent the other way, so a total could display one cent under what was actually charged.
 *
 * The epsilon nudge below is the corrected form. It is arithmetic with no I/O and no
 * environment of its own, so its home in a server-only module was incidental rather than
 * meaningful — and being unimportable was the whole reason a second, wrong copy existed.
 */
export function round2(value: number): number {
  const scaled = value * 100;
  return Math.round(scaled + Math.sign(scaled) * Math.abs(scaled) * Number.EPSILON) / 100;
}
