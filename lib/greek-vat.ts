/**
 * Validates a Greek ΑΦΜ (VAT number) by its own check digit.
 *
 * Worth doing rather than accepting nine digits, because of what a wrong one costs. An invoice
 * carrying an ΑΦΜ that does not belong to the buyer is not a lesser invoice — it is not a valid
 * tax document, and the error surfaces weeks later at the accountant rather than at the moment
 * a shopper could still fix a typo. The checksum catches every single-digit mistake and every
 * transposition, which is what typing errors almost always are.
 *
 * The algorithm is the published one: weight the first eight digits by descending powers of
 * two, take the remainder modulo 11, then modulo 10, and compare with the ninth digit.
 *
 * What this deliberately does NOT do is claim the number is registered, or that it belongs to
 * the name given. Only a VIES/AADE lookup can say that, and this shop has no such integration —
 * so this rejects the impossible rather than confirming the real.
 */
export function isValidGreekVatNumber(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 9) return false;

  // 000000000 satisfies the arithmetic and is nobody's ΑΦΜ.
  if (/^0+$/.test(digits)) return false;

  let sum = 0;
  for (let i = 0; i < 8; i++) {
    sum += Number(digits[i]) * 2 ** (8 - i);
  }
  return (sum % 11) % 10 === Number(digits[8]);
}

/** Digits only — an ΑΦΜ is written with spaces and dots as often as not. */
export function normaliseGreekVatNumber(value: string): string {
  return value.replace(/\D/g, "");
}
