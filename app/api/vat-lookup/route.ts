import { NextResponse } from "next/server";
import { invalidInputResponse } from "@/lib/commerce/http-errors";
import { enforceRateLimit } from "@/lib/rate-limit";
import { isValidGreekVatNumber, normaliseGreekVatNumber } from "@/lib/greek-vat";
import { isTaxRegistryConfigured, lookupGreekVatNumber, TaxRegistryError } from "@/lib/tax-registry";

/**
 * ΑΦΜ → business details, for autofilling the τιμολόγιο fields at checkout.
 *
 * ## This is a public endpoint that reads a government registry, so it is deliberately mean
 *
 * Unauthenticated on purpose — guests check out, and requiring an account to fill in an
 * invoice would be worse than typing four fields. But that makes it, if left open, a free
 * ΑΦΜ-to-company-name API pointed at AADE and billed to this shop's credentials, which AADE
 * logs per call. Three things keep that in proportion:
 *
 *   1. The checksum runs BEFORE any network call, so enumeration costs the attacker valid
 *      ΑΦΜ arithmetic rather than a counter, and cuts ~90% of random input for free.
 *   2. A hard per-IP limit. 12/hour is generous for a shopper (who needs one) and useless
 *      for a scraper.
 *   3. Only the three fields the form actually fills are returned. AADE also sends the
 *      registered postal address; a sole trader's ΑΦΜ maps that to a person's home, and this
 *      shop has no reason to hold it, so it is dropped here rather than sent to the browser.
 *
 * Nothing about the response is cached and nothing is logged — see the catch below.
 */
export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, { name: "vat-lookup", limit: 12, windowMs: 60 * 60 * 1000 });
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidInputResponse("Invalid input.");
  }

  const raw = typeof (body as { vatNumber?: unknown })?.vatNumber === "string" ? (body as { vatNumber: string }).vatNumber : "";
  const vatNumber = normaliseGreekVatNumber(raw);
  if (!isValidGreekVatNumber(vatNumber)) return invalidInputResponse("Invalid VAT number.");

  /**
   * Unconfigured is a 200, not an error. The client uses it to stop asking, and a shop that
   * has not registered for AADE credentials should see the invoice form behave exactly as it
   * did before this endpoint existed — not an error under a field the shopper filled correctly.
   */
  if (!isTaxRegistryConfigured()) {
    return NextResponse.json({ status: "unavailable" });
  }

  try {
    const record = await lookupGreekVatNumber(vatNumber);
    if (!record) return NextResponse.json({ status: "not_found" });
    return NextResponse.json({
      status: "found",
      companyName: record.companyName,
      taxOffice: record.taxOffice,
      activity: record.activity,
      active: record.active,
    });
  } catch (error) {
    /**
     * Logged without the ΑΦΜ. The number identifies a business and often a person, the message
     * is what tells an operator whether AADE is down or the credentials are wrong, and only one
     * of those two is worth keeping.
     */
    console.error("[vat-lookup] AADE lookup failed", error instanceof TaxRegistryError ? error.message : error);
    // 200 again: the shopper did nothing wrong and the form just falls back to manual entry.
    return NextResponse.json({ status: "unavailable" });
  }
}
