export interface SizeGuideRow {
  size: string;
  uk: string;
  us: string;
  bustCm: number;
  waistCm: number;
}

/** A single size-ladder conversion table — a real catalog would key this per category/fit. */
export const SIZE_GUIDE_ROWS: SizeGuideRow[] = [
  { size: "XS", uk: "6", us: "2", bustCm: 80, waistCm: 62 },
  { size: "S", uk: "8", us: "4", bustCm: 84, waistCm: 66 },
  { size: "M", uk: "10", us: "6", bustCm: 88, waistCm: 70 },
  { size: "L", uk: "12", us: "8", bustCm: 94, waistCm: 76 },
  { size: "XL", uk: "14", us: "10", bustCm: 100, waistCm: 82 },
  { size: "XXL", uk: "16", us: "12", bustCm: 106, waistCm: 88 },
];

export const NUMERIC_SIZE_NOTE =
  "Measurements are garment, laid flat. If you're between sizes, size up — see the product description for any fit note specific to that style.";
