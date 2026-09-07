export interface Country {
  code: string;
  name: string;
}

/**
 * The shop's home market, and the default selection on every address form.
 *
 * Both forms used to default to "US" with Greece ninth in the list, so a Greek
 * customer had to notice and change it — and anyone who didn't got a US address on
 * their order.
 */
export const DEFAULT_COUNTRY_CODE = "GR";

/**
 * The EU, Greece first and the rest alphabetically.
 *
 * This list used to carry Australia, Canada, Norway, the UK and the US alongside nine EU
 * members, all served by the same flat domestic rate — and the note that stood here said
 * plainly that shipping shoes to Australia at that price, or free over the threshold, loses
 * money on every order, and that narrowing it was a commercial decision rather than a code
 * fix. That decision has now been made: the EU only, at a single EUR 14,95 rate beyond
 * Greece (`ShippingRateSetting.international`).
 *
 * All 27 members rather than the nine that happened to be here before. The previous set was
 * arbitrary — it omitted **Cyprus**, which for a Greek-language shop is among the likeliest
 * destinations outside Greece, along with Bulgaria and Romania next door.
 *
 * Norway and the UK are deliberately absent. Both are European and neither is in the EU, and
 * both would bring customs paperwork this shop is not set up for — which is the practical
 * reason the line is drawn at the customs union rather than at geography.
 *
 * Removing a country cannot damage an order already placed to one: `storedAddressSchema`
 * keeps `countryCode` permissive on purpose, so a historical US address still parses and the
 * admin can still read it. Only new input is constrained.
 */
export const COUNTRIES: Country[] = [
  { code: "GR", name: "Greece" },
  { code: "AT", name: "Austria" },
  { code: "BE", name: "Belgium" },
  { code: "BG", name: "Bulgaria" },
  { code: "HR", name: "Croatia" },
  { code: "CY", name: "Cyprus" },
  { code: "CZ", name: "Czechia" },
  { code: "DK", name: "Denmark" },
  { code: "EE", name: "Estonia" },
  { code: "FI", name: "Finland" },
  { code: "FR", name: "France" },
  { code: "DE", name: "Germany" },
  { code: "HU", name: "Hungary" },
  { code: "IE", name: "Ireland" },
  { code: "IT", name: "Italy" },
  { code: "LV", name: "Latvia" },
  { code: "LT", name: "Lithuania" },
  { code: "LU", name: "Luxembourg" },
  { code: "MT", name: "Malta" },
  { code: "NL", name: "Netherlands" },
  { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" },
  { code: "RO", name: "Romania" },
  { code: "SK", name: "Slovakia" },
  { code: "SI", name: "Slovenia" },
  { code: "ES", name: "Spain" },
  { code: "SE", name: "Sweden" },
];

export function isSupportedCountryCode(code: string): boolean {
  return COUNTRIES.some((country) => country.code === code.trim().toUpperCase());
}
