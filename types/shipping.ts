/**
 * Editable shipping configuration, stored in the `SiteContent` "shipping" row and edited at
 * /admin/settings/shipping. Previously these were constants in `lib/shipping.ts`, so changing
 * free shipping from €150 to €100 meant a code edit and a deploy.
 */
export interface ShippingRateSetting {
  /**
   * Stable identifier. It is persisted on every checkout and order row, so renaming one
   * orphans the rate on historical orders — the admin form does not let you edit it.
   */
  id: string;
  label: string;
  description: string;
  estimatedDelivery: string;
  /** VAT-inclusive, like every other customer-facing amount in this shop. */
  amount: number;
  /** A disabled rate disappears from checkout but stays readable on orders that used it. */
  enabled: boolean;
  /**
   * Whether the free-shipping threshold applies to this rate.
   *
   * Standard is the rate the sitewide "free over €150" promise is about; Express is a paid
   * upgrade and costs its listed price at any basket size. That distinction used to be a
   * hardcoded `rate.id === "standard"` comparison, which meant a third rate could never be
   * free without a code change.
   */
  freeShippingEligible: boolean;
  /**
   * Postal codes this rate costs more to reach, and what it costs there.
   *
   * Greece's courier pricing is not flat: ACS publishes a list of *δυσπρόσιτες περιοχές* —
   * islands, mountain villages, the far ends of the mainland — that carry a surcharge. The
   * shop's own list came from ACS's area export: 488 postal codes across 11,848 areas, with
   * Athens, Thessaloniki, Patras and Heraklion absent and Mykonos and Santorini present.
   *
   * Absent means one price everywhere, which is what `pickup` and `express` still are.
   *
   * Matched on postal code alone, because that is the only part of the address a shopper
   * reliably gives and the only part worth trusting. ACS's own list is finer than that — it
   * names areas — so a postal code containing both a remote village and an ordinary town is
   * charged the higher price throughout. That errs toward the shop absorbing less, and it is
   * the direction to err in: the alternative is quoting a price and then paying more than it.
   */
  remoteAreas?: {
    amount: number;
    /** Digits only, no spaces — see `buildShippingRates`, which normalises before comparing. */
    postalCodes: string[];
  };
}

export interface ShippingSettings {
  /**
   * Order value (after discounts, before shipping) at or above which eligible rates cost
   * nothing. `null` disables free shipping entirely rather than setting an unreachable
   * number, so the intent is readable in the data.
   */
  freeShippingThreshold: number | null;
  rates: ShippingRateSetting[];
}
