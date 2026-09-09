import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Points the homepage "Οι συλλογές μας" tiles at categories where a category is what they
 * actually were.
 *
 *   npx tsx scripts/apply-homepage-tiles.ts            # dry run
 *   npx tsx scripts/apply-homepage-tiles.ts --apply    # write
 *
 * Three of the five tiles were collections duplicating a category, and one was worse than a
 * duplicate: "Η Συλλογή Σνίκερ" was slugged for women and held 19 men's shoes against 7
 * women's. A tile that reads its name and picture off the category cannot drift like that,
 * because the label and the destination become the same fact.
 *
 * The two that stay collections earn it. "Νέες Αφίξεις" is recency, which no category can
 * express, and "Βραδινά Τακούνια" is left for the owner to decide: it is exactly the heels
 * category — all 30 of them — so it is the clearest candidate to become a category with a
 * prettier name, but renaming a category is a naming decision rather than a mechanical one.
 */
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const apply = process.argv.includes("--apply");

/**
 * In display order. The first tile renders at double size.
 *
 * `inheritImageFrom` moves the retired collection's photograph onto the category. Without it
 * the grid falls back to each category's card image, which is a product cutout on grey meant
 * for a nav menu — correct data, and a visible downgrade from the lifestyle photography these
 * tiles were art-directed with. The picture is most of a tile, so carrying it across is part
 * of the change rather than a nicety, and the collection keeps its own copy either way.
 */
const TILES = [
  { type: "category" as const, slug: "gynaikeia-sneakers", inheritImageFrom: "woman-sneakers-collection" },
  { type: "category" as const, slug: "andrika-sneakers", inheritImageFrom: "everyday-essentials" },
  { type: "category" as const, slug: "heels", inheritImageFrom: "evening-heels" },
  /**
   * The one tile that stays a collection, and the only one that earns it: recency is not a
   * category. Its link is pointed at `/new-in`, the shop's actual new-arrivals listing, so the
   * tile stops leading to a second, near-identical page that duplicates it.
   */
  { type: "collection" as const, slug: "new-arrivals", href: "/new-in" },
  { type: "category" as const, slug: "gynaikeia-boots", inheritImageFrom: "boots-booties" },
];

async function main() {
  console.log(`\n  Homepage tiles — ${apply ? "APPLYING" : "dry run (pass --apply to write)"}\n`);

  const row = await prisma.siteContent.findUnique({ where: { key: "homepage" } });
  if (!row) {
    console.error("  No homepage row in site_content.\n");
    process.exitCode = 1;
    return;
  }

  const data = row.data as { sections: { id: string; type: string; data: Record<string, unknown> }[] };
  const section = data.sections.find((s) => s.type === "featuredCollections");
  if (!section) {
    console.error("  No featuredCollections section on the homepage.\n");
    process.exitCode = 1;
    return;
  }

  const resolved: ({ type: "category"; slug: string } | { type: "collection"; id: string })[] = [];
  for (const tile of TILES) {
    if (tile.type === "category") {
      const category = await prisma.category.findUnique({
        where: { slug: tile.slug },
        select: { name: true, nameEl: true, image: true, _count: { select: { products: true } } },
      });
      if (!category) throw new Error(`no category "${tile.slug}"`);
      let image = category.image;
      if (tile.inheritImageFrom) {
        const source = await prisma.collection.findUnique({ where: { slug: tile.inheritImageFrom }, select: { image: true } });
        if (!source) throw new Error(`no collection "${tile.inheritImageFrom}" to take the image from`);
        image = source.image;
        console.log(`      image <- ${tile.inheritImageFrom}`);
        if (apply) await prisma.category.update({ where: { slug: tile.slug }, data: { image: image as never } });
      }
      // The grid is mostly picture, so a category with no image at all would render as a gap.
      if (!image) throw new Error(`category "${tile.slug}" has no card image — set one in the admin first`);
      console.log(`    category   ${tile.slug.padEnd(22)} ${String(category.nameEl ?? category.name).padEnd(22)} ${category._count.products} products`);
      resolved.push({ type: "category", slug: tile.slug });
    } else {
      const collection = await prisma.collection.findUnique({
        where: { slug: tile.slug },
        select: { id: true, title: true, titleEl: true, ctaHref: true, _count: { select: { products: true } } },
      });
      if (!collection) throw new Error(`no collection "${tile.slug}"`);
      if (tile.href && collection.ctaHref !== tile.href) {
        console.log(`      href ${collection.ctaHref ?? "(default)"} -> ${tile.href}`);
        if (apply) await prisma.collection.update({ where: { slug: tile.slug }, data: { ctaHref: tile.href } });
      }
      console.log(`    collection ${tile.slug.padEnd(22)} ${String(collection.titleEl ?? collection.title).padEnd(22)} ${collection._count.products} products`);
      resolved.push({ type: "collection", id: collection.id });
    }
  }

  console.log(`\n  before: ${JSON.stringify(section.data.collectionIds ?? section.data.tiles)}`);
  console.log(`  after:  ${JSON.stringify(resolved)}`);

  if (!apply) {
    console.log("\n  Dry run — nothing written.\n");
    return;
  }

  section.data.tiles = resolved;
  /**
   * `collectionIds` is deliberately LEFT IN PLACE.
   *
   * Deleting it took the live homepage down for four minutes. The renderer that reads `tiles`
   * was not deployed yet, and the build that was reads `collectionIds` — so removing the field
   * handed the running code undefined, and it threw on every render of "/" until the field was
   * put back.
   *
   * Additive first is the rule, the same one the customerNote migration followed: a data change
   * must be safe for the build ALREADY RUNNING, because that is the one serving customers while
   * the deploy is still queued. The new renderer prefers `tiles`, so the stale field is ignored
   * the moment it ships, and can be dropped in a later pass once nothing reads it.
   */

  await prisma.siteContent.update({ where: { key: "homepage" }, data: { data: data as never } });
  console.log("\n  Written.\n");
}

main()
  .catch((error) => {
    console.error("\n  Failed:", error instanceof Error ? error.message : error, "\n");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
