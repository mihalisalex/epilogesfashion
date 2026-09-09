import { describe, expect, it } from "vitest";
import { isValidGreekVatNumber, normaliseGreekVatNumber } from "./greek-vat";

/**
 * The check digit is computed here rather than pasted from a real business, so these tests
 * carry no actual company's ΑΦΜ. Deriving it also means the expectation is built by the
 * published rule rather than by trusting the implementation it is meant to check.
 */
function withCheckDigit(firstEight: string): string {
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(firstEight[i]) * 2 ** (8 - i);
  return firstEight + String((sum % 11) % 10);
}

const VALID = withCheckDigit("09876543");

describe("isValidGreekVatNumber", () => {
  it("accepts a number whose check digit agrees", () => {
    expect(isValidGreekVatNumber(VALID)).toBe(true);
  });

  it("accepts one written with spaces or dots, as people type them", () => {
    expect(isValidGreekVatNumber(`${VALID.slice(0, 3)} ${VALID.slice(3, 6)} ${VALID.slice(6)}`)).toBe(true);
    expect(isValidGreekVatNumber(`${VALID.slice(0, 3)}.${VALID.slice(3, 6)}.${VALID.slice(6)}`)).toBe(true);
  });

  it("rejects any wrong check digit", () => {
    // The one guarantee the algorithm gives outright: the ninth digit is the check digit, so
    // getting only it wrong is always caught.
    for (let d = 0; d <= 9; d++) {
      if (String(d) === VALID[8]) continue;
      expect(isValidGreekVatNumber(VALID.slice(0, 8) + d), `${VALID.slice(0, 8)}${d}`).toBe(false);
    }
  });

  /**
   * It catches the great majority of single-digit typos, but NOT all of them, and the gap is in
   * the published algorithm rather than in this implementation.
   *
   * The check digit is `(sum % 11) % 10`, so remainders 0 and 10 both produce a check digit of
   * 0 — and any typo that moves the remainder between those two is invisible. This test asserted
   * "every single-digit typo" at first and failed on 798765430, which is exactly that collision.
   * Corrected to measure the real rate rather than to weaken the claim into meaninglessness: a
   * broken implementation drops far below this floor, while the genuine blind spot sits at a few
   * percent.
   *
   * Worth knowing when reading an invoice: a valid ΑΦΜ here means "not impossible", never
   * "registered to this company". Only an AADE or VIES lookup can say that, and this shop has no
   * such integration.
   */
  it("catches the large majority of single-digit typos, with a known blind spot", () => {
    let tried = 0;
    let caught = 0;
    for (let base = 0; base < 200; base++) {
      const valid = withCheckDigit(String(10_000_000 + base * 37).slice(0, 8));
      if (!isValidGreekVatNumber(valid)) continue;
      for (let position = 0; position < 9; position++) {
        for (let d = 0; d <= 9; d++) {
          if (String(d) === valid[position]) continue;
          tried++;
          if (!isValidGreekVatNumber(valid.slice(0, position) + d + valid.slice(position + 1))) caught++;
        }
      }
    }
    expect(tried).toBeGreaterThan(1000);
    expect(caught / tried).toBeGreaterThan(0.9);
  });

  it("rejects a transposition of two adjacent digits", () => {
    // The other typo people actually make. Skipped where the two digits are equal, which
    // transposes to the same number and is not an error at all.
    for (let i = 0; i < 8; i++) {
      if (VALID[i] === VALID[i + 1]) continue;
      const swapped = VALID.slice(0, i) + VALID[i + 1] + VALID[i] + VALID.slice(i + 2);
      expect(isValidGreekVatNumber(swapped), `${swapped} should be rejected`).toBe(false);
    }
  });

  it("rejects the wrong number of digits", () => {
    expect(isValidGreekVatNumber(VALID.slice(0, 8))).toBe(false);
    expect(isValidGreekVatNumber(VALID + "1")).toBe(false);
    expect(isValidGreekVatNumber("")).toBe(false);
  });

  it("rejects all zeroes, which satisfies the arithmetic but is nobody's ΑΦΜ", () => {
    expect(isValidGreekVatNumber("000000000")).toBe(false);
  });

  it("rejects letters", () => {
    expect(isValidGreekVatNumber("EL12345678")).toBe(false);
  });
});

describe("normaliseGreekVatNumber", () => {
  it("keeps only the digits", () => {
    expect(normaliseGreekVatNumber(" 123.456 789 ")).toBe("123456789");
  });
});
