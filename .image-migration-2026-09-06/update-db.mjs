import fs from "node:fs";
import pg from "pg";
import { config } from "dotenv";
config({ quiet: true });

const APPLY = process.argv.includes("--apply");
const REVERSE = process.argv.includes("--rollback");

const map = JSON.parse(fs.readFileSync("migration-map.json", "utf8"));
const forward = new Map(Object.entries(map.converted).map(([jpg, v]) => [jpg, v.url]));
const lookup = REVERSE
  ? new Map([...forward].map(([a, b]) => [b, a]))
  : forward;

console.log(REVERSE ? "ROLLBACK" : "FORWARD", APPLY ? "(APPLY)" : "(dry run)", `- ${lookup.size} url mappings\n`);

const url = process.env.DATABASE_URL;
console.log("host:", new URL(url).host);
const c = new pg.Client({ connectionString: url });
await c.connect();

const SOURCES = [
  { table: "products",    col: "images", kind: "array" },
  { table: "categories",  col: "image",  kind: "object" },
  { table: "collections", col: "image",  kind: "object" },
];

let totalRows = 0, totalRefs = 0;
try {
  if (APPLY) await c.query("BEGIN");

  for (const src of SOURCES) {
    const rows = (await c.query(`SELECT id, "${src.col}" AS v FROM ${src.table}`)).rows;
    let changedRows = 0, changedRefs = 0;

    for (const r of rows) {
      if (r.v == null) continue;
      let hit = 0;
      const rewrite = (im) => {
        if (im && typeof im.src === "string" && lookup.has(im.src)) { hit++; return { ...im, src: lookup.get(im.src) }; }
        return im;
      };
      const next = src.kind === "array"
        ? (Array.isArray(r.v) ? r.v.map(rewrite) : r.v)
        : rewrite(r.v);

      if (!hit) continue;
      changedRows++; changedRefs += hit;
      if (APPLY) {
        await c.query(`UPDATE ${src.table} SET "${src.col}" = $1::jsonb WHERE id = $2`, [JSON.stringify(next), r.id]);
      }
    }
    console.log(`  ${src.table}.${src.col}: ${changedRows} rows, ${changedRefs} refs`);
    totalRows += changedRows; totalRefs += changedRefs;
  }

  if (APPLY) { await c.query("COMMIT"); console.log("\nCOMMITTED"); }
  else console.log("\ndry run - nothing written. Re-run with --apply");
} catch (e) {
  if (APPLY) await c.query("ROLLBACK");
  console.error("ROLLED BACK:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
console.log(`total: ${totalRows} rows, ${totalRefs} references`);
