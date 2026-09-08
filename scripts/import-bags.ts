import "dotenv/config";
import fs from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";
import { slugify } from "@/lib/slug";
import { productFormSchema, type ProductFormValues } from "@/lib/validation/product";
import { writeProductRow } from "@/lib/products-import/write";

/**
 * Imports the WooCommerce bags export into the Τσάντες category.
 *
 *   npx tsx scripts/import-bags.ts <export.csv>            # dry run
 *   npx tsx scripts/import-bags.ts <export.csv> --apply    # write
 *
 * Written for one specific export and kept because the next one will look the same. It goes
 * through `writeProductRow` and `productFormSchema` rather than writing rows directly, so an
 * imported product is validated exactly like one typed into the admin form — a row this file
 * gets wrong fails here instead of becoming a broken product page.
 *
 * ## What the export does not contain, and what is done about it
 *
 * **Prices live on variations, not products.** A WooCommerce `variable` row carries the name,
 * description, images and categories; its `variation` rows carry price and stock. Each product
 * is assembled from both. Three parents have no variation at all — nothing to sell them at — and
 * are skipped rather than imported at a guessed price.
 *
 * **There are no SKUs.** Every row is blank, and the shop requires a unique one, so they are
 * generated from the slug with a `WC-BAG-` prefix. Anything derived from the name would collide
 * the moment two colours of one bag arrive.
 *
 * **Bags have no sizes**, and the schema requires at least one. Each product gets a single
 * "Ενιαίο μέγεθος" holding the real stock, so the existing stock, cart and back-in-stock
 * machinery works unchanged rather than needing a special case for sizeless products.
 *
 * **Colour swatches are skipped.** The export gives a Greek colour word with no hex, and the
 * schema wants a real one; guessing hexes from Greek adjectives would put wrong colours on
 * screen. The colour is already in every product name.
 *
 * **Images stay on the old WordPress domain.** They load — the CSP already allows
 * alexandrisstores.gr — but they depend on that site staying up, unlike the shoes, which live in
 * blob storage. Moving them across is a follow-up, not a blocker.
 */
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const file = args.find((a) => !a.startsWith("--"));

const CATEGORY_SLUG = "tsantes";

/** RFC 4180 enough for a WooCommerce export: quoted fields, doubled quotes, embedded newlines. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\r") {
      /* ignored — line endings are handled by \n */
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const stripHtml = (s: string) =>
  s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

