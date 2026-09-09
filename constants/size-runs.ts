/**
 * The size runs this shop actually buys in.
 *
 * Apparel is not ordered a size at a time — it arrives as a run, a fixed spread of pieces
 * weighted towards the middle sizes because that is what sells. Typing six or eight rows by
 * hand for every new product, and getting the middle-size doubling right each time, is the
 * most error-prone part of adding stock.
 *
 * A size listed twice in a run means two pieces of it. So the quantity for each size is
 * simply how many times it appears — which is why these are written as the run itself
 * rather than as size/quantity pairs: the run is how the order arrives from the supplier,
 * and it is checkable against the box at a glance.
 */
export interface SizeRun {
  id: string;
  /** Shown on the button. */
  label: string;
  /** The run as the shop writes it, for the button's title and for verification. */
  notation: string;
  sizes: string[];
}

/**
 * The shop's standard letter-size ladder, smallest to largest. Sizes are letters rather
 * than numbers here, so ordering them for display and for run verification needs an
 * explicit ladder rather than a numeric sort — see `expandSizeRun`.
 */
export const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"] as const;

export const SIZE_RUNS: SizeRun[] = [
  {
    id: "A",
    label: "A · 8 pcs men's tailoring",
    notation: "S-M-M-L-L-XL-XL-XXL",
    sizes: ["S", "M", "M", "L", "L", "XL", "XL", "XXL"],
  },
  {
    id: "B",
    label: "B · 8 pcs women's",
    notation: "XS-S-S-M-M-L-L-XL",
    sizes: ["XS", "S", "S", "M", "M", "L", "L", "XL"],
  },
  {
    id: "C",
    label: "C · 12 pcs women's",
    // B, plus one more of each of M, L, XL and a new XXL — the deeper buy on the sizes that
    // move fastest.
    notation: "XS-S-S-M-M-M-L-L-L-XL-XL-XXL",
    sizes: ["XS", "S", "S", "M", "M", "M", "L", "L", "L", "XL", "XL", "XXL"],
  },
];

export interface RunSize {
  name: string;
  quantity: number;
}

/**
 * Collapses a run into one row per size, carrying how many pieces of it arrived.
 *
 * Ordered by `SIZE_ORDER` rather than a numeric or alphabetic sort — "XL" has to land after
 * "L" and before "XXL", which neither a numeric compare nor `String` ordering gets right —
 * because that is the order a shopper reads them in on the product page and the order
 * `ProductSize.position` is written from.
 */
export function expandSizeRun(run: SizeRun): RunSize[] {
  const counts = new Map<string, number>();
  for (const size of run.sizes) counts.set(size, (counts.get(size) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([a], [b]) => SIZE_ORDER.indexOf(a as (typeof SIZE_ORDER)[number]) - SIZE_ORDER.indexOf(b as (typeof SIZE_ORDER)[number]))
    .map(([size, quantity]) => ({ name: size, quantity }));
}
