import "dotenv/config";
import { getCronJobStatuses, getCronRunHistory } from "@/services/cron-runs";
import { RATE_LIMIT_RETENTION_DAYS } from "@/services/data-retention";
import { prisma } from "@/lib/prisma";

/**
 * Answers OPS-001's remaining question: did Vercel's scheduler actually fire?
 *
 *   npm run cron:status
 *
 * The finding spent three days being argued from row ages because there was nothing else to
 * argue from, and the marker test it eventually set could not discriminate — the rows it was
 * watching are also deleted by the rate limiter's own prune. `services/cron-runs.ts` fixed
 * that by having each job record what triggered it; this script is the reader for it, so the
 * check is one command instead of a remembered SQL string and a `psql` this machine does not
 * have.
 *
 * `--conditions=react-server` in the npm script is not decoration: the services imported here
 * pull in `server-only`, which throws outside a React server runtime. Reading the rows with
 * hand-written SQL instead would mean checking something other than what the shop runs.
 *
 * Reports the run log AND the ground truth it is supposed to reflect — rows actually sitting
 * past their retention window. If those two ever disagree, believe the rows: a log saying a
 * pass succeeded while the data it should have deleted is still there is a worse problem than
 * the one this was written for.
 */

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function ago(iso: string | null): string {
  if (!iso) return "never";
  const hours = (Date.now() - new Date(iso).getTime()) / (60 * 60 * 1000);
  const relative = hours < 1 ? RELATIVE.format(-Math.round(hours * 60), "minute") : RELATIVE.format(-Math.round(hours), "hour");
  return `${iso.replace("T", " ").slice(0, 19)}Z (${relative})`;
}

async function main(): Promise<void> {
  const statuses = await getCronJobStatuses();

  console.log("\n  Scheduled jobs\n");
  for (const status of statuses) {
    const flag = status.stale ? "STALE" : "ok   ";
    console.log(`  ${flag}  ${status.job.padEnd(18)} last run: ${ago(status.lastRunAt)}`);
    console.log(`         ${" ".repeat(18)} trigger:  ${status.lastTrigger ?? "—"}`);
  }

  const retention = statuses.find((status) => status.job === "data-retention");
  const history = await getCronRunHistory("data-retention");

  if (history.length > 0) {
    console.log("\n  data-retention, recent runs (newest first)\n");
    for (const run of history.slice(0, 8)) {
      const outcome = run.ok ? "ok" : `FAILED — ${run.error ?? "no message"}`;
      console.log(`    ${run.at.replace("T", " ").slice(0, 19)}Z  ${run.trigger.padEnd(9)} ${outcome}`);
    }
  }

  /**
   * The ground truth. `runDataRetention` deletes rate-limit rows past this window, so a
   * non-zero count here means retention is not currently being honoured — whatever the log
   * above says, and whichever mechanism was supposed to have done it.
   */
  const cutoff = new Date(Date.now() - RATE_LIMIT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const [overdue, total] = await Promise.all([
    prisma.rateLimitAttempt.count({ where: { createdAt: { lt: cutoff } } }),
    prisma.rateLimitAttempt.count(),
  ]);

  console.log(`\n  Rate-limit rows: ${total} total, ${overdue} past their ${RATE_LIMIT_RETENTION_DAYS}-day window`);

  console.log("\n  Verdict\n");
  if (!retention || !retention.lastRunAt) {
    console.log("  NO RUNS RECORDED. Either this is not deployed yet, or nothing is reaching");
    console.log("  the fallback in lib/rate-limit.ts. Check that the deploy went out before");
    console.log("  reading anything into it — the run log starts empty.");
  } else if (retention.lastTrigger === "schedule") {
    console.log("  Vercel's scheduler FIRED. This is what closes OPS-001 — confirm it happens");
    console.log("  a second night before marking the finding done, since one run after three");
    console.log("  failed slots is as easily a coincidence as a recovery.");
  } else {
    console.log(`  Retention is running, but by "${retention.lastTrigger}" — NOT the schedule.`);
    console.log("  GDPR retention is being honoured; Vercel's cron is still dead. This is the");
    console.log("  point at which a support ticket is worth opening, and the run log above is");
    console.log("  the evidence to attach.");
  }

  if (overdue > 0) {
    console.log(`\n  ⚠ ${overdue} rows are past retention RIGHT NOW. If the log above claims a`);
    console.log("    recent successful pass, that pass did not do what it reported.");
  }
  console.log("");
}

main()
  .catch((error) => {
    console.error("\n  Could not read the cron run log:", error instanceof Error ? error.message : error, "\n");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
