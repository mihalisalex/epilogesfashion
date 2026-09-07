import "server-only";
import { prisma } from "@/lib/prisma";
import { getSiteContent, setSiteContent } from "@/lib/site-content";

/**
 * A record of when each scheduled job actually ran (OPS-001).
 *
 * OPS-001 was opened on the principle that "a subsystem nobody has watched run is not a
 * subsystem known to work", and then spent three days proving the point the hard way: the
 * only way to answer "did the retention cron fire?" was to reason backwards from row ages
 * in a table the app also prunes opportunistically. That is why the finding's own marker
 * test was invalid — the 33 rows it left as evidence could equally have been deleted by
 * `lib/rate-limit.ts`'s 1-day prune, so their disappearance proved nothing either way.
 *
 * A job that records its own runs makes that a one-line question instead of a forensic
 * exercise, and it distinguishes the three things the database cannot: whether a run
 * happened, whether VERCEL'S SCHEDULER started it or a human did, and whether it succeeded.
 *
 * Stored in `SiteContent` rather than a table of its own, deliberately. This shop applies
 * migrations by hand against `DIRECT_URL` — nothing in the build runs `migrate deploy` —
 * so a new table would mean the observability lands one manual step after the deploy that
 * needs it. `SiteContent` is already a generic key/Json document store (see its comment in
 * schema.prisma) and needs no schema change at all, which means this ships and starts
 * recording on the next push.
 */

/** The three jobs declared in vercel.json. Kept here so health can report on all of them. */
export const CRON_JOBS = ["data-retention", "email-followups", "instagram-token"] as const;
export type CronJob = (typeof CRON_JOBS)[number];

/**
 * How a run started, which is the whole point of recording anything.
 *
 * `schedule` is the only value that answers OPS-001. A log full of `manual` and `fallback`
 * runs says retention is being enforced while the scheduler is still dead — true and
 * important, but a different fact, and conflating the two is how this finding came to be
 * carried as "half resolved" for two days.
 */
export type CronTrigger = "schedule" | "manual" | "fallback";

export interface CronRunRecord {
  /** ISO 8601, UTC. */
  at: string;
  trigger: CronTrigger;
  ok: boolean;
  durationMs: number;
  /** Whatever the job returned — row counts, mostly. Never personal data. */
  summary?: unknown;
  /** Message only. Stacks go to the logger, which forwards them to Sentry. */
  error?: string;
}

interface CronRunDocument {
  lastRun: CronRunRecord | null;
  lastSuccessAt: string | null;
  /** Newest first. Capped — this is an operational breadcrumb trail, not an audit log. */
  history: CronRunRecord[];
}

const HISTORY_LIMIT = 20;

const EMPTY_DOCUMENT: CronRunDocument = { lastRun: null, lastSuccessAt: null, history: [] };

function documentKey(job: CronJob): string {
  return `cron:${job}`;
}

/**
 * Vercel's scheduler identifies itself; nothing else can.
 *
 * `x-vercel-cron-schedule` carries the cron expression that triggered the invocation and is
 * what Vercel's own documentation tells you to read. Both header spellings are accepted
 * because the `x-vercel-cron` form predates it and is still what several of Vercel's
 * examples show — and getting this wrong fails in the direction that matters, silently
 * relabelling a real scheduled run as `manual` and leaving OPS-001 looking unfixed forever.
 *
 * Neither can be forged from outside: the `x-vercel-*` prefix is reserved and inbound copies
 * are stripped at the edge, which is the same property `getClientIp` relies on.
 */
export function cronTriggerFromRequest(request: Request): CronTrigger {
  const scheduled = request.headers.get("x-vercel-cron-schedule") ?? request.headers.get("x-vercel-cron");
  return scheduled ? "schedule" : "manual";
}

/**
 * Take the daily slot for `job`, or report that someone else already has it.
 *
 * Raw SQL because the whole value here is atomicity, and Prisma has no single call that
 * expresses "insert if absent, otherwise update only when the existing row is older than
 * this". Split into a read and a write it becomes a race: two concurrent requests both see
 * a stale timestamp, both claim, and the fallback runs twice. Harmless for retention, which
 * is idempotent — but this is the lock every future scheduled job would copy.
 *
 * `ON CONFLICT DO UPDATE` touches only `updatedAt`, never `data`, so claiming a slot cannot
 * destroy the history written by the run before it.
 *
 * `now() at time zone 'utc'` rather than `now()`: the column is `TIMESTAMP(3)` WITHOUT time
 * zone, so assigning a `timestamptz` to it converts through the session's TimeZone setting.
 * Every other writer of this column is Prisma, which sends UTC. Leaving that to the session
 * default would put a silent hours-wide skew into the one timestamp this module exists to
 * be trusted about, on a server whose timezone this code has no business assuming.
 */