async function main() {
  if (!file) {
    console.error("\n  Usage: npx tsx scripts/import-bags.ts <export.csv> [--apply]\n");
    process.exitCode = 1;
    return;
  }

  const rows = parseCsv(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  const head = rows[0].map((h) => h.trim());
  const col = (name: string) => head.indexOf(name);
  const data = rows.slice(1).filter((r) => r.length > 3);

  const parents = data.filter((r) => r[col("Type")] === "variable");
  const variations = data.filter((r) => r[col("Type")] === "variation");

  /** Variations point at their parent as "id:1234"; the parent carries that number in `ID`. */
  const variationByParent = new Map<string, string[]>();
  for (const v of variations) {
    const parentId = (v[col("Parent")] || "").replace(/^id:/, "").trim();
    if (parentId && !variationByParent.has(parentId)) variationByParent.set(parentId, v);
  }

  const prepared: { values: ProductFormValues; name: string }[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const usedSlugs = new Set<string>();

  for (const p of parents) {
    const name = (p[col("Name")] || "").trim();
    const variation = variationByParent.get((p[col("ID")] || "").trim());
    if (!variation) {
      skipped.push({ name, reason: "no variation — no price to sell it at" });
      continue;
    }

    const price = parseFloat(variation[col("Regular price")]);
    if (!Number.isFinite(price) || price <= 0) {
      skipped.push({ name, reason: "no usable price" });
      continue;
    }
    const saleRaw = parseFloat(variation[col("Sale price")]);
    const salePrice = Number.isFinite(saleRaw) && saleRaw > 0 && saleRaw < price ? saleRaw : undefined;

    const images = (p[col("Images")] || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((src) => ({ src, alt: name }));
    if (images.length === 0) {
      skipped.push({ name, reason: "no images" });
      continue;
    }

    let slug = slugify(name);
    if (!slug) {
      skipped.push({ name, reason: "name does not produce a slug" });
      continue;
    }
    // Two colours of the same bag can slugify identically; the suffix keeps them distinct
    // rather than letting the second silently update the first.
    if (usedSlugs.has(slug)) {
      let n = 2;
      while (usedSlugs.has(`${slug}-${n}`)) n++;
      slug = `${slug}-${n}`;
    }
    usedSlugs.add(slug);

    const quantity = Math.max(0, parseInt(variation[col("Stock")] || "0", 10) || 0);
    const description = stripHtml(p[col("Description")] || "") || name;

    const values: ProductFormValues = {
      slug,
      name,
      description,
      price,
      salePrice,
      currencyCode: "EUR",
      images,
      colors: [],
      // One size, because a bag has none and the schema requires at least one. This keeps the
      // stock, cart and back-in-stock paths identical to every other product.
      sizes: [{ name: "Ενιαίο μέγεθος", inStock: quantity > 0, quantity }],
      category: CATEGORY_SLUG,
      collectionIds: [],
      tags: [],
      gender: "women",
      materials: [],
      careInstructions: [],
      relatedProductIds: [],
      isNew: false,
      isSale: salePrice != null,
      isPreorder: false,
      isBackorder: false,
      /**
       * From the WHOLE slug, never a truncation of it.
       *
       * Cutting it to 28 characters gave two different Valentino bags the same SKU — the
       * colour that distinguishes them sits at the end of the name, which is exactly what a
       * truncation removes. The slugs are already de-duplicated above, so deriving from the
       * full slug is unique by construction, and the assertion after this loop proves it
       * rather than trusting the reasoning.
       */
      sku: `WC-BAG-${slug.toUpperCase()}`,
      inventoryPolicy: "deny",
      availableForSale: quantity > 0,
      status: p[col("Published")] === "1" ? "active" : "draft",
      brand: name.split(/[\s-]/)[0] || undefined,
    };

    const parsed = productFormSchema.safeParse(values);
    if (!parsed.success) {
      skipped.push({ name, reason: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
      continue;
    }
    prepared.push({ values: parsed.data, name });
  }

  /**
   * Checked, not assumed. A duplicate SKU is rejected by the database, so the failure would
   * be one silently missing product in a batch of eighty-four — the kind that is noticed
   * weeks later by someone looking for a bag that "should be there".
   */
  const skus = prepared.map((p) => p.values.sku);
  const duplicateSkus = skus.filter((sku, i) => skus.indexOf(sku) !== i);
  if (duplicateSkus.length) {
    console.error(`
  Duplicate SKUs, nothing written: ${[...new Set(duplicateSkus)].join(", ")}
`);
    process.exitCode = 1;
    return;
  }

  /**
   * And against what is ALREADY in the catalogue, not just within this batch.
   *
   * The writes are not one transaction, so a collision discovered on row sixty leaves fifty-nine
   * bags imported and the rest not — a half-done import that is worse to unpick than a refusal.
   * Both columns are unique in the database, so this asks it directly rather than guessing.
   */
  const clashes = await prisma.product.findMany({
    where: { OR: [{ slug: { in: prepared.map((p) => p.values.slug) } }, { sku: { in: skus } }] },
    select: { slug: true, sku: true },
  });
  if (clashes.length) {
    console.error(`
  ${clashes.length} product(s) already use one of these slugs or SKUs, nothing written:`);
    clashes.slice(0, 10).forEach((c) => console.error(`    ${c.sku}  ${c.slug}`));
    process.exitCode = 1;
    return;
  }

  const inStock = prepared.filter((p) => p.values.sizes[0].quantity > 0).length;
  console.log(`\n  Bags import — ${apply ? "APPLYING" : "dry run (pass --apply to write)"}\n`);
  console.log(`  ${parents.length} products in the export`);
  console.log(`  ${prepared.length} ready  (${inStock} in stock, ${prepared.length - inStock} out of stock)`);
  console.log(`  ${skipped.length} skipped\n`);

  for (const s of skipped) console.log(`    skip  ${s.name.slice(0, 46).padEnd(48)} ${s.reason}`);
  console.log("");
  for (const p of prepared.slice(0, 8)) {
    const v = p.values;
    console.log(`    ${v.sku.padEnd(34)} ${String(v.price).padStart(6)}${v.salePrice ? ` -> ${v.salePrice}` : "     "}  qty ${String(v.sizes[0].quantity).padStart(2)}  ${v.name.slice(0, 40)}`);
  }
  if (prepared.length > 8) console.log(`    …and ${prepared.length - 8} more`);

  if (!apply) {
    console.log("\n  Dry run — nothing written.\n");
    return;
  }

  let written = 0;
  for (const p of prepared) {
    try {
      await writeProductRow(p.values);
      written++;
    } catch (error) {
      console.error(`    FAILED ${p.name.slice(0, 40)}: ${error instanceof Error ? error.message : error}`);
    }
  }
  console.log(`\n  Wrote ${written} of ${prepared.length}.`);
  console.log(`  The category "${CATEGORY_SLUG}" was created if it did not exist — give it a name and image in the admin.\n`);
}

main()
  .catch((error) => {
    console.error("\n  Failed:", error instanceof Error ? error.message : error, "\n");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
