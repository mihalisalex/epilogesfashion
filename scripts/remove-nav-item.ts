import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Removes one entry from the primary navigation.
 *
 *   npx tsx scripts/remove-nav-item.ts collections           # dry run
 *   npx tsx scripts/remove-nav-item.ts collections --apply   # write
 *
 * Used to drop "Συλλογές" once the homepage tiles started pointing at categories. Two ways to
 * browse the same shoes is the confusing part, not the collections themselves: a shopper who
 * wants boots should not have to know whether the shop filed them under a category or a
 * collection, and two URLs for one set of products compete with each other in search.
 *
 * **The page itself is deliberately left in place.** `/collections` keeps working, so anything
 * already linking to it — a shared link, an old post, a search result — still lands somewhere
 * real. Only the menu entry goes.
 *
 * Removing a nav item is safe for the build already running: the header maps over whatever
 * `primary` contains, so a shorter list renders a shorter menu. That is worth stating because
 * the opposite mistake — deleting a field the deployed code still reads — took this homepage
 * down earlier today.
 */
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const id = args.find((a) => !a.startsWith("--"));

interface NavItem {
  id?: string;
  label?: string;
  href?: string;
  children?: NavItem[];
}

async function main() {
  if (!id) {
    console.error("\n  Usage: npx tsx scripts/remove-nav-item.ts <item-id> [--apply]\n");
    process.exitCode = 1;
    return;
  }

  const row = await prisma.siteContent.findUnique({ where: { key: "navigation" } });
  if (!row) {
    console.error("\n  No navigation row in site_content.\n");
    process.exitCode = 1;
    return;
  }

  const data = row.data as unknown as { primary: NavItem[]; footer?: { title?: string; links?: NavItem[] }[] };

  /**
   * The argument is a primary item's id, or a path.
   *
   * Both, because the two places a link lives are keyed differently: primary items carry an id,
   * footer links carry only an href. Resolving to the href and then matching on that removes a
   * destination EVERYWHERE in one run — which is the bug this grew out of, where the header
   * entry went and the footer quietly kept its copy of the same link.
   */
  const byId = data.primary.find((item) => item.id === id);
  const href = byId?.href ?? (id.startsWith("/") ? id : undefined);
  if (!href) {
    console.error(`\n  No primary nav item with id "${id}", and it is not a path. Present: ${data.primary.map((i) => i.id).join(", ")}\n`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n  Navigation — ${apply ? "APPLYING" : "dry run (pass --apply to write)"}\n`);
  console.log(`  removing every link to ${href}\n`);

  const remaining = data.primary.filter((item) => item.href !== href);
  const removedFromHeader = data.primary.length - remaining.length;
  console.log(`  header (${removedFromHeader} removed):`);
  for (const item of remaining) console.log(`    ${String(item.label).padEnd(18)} -> ${item.href}`);

  const footerHits = (data.footer ?? []).filter((group) => (group.links ?? []).some((link) => link.href === href));
  for (const group of footerHits) console.log(`\n  footer group "${group.title}" links to it as well — it goes too.`);

  if (removedFromHeader === 0 && footerHits.length === 0) {
    console.log("\n  Nothing links to it. Already done.\n");
    return;
  }

  if (!apply) {
    console.log("\n  Dry run — nothing written.\n");
    return;
  }

  data.primary = remaining;
  for (const group of data.footer ?? []) {
    group.links = (group.links ?? []).filter((link) => link.href !== href);
  }

  await prisma.siteContent.update({ where: { key: "navigation" }, data: { data: data as never } });
  console.log("\n  Written. The page itself still exists — only the links to it are gone.\n");
}

main()
  .catch((error) => {
    console.error("\n  Failed:", error instanceof Error ? error.message : error, "\n");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