export async function claimCronRun(job: CronJob, minIntervalMs: number): Promise<boolean> {
  const cutoff = new Date(Date.now() - minIntervalMs);
  const initial = JSON.stringify(EMPTY_DOCUMENT);

  const claimed = await prisma.$executeRaw`
    INSERT INTO site_content ("key", "data", "updatedAt")
    VALUES (${documentKey(job)}, ${initial}::jsonb, now() at time zone 'utc')
    ON CONFLICT ("key") DO UPDATE
      SET "updatedAt" = now() at time zone 'utc'
      WHERE site_content."updatedAt" < ${cutoff}
  `;

  return claimed > 0;
}

/** Append one run to the job's record. Never throws — see `runCron`. */
export async function recordCronRun(job: CronJob, record: CronRunRecord): Promise<void> {
  const current = await getSiteContent<CronRunDocument>(documentKey(job), EMPTY_DOCUMENT);
  await setSiteContent<CronRunDocument>(documentKey(job), {
    lastRun: record,
    lastSuccessAt: record.ok ? record.at : current.lastSuccessAt,
    history: [record, ...current.history].slice(0, HISTORY_LIMIT),
  });
}

/**
 * Run a job and record that it ran, whichever way it goes.
 *
 * The recording is in a `finally`-shaped pair rather than after a successful call, because
 * "it ran and threw" and "it never ran at all" are the two states this finding could not
 * previously tell apart, and they have completely different fixes.
 *
 * A failure to WRITE the record is swallowed. Bookkeeping must never be able to fail the
 * work it is bookkeeping — the same rule `recordAdminAction` follows, and for the same
 * reason: a retention pass that deleted 1,600 rows and then lost its receipt has still
 * honoured the GDPR position, and turning that into a 500 would make the cron look broken
 * in exactly the way this module exists to disprove.
 */
export async function runCron<T>(job: CronJob, trigger: CronTrigger, work: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    const summary = await work();
    await recordCronRun(job, {
      at: new Date().toISOString(),
      trigger,
      ok: true,
      durationMs: Date.now() - startedAt,
      summary,
    }).catch(() => {});
    return summary;
  } catch (error) {
    await recordCronRun(job, {
      at: new Date().toISOString(),
      trigger,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
    throw error;
  }
}

/**
 * A daily job is stale once it has missed a full cycle, not the moment it is a minute late.
 *
 * 36 hours, which is one day plus the slack a daily job legitimately has: Hobby crons are
 * triggered to the hour rather than the minute (Vercel's documented precision is ±59 min),
 * and the traffic-driven fallback in `lib/rate-limit.ts` needs a request to arrive before it
 * can run. A tighter bound would report a healthy shop as broken every quiet night, which is
 * the fastest way to make an operational signal ignored.
 */
export const CRON_STALE_AFTER_MS = 36 * 60 * 60 * 1000;

export interface CronJobStatus {
  job: CronJob;
  lastRunAt: string | null;
  lastTrigger: CronTrigger | null;
  lastSuccessAt: string | null;
  stale: boolean;
}

/**
 * Every job's freshness in one query, for `/api/health`.
 *
 * A job that has never recorded a run reads as stale. That is the correct answer and the
 * one OPS-001 was opened about: "no evidence it ran" and "evidence it did not run" are the
 * same thing from outside, and treating an absent record as fine is how a subsystem gets to
 * be deployed for six weeks without anyone noticing it never executed.
 */
export async function getCronJobStatuses(): Promise<CronJobStatus[]> {
  const rows = await prisma.siteContent.findMany({
    where: { key: { in: CRON_JOBS.map(documentKey) } },
    select: { key: true, data: true },
  });
  const byKey = new Map(rows.map((row) => [row.key, row.data as unknown as CronRunDocument]));
  const staleBefore = Date.now() - CRON_STALE_AFTER_MS;

  return CRON_JOBS.map((job) => {
    const document = byKey.get(documentKey(job));
    const lastSuccessAt = document?.lastSuccessAt ?? null;
    return {
      job,
      lastRunAt: document?.lastRun?.at ?? null,
      lastTrigger: document?.lastRun?.trigger ?? null,
      lastSuccessAt,
      stale: !lastSuccessAt || new Date(lastSuccessAt).getTime() < staleBefore,
    };
  });
}
