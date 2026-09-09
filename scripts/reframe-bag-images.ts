import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { put } from "@vercel/blob";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Reframes the bag photographs from square to the catalogue's 3:4, and moves them into blob
 * storage on the way.
 *
 *   npx tsx scripts/reframe-bag-images.ts            # dry run — downloads and reports, uploads nothing
 *   npx tsx scripts/reframe-bag-images.ts --apply    # convert, upload, repoint
 *
 * The bags arrived from WooCommerce at 1200x1200 while every other product is 1000x1333, so a
 * bag in a grid beside a shoe was a different shape. They are scaled to fit and padded to 3:4
 * on #F1F1F1 — the same grey the shoe images already use, so the two sit together rather than
 * one carrying a visible white box.
 *
 * **Fit, never crop.** A square photograph cropped to 3:4 loses a third of its width, and on a
 * handbag that is a strap or a handle. Padding wastes some canvas; cropping loses the product.
 *
 * This also ends the dependency on the old WordPress site. Until now the bag images were served
 * from alexandrisstores.gr — they load, because the CSP allows that host, but switching that
 * site off would have blanked all 84 bags. Afterwards they live in the same store as
 * everything else.
 *
 * ## Recovery
 *
 * Every original URL is written to `.bag-images/rollback.json` next to the new one BEFORE the
 * database is touched, so a bad batch is a scripted reversal rather than a re-import. The old
 * files are never deleted — they stay on the WordPress host, which costs nothing here.
 */
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const apply = process.argv.includes("--apply");

const TARGET = { width: 1000, height: 1333 };
/** The grey the existing catalogue photography is matted on. */
const BACKGROUND = { r: 241, g: 241, b: 241 };
const OUT_DIR = path.resolve(".bag-images");

interface ImageEntry {
  src: string;
  alt?: string;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const products = await prisma.product.findMany({
    where: { category: { slug: "tsantes" } },
    select: { id: true, name: true, images: true },
    orderBy: { name: "asc" },
  });

  /** One conversion per distinct source, since a URL can appear on more than one product. */
  const sources = new Set<string>();
  for (const product of products) {
    for (const image of (product.images as ImageEntry[] | null) ?? []) {
      if (image?.src && !image.src.includes("blob.vercel-storage.com")) sources.add(image.src);
    }
  }

  console.log(`\n  Bag images — ${apply ? "APPLYING" : "dry run (pass --apply to write)"}\n`);
  console.log(`  ${products.length} products, ${sources.size} images not yet in blob storage\n`);

  if (sources.size === 0) {
    console.log("  Nothing to do.\n");
    return;
  }

  const mapping = new Map<string, string>();
  const failures: { src: string; reason: string }[] = [];
  let converted = 0;

  for (const src of sources) {
    try {
      const response = await fetch(src);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const original = Buffer.from(await response.arrayBuffer());
      const before = await sharp(original).metadata();

      const reframed = await sharp(original)
        .resize({
          ...TARGET,
          // `contain` scales the whole image in and pads the remainder — the fit-not-crop rule
          // above. `cover` would fill the frame by cutting the sides off.
          fit: "contain",
          background: BACKGROUND,
        })
        .flatten({ background: BACKGROUND })
        .webp({ quality: 85 })
        .toBuffer();

      const after = await sharp(reframed).metadata();
      converted++;

      if (!apply) {
        if (converted <= 6) {
          console.log(
            `    ${String(before.width)}x${String(before.height)} ${String(before.format).padEnd(4)} ${(original.length / 1024).toFixed(0).padStart(5)}KB` +
              `  ->  ${after.width}x${after.height} webp ${(reframed.length / 1024).toFixed(0).padStart(5)}KB   ${src.split("/").pop()?.slice(0, 40)}`
          );
        }
        continue;
      }

      const name = (src.split("/").pop() ?? "bag").replace(/\.[a-z]+$/i, "").slice(0, 60);
      const blob = await put(`products/bags-3x4/${crypto.randomUUID()}-${name}.webp`, reframed, {
        access: "public",
        addRandomSuffix: false,
        contentType: "image/webp",
      });
      mapping.set(src, blob.url);
    } catch (error) {
      failures.push({ src, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  if (!apply) {
    console.log(`\n  ${converted} would be converted, ${failures.length} failed to download.`);
    for (const f of failures.slice(0, 5)) console.log(`    ${f.reason}  ${f.src.slice(0, 70)}`);
    console.log("\n  Dry run — nothing uploaded, no row changed.\n");
    return;
  }

  // Written BEFORE the database is touched: if the repoint below dies halfway, this file is
  // what turns a half-migrated catalogue back into a whole one.
  fs.writeFileSync(path.join(OUT_DIR, "rollback.json"), JSON.stringify(Object.fromEntries(mapping), null, 2));
  console.log(`  uploaded ${mapping.size}, rollback map written to ${path.join(OUT_DIR, "rollback.json")}`);

  let repointed = 0;
  for (const product of products) {
    const images = (product.images as ImageEntry[] | null) ?? [];
    if (!images.some((image) => mapping.has(image.src))) continue;
    const next = images.map((image) => (mapping.has(image.src) ? { ...image, src: mapping.get(image.src)! } : image));
    await prisma.product.update({ where: { id: product.id }, data: { images: next as never } });
    repointed++;
  }

  console.log(`  repointed ${repointed} product(s)`);
  if (failures.length) {
    console.log(`\n  ${failures.length} image(s) failed and still point at the old host:`);
    for (const f of failures.slice(0, 8)) console.log(`    ${f.reason}  ${f.src.slice(0, 70)}`);
  }
  console.log("");
}

main()
  .catch((error) => {
    console.error("\n  Failed:", error instanceof Error ? error.message : error, "\n");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
