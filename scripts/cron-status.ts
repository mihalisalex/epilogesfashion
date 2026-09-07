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

/** `30 3 * * *` in vercel.json. Kept in step with it by hand — there is one cron per job. */
const SLOT_HOUR_UTC = 3;
const SLOT_MINUTE_UTC = 30;

/**
 * Hobby crons are triggered to the hour, not the minute — Vercel documents ±59 min. A slot
 * is therefore not "missed" until its whole window has closed, and reading at 03:31 proves
 * nothing at all.
 */
const JITTER_MS = 60 * 60 * 1000;

function slotOn(date: Date, dayOffset = 0): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + dayOffset, SLOT_HOUR_UTC, SLOT_MINUTE_UTC),
  );
}

function nextSlot(): Date {
  const now = new Date();
  const today = slotOn(now);
  return today.getTime() > now.getTime() ? today : slotOn(now, 1);
}

function afterJitter(slot: Date): Date {
  return new Date(slot.getTime() + JITTER_MS);
}

/**
 * When this log started being able to see anything.
 *
 * The oldest run it still holds — history is capped, so after three weeks this understates
 * how long the job has been watched. That errs toward saying "not enough evidence yet",
 * which is the right direction for a script whose other branch tells someone to open a
 * support ticket.
 */
function observationStartedAt(history: { at: string }[]): Date | null {
  const oldest = history[history.length - 1];
  return oldest ? new Date(oldest.at) : null;
}

/** Every slot whose jitter window closed while the log was watching. Newest first. */
function elapsedSlotsSince(start: Date | null): Date[] {
  if (!start) return [];
  const slots: Date[] = [];
  const now = Date.now();
  for (let offset = 0; offset > -30; offset--) {
    const slot = slotOn(new Date(), offset);
    if (slot.getTime() < start.getTime()) break;
    if (afterJitter(slot).getTime() < now) slots.push(slot);
  }
  return slots;
}

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
   * The ground truth — and it is NOT "rows older than two days", which is the test this
   * finding used for three days and which cannot detect success.
   *
   * A daily job that deletes rows older than two days leaves, at any later moment, every row
   * created between its last cutoff and two days ago. That set grows all day and empties at
   * the next run. **Non-zero is the normal steady state of a job that is working**, so the
   * counts this finding recorded as proof of failure — 33 rows one morning, 198 the next —
   * were exactly what a healthy job produces. Only rows older than the LAST PASS's own cutoff
   * are evidence that a pass did not do its job.
   */
  const window = RATE_LIMIT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const expected = new Date(Date.now() - window);
  const lastPassCutoff = retention?.lastSuccessAt ? new Date(new Date(retention.lastSuccessAt).getTime() - window) : null;

  const [total, awaitingNextPass, missedByLastPass] = await Promise.all([
    prisma.rateLimitAttempt.count(),
    prisma.rateLimitAttempt.count({ where: { createdAt: { lt: expected } } }),
    lastPassCutoff ? prisma.rateLimitAttempt.count({ where: { createdAt: { lt: lastPassCutoff } } }) : Promise.resolve(0),
  ]);

  console.log(`\n  Rate-limit rows: ${total} total`);
  console.log(`    ${awaitingNextPass} older than ${RATE_LIMIT_RETENTION_DAYS} days — expected; these clear at the next pass`);
  if (lastPassCutoff) {
    console.log(`    ${missedByLastPass} older than the last pass's own cutoff — must be 0`);
  }

  console.log("\n  Verdict\n");
  const scheduled = history.filter((run) => run.trigger === "schedule");
  const slots = elapsedSlotsSince(observationStartedAt(history));

  if (!retention || !retention.lastRunAt) {
    console.log("  NO RUNS RECORDED. Either this is not deployed yet, or nothing is reaching");
    console.log("  the fallback in lib/rate-limit.ts. Check that the deploy went out before");
    console.log("  reading anything into it — the run log starts empty.");
  } else if (scheduled.length > 0) {
    console.log(`  Vercel's scheduler FIRED — last at ${scheduled[0].at.replace("T", " ").slice(0, 19)}Z.`);
    console.log("  This is what closes OPS-001. Confirm it happens a second night before marking");
    console.log("  the finding done: one run after three failed slots is as easily a coincidence");
    console.log("  as a recovery.");
  } else if (slots.length === 0) {
    /**
     * The case this script got wrong on its first real run, and the reason for the slot
     * arithmetic above. A `fallback` reading is only evidence against the scheduler once a
     * slot has actually passed under observation — minutes after the first deploy it means
     * nothing except that the fallback works. Telling the owner to open a support ticket on
     * that basis is the same error as the marker test: a conclusion the measurement does not
     * support.
     */
    console.log(`  Retention is running by "${retention.lastTrigger}", and that is all this can`);
    console.log("  say yet — NO 03:30 UTC slot has passed since the run log started. The");
    console.log(`  scheduler has not had its chance. Next slot: ${nextSlot().toISOString().replace("T", " ").slice(0, 16)}Z`);
    console.log(`  — read this again after ${afterJitter(nextSlot()).toISOString().slice(11, 16)}Z, once Vercel's ±59 min window has closed.`);
  } else {
    const missed = slots.length === 1 ? "1 slot has" : `${slots.length} slots have`;
    console.log(`  Vercel's scheduler DID NOT FIRE. ${missed} passed under observation`);
    console.log(`  (oldest ${slots[slots.length - 1].toISOString().slice(0, 16)}Z, newest ${slots[0].toISOString().slice(0, 16)}Z)`);
    console.log(`  and every recorded run was "${retention.lastTrigger}", not "schedule".`);
    console.log("");
    console.log("  GDPR retention is being honoured; the cron is dead. This is the point at");
    console.log("  which a support ticket is worth opening, and the run log above is the");
    console.log("  evidence to attach.");
  }

  if (missedByLastPass > 0) {
    console.log(`\n  ⚠ ${missedByLastPass} rows predate the last pass's own cutoff. That pass reported`);
    console.log("    success and did not do what it reported — believe the rows, not the log.");
  }
  console.log("");
}

main()
  .catch((error) => {
    console.error("\n  Could not read the cron run log:", error instanceof Error ? error.message : error, "\n");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
