import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Moves one homepage section above another.
 *
 *   npx tsx scripts/move-homepage-section.ts newArrivals before featuredCollections
 *   npx tsx scripts/move-homepage-section.ts newArrivals before featuredCollections --apply
 *
 * Sections are identified by `type`, which is what a person recognises — "newArrivals" rather
 * than "sec-new-arrivals".
 *
 * `order` is renumbered across every section from zero afterwards, rather than squeezing the
 * moved one into a fractional or duplicate slot. Two sections sharing an order value sort
 * unpredictably, and that shows up as a homepage whose blocks swap places between renders.
 *
 * Reordering is safe for the build already running: the renderer sorts by `order` and switches
 * on `type`, both of which every section still has. Worth stating, because a data change that
 * was NOT safe for the deployed build took this homepage down earlier today.
 */
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const positional = args.filter((a) => !a.startsWith("--"));
const [moving, relation, anchor] = positional;

interface Section {
  id: string;
  type: string;
  order?: number;
  enabled?: boolean;
  data?: { title?: string };
}

async function main() {
  if (!moving || (relation !== "before" && relation !== "after") || !anchor) {
    console.error("\n  Usage: npx tsx scripts/move-homepage-section.ts <type> before|after <type> [--apply]\n");
    process.exitCode = 1;
    return;
  }

  const row = await prisma.siteContent.findUnique({ where: { key: "homepage" } });
  if (!row) {
    console.error("\n  No homepage row in site_content.\n");
    process.exitCode = 1;
    return;
  }

  const data = row.data as unknown as { sections: Section[] };
  const sections = [...data.sections].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const target = sections.find((s) => s.type === moving);
  const anchorSection = sections.find((s) => s.type === anchor);
  if (!target || !anchorSection) {
    console.error(`\n  Missing section. Present: ${sections.map((s) => s.type).join(", ")}\n`);
    process.exitCode = 1;
    return;
  }

  const without = sections.filter((s) => s !== target);
  const at = without.indexOf(anchorSection) + (relation === "after" ? 1 : 0);
  const next = [...without.slice(0, at), target, ...without.slice(at)];

  console.log(`\n  Homepage — ${apply ? "APPLYING" : "dry run (pass --apply to write)"}\n`);
  next.forEach((s, i) => {
    const marker = s === target ? ">" : " ";
    console.log(`  ${marker} ${String(i).padStart(2)} ${s.enabled === false ? "OFF" : "on "} ${s.type.padEnd(20)} ${s.data?.title ?? ""}`);
  });

  if (!apply) {
    console.log("\n  Dry run — nothing written.\n");
    return;
  }

  next.forEach((s, i) => {
    s.order = i;
  });
  data.sections = next;

  await prisma.siteContent.update({ where: { key: "homepage" }, data: { data: data as never } });
  console.log("\n  Written.\n");
}

main()
  .catch((error) => {
    console.error("\n  Failed:", error instanceof Error ? error.message : error, "\n");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
