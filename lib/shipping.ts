import { DEFAULT_COUNTRY_CODE } from "@/constants/countries";
import type { ShippingRate } from "@/lib/commerce/types";
import type { ShippingSettings } from "@/types";

/**
 * Single source of truth for shipping/tax constants. Previously duplicated
 * independently in the mock's cart.service.ts and checkout.service.ts (same two
 * rates, defined twice) — Postgres-backed carts/checkouts both import this instead.
 */

/**
 * Greek standard VAT.
 *
 * Every customer-facing amount in this app — product price, shipping, gift wrap, the
 * payment surcharge — is VAT-INCLUSIVE. The tax line on the cart, the checkout and the
 * order is therefore informational: it says how much of what the shopper is already
 * paying is VAT, and it is NOT added to the total.
 *
 * This was previously 0.21 and applied the other way round, as tax ADDED on top of the
 * displayed price, which had three separate problems: the rate was not a Greek one, EU
 * consumer law requires displayed prices to include VAT, and the site's own Terms of
 * Service already told shoppers "all prices ... include VAT". A EUR 59 product billed at
 * EUR 78.34.
 *
 * A real tax adapter (Avalara and similar) would derive both the rate and the
 * inclusive/exclusive treatment from the destination address; this is a single-market
 * shop, so one constant is the honest representation.
 */
export const VAT_RATE = 0.24;

/**
 * The VAT contained within a gross, VAT-inclusive amount — `gross × rate / (1 + rate)`,
 * NOT `gross × rate`, which is the amount you would ADD to a net figure. Getting these
 * two confused is exactly how the old behaviour arose.
 */
export function vatIncludedIn(grossAmount: number): number {
  return (grossAmount * VAT_RATE) / (1 + VAT_RATE);
}
/**
 * Digits only. Greek postal codes are written both "71202" and "712 02", and an address form
 * accepts whatever the shopper types — so both sides of the comparison are stripped rather
 * than trusting either to be tidy.
 */
export function normalisePostalCode(postalCode: string | null | undefined): string | null {
  const digits = (postalCode ?? "").replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

/** Where an order is going, as far as pricing is concerned. Both parts are optional: the cart knows neither. */
export interface ShippingDestination {
  countryCode?: string | null;
  postalCode?: string | null;
}

/**
 * Remote-area pricing is DOMESTIC only.
 *
 * The 488 codes are Greek ones from ACS's list, and postal codes are not globally unique —
 * "84600" exists in more countries than Greece. Matching them against a foreign address would
 * surcharge someone for living at a number that happens to collide.
 */
function amountForDestination(rate: ShippingSettings["rates"][number], isDomestic: boolean, postalCode: string | null): number {
  if (!isDomestic || !rate.remoteAreas || !postalCode) return rate.amount;
  return rate.remoteAreas.postalCodes.some((code) => normalisePostalCode(code) === postalCode)
    ? rate.remoteAreas.amount
    : rate.amount;
}

/**
 * Turns the editable settings into the rates the rest of the app prices against.
 *
 * The free-shipping threshold is folded ONTO each eligible rate here, once, at the single
 * point where configuration becomes domain objects. Everything downstream — cart totals,
 * checkout totals, the review step in the browser — then prices from the rate alone and
 * needs no access to settings at all. Prices and availability are both resolved against the
 * destination here for the same reason.
 *
 * Disabled rates are dropped entirely: a rate the shop has switched off should not appear at
 * checkout at all. A rate that is merely out of scope for this destination is kept and marked
 * unavailable instead, so the delivery step can show it greyed out rather than pretending the
 * shop has no such option.
 */
export function buildShippingRates(
  settings: ShippingSettings,
  currencyCode = "EUR",
  /**
   * The destination, when it is known. Supplied at checkout once the address exists, omitted
   * on the cart, where it is not.
   *
   * With no country every rate counts as available — the cart cannot yet know which apply, and
   * hiding options before the shopper has said where they are would be guessing at their
   * address.
   */
  destination: ShippingDestination = {}
): ShippingRate[] {
  const postalCode = normalisePostalCode(destination.postalCode);
  const country = destination.countryCode?.trim().toUpperCase() || null;
  const isDomestic = country === null || country === DEFAULT_COUNTRY_CODE;

  return settings.rates
    .filter((rate) => rate.enabled)
    .map((rate) => ({
      id: rate.id,
      label: rate.label,
      description: rate.description,
      estimatedDelivery: rate.estimatedDelivery,
      price: { amount: amountForDestination(rate, isDomestic, postalCode), currencyCode },
      freeOverAmount: rate.freeShippingEligible ? settings.freeShippingThreshold : null,
      available: country === null || !rate.scope || rate.scope === (isDomestic ? "domestic" : "international"),
    }));
}

/**
 * The rate a shopper picked, or the first available one when they have not picked yet or
 * picked something that no longer exists — a rate can be disabled between a cart being built
 * and its checkout being completed, and an order must still price against something.
 *
 * Never returns a rate the destination cannot use.
 *
 * This is where the scope is *enforced*. The delivery step greys those options out, but a
 * disabled radio is a courtesy to the shopper, not a control: the id travels to the server in
 * a request anyone can craft. Skipping them here means `setShippingRate` finds nothing and
 * refuses, rather than storing a domestic price against a Portuguese address.
 *
 * The fallback picks the first AVAILABLE rate for the same reason — with an international
 * address, `rates[0]` is the Greek one.
 */
export function resolveShippingRate(rates: ShippingRate[], rateId?: string | null): ShippingRate | undefined {
  const usable = rates.filter((rate) => rate.available !== false);
  return usable.find((rate) => rate.id === rateId) ?? usable[0];
}



/**
 * What a rate actually costs for a given basket — the single source of truth, used both to
 * QUOTE a charge at checkout and to CHARGE it server-side, so the two cannot disagree.
 *
 * Express is a paid upgrade and costs its listed price at any basket size; Standard is the
 * rate the sitewide free-shipping promise is about. Without this, `resolveCartAmounts`'s
 * override path charged Standard's flat fee on every order regardless of subtotal,
 * contradicting the "free shipping over €150" banner and silently overcharging every
 * checkout.
 *
 * The threshold now travels on the rate (see `buildShippingRates`) rather than being a
 * constant compared against a hardcoded rate id, so a third rate can be made free-eligible
 * from the admin without touching this function.
 */
export function computeShippingChargeForRate(rate: ShippingRate, taxableAmount: number, hasActiveItems: boolean): number {
  if (!hasActiveItems) return 0;
  if (rate.freeOverAmount != null && taxableAmount >= rate.freeOverAmount) return 0;
  return rate.price.amount;
}
