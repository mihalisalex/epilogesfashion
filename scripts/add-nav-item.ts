import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Adds an entry to the primary navigation.
 *
 *   npx tsx scripts/add-nav-item.ts home / Αρχική --first           # dry run
 *   npx tsx scripts/add-nav-item.ts home / Αρχική --first --apply   # write
 *
 * Arguments are id, href and label. `--first` puts it at the top of the menu; without it the
 * entry is appended.
 *
 * **The label is stored in ordinary case, not capitals.** The menu uppercases with CSS — the
 * stored "Γυναικεία" renders as ΓΥΝΑΙΚΕΙΑ — so writing "ΑΡΧΙΚΗ" here would be uppercased text
 * being uppercased again: identical on screen, wrong everywhere the label is read without that
 * styling, and it loses the accent that belongs on the word.
 *
 * Adding a nav item is safe for the build already running: the header maps over whatever
 * `primary` contains. That is worth stating because the opposite — deleting a field the
 * deployed code still reads — took this homepage down earlier today.
 */
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const first = args.includes("--first");
const mobileOnly = args.includes("--mobile-only");
/** `--after <id>` places the entry directly after that item, keeping shopping links together. */
const afterIdx = args.indexOf("--after");
const after = afterIdx > -1 ? args[afterIdx + 1] : undefined;
const [id, href, ...labelParts] = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--after");
const label = labelParts.join(" ");

interface NavItem {
  id?: string;
  label?: string;
  href?: string;
  /** Hidden from the desktop header, kept in the mobile menu — see types/navigation.ts. */
  mobileOnly?: boolean;
  children?: NavItem[];
}

async function main() {
  if (!id || !href || !label) {
    console.error("\n  Usage: npx tsx scripts/add-nav-item.ts <id> <href> <label> [--first] [--apply]\n");
    process.exitCode = 1;
    return;
  }

  const row = await prisma.siteContent.findUnique({ where: { key: "navigation" } });
  if (!row) {
    console.error("\n  No navigation row in site_content.\n");
    process.exitCode = 1;
    return;
  }

  const data = row.data as unknown as { primary: NavItem[] };

  const clash = data.primary.find((item) => item.id === id || item.href === href);

  /**
   * An existing entry is updated in place rather than refused, so the flags below can be
   * changed on something already in the menu without deleting and re-adding it — which would
   * silently move it to the end and lose its position.
   */
  if (clash) {
    console.log(`\n  Navigation — ${apply ? "APPLYING" : "dry run (pass --apply to write)"}\n`);
    console.log(`  "${clash.label}" already occupies ${clash.href} — updating it in place.`);
    console.log(`    mobileOnly: ${clash.mobileOnly ?? false} -> ${mobileOnly}`);
    if (!apply) {
      console.log("\n  Dry run — nothing written.\n");
      return;
    }
    clash.mobileOnly = mobileOnly || undefined;
    await prisma.siteContent.update({ where: { key: "navigation" }, data: { data: data as never } });
    console.log("\n  Written.\n");
    return;
  }

  const entry: NavItem = { id, href, label, ...(mobileOnly ? { mobileOnly: true } : {}) };
  /**
   * Appending puts a shopping category below the editorial links, which reads as an
   * afterthought in the phone menu where the list IS the navigation. `--after` keeps it with
   * the other places to shop.
   */
  let next: NavItem[];
  if (first) next = [entry, ...data.primary];
  else if (after) {
    const at = data.primary.findIndex((item) => item.id === after);
    if (at < 0) {
      console.error(`
  No item with id "${after}" to place it after. Present: ${data.primary.map((i) => i.id).join(", ")}
`);
      process.exitCode = 1;
      return;
    }
    next = [...data.primary.slice(0, at + 1), entry, ...data.primary.slice(at + 1)];
  } else next = [...data.primary, entry];

  console.log(`\n  Navigation — ${apply ? "APPLYING" : "dry run (pass --apply to write)"}\n`);
  console.log("  menu after:");
  for (const item of next) console.log(`    ${item.id === id ? "+ " : "  "}${String(item.label).padEnd(18)} -> ${String(item.href).padEnd(12)}${item.mobileOnly ? "  (mobile only)" : ""}`);

  if (!apply) {
    console.log("\n  Dry run — nothing written.\n");
    return;
  }

  data.primary = next;
  await prisma.siteContent.update({ where: { key: "navigation" }, data: { data: data as never } });
  console.log("\n  Written.\n");
}

main()
  .catch((error) => {
    console.error("\n  Failed:", error instanceof Error ? error.message : error, "\n");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
