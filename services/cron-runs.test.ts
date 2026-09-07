import { describe, expect, it, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { claimCronRun, recordCronRun, runCron, type CronJob } from "@/services/cron-runs";

/**
 * OPS-001. The run log is the thing that finally answers "did the scheduled job fire?", so
 * the ways it can be quietly wrong all have the same shape: it keeps recording, the queries
 * keep returning rows, and the answers are false. That is the failure mode this finding has
 * already produced twice — a Sentry integration reporting nothing behind a one-letter typo,
 * and a marker test whose evidence another code path could equally have deleted.
 *
 * Two properties are worth a test rather than a reading, because neither shows up in a build:
 *
 * 1. **The daily claim is atomic.** It is an `INSERT … ON CONFLICT DO UPDATE … WHERE` written
 *    as raw SQL specifically so two concurrent requests cannot both win. Split into a read
 *    and a write it would still compile, still pass a single-threaded test, and duplicate the
 *    retention pass under real traffic.
 *
 * 2. **The claim's timestamp is UTC.** `site_content."updatedAt"` is `TIMESTAMP(3)` WITHOUT
 *    time zone, so `now()` alone converts through the server's session TimeZone. On a server
 *    an hour or three off UTC the daily guard would silently shift — retention running twice
 *    a day, or skipping one — with nothing to see anywhere.
 *
 * Runs against the real database (the Neon test branch when `.env.test` provides one) under
 * a job name no production code reads, and deletes its own row afterwards. It cannot disturb
 * the records the three real jobs write.
 */

const TEST_JOB = "test-job" as CronJob;
const TEST_KEY = `cron:${TEST_JOB}`;
const DAY_MS = 24 * 60 * 60 * 1000;

let client: pg.Client | null = null;

async function db(): Promise<pg.Client> {
  if (!client) {
    client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
  }
  return client;
}

async function forget(): Promise<void> {
  await (await db()).query(`DELETE FROM site_content WHERE "key" = $1`, [TEST_KEY]);
}

/** Pretend the last claim happened `ms` ago, so the next one is due without waiting a day. */
async function backdate(ms: number): Promise<void> {
  await (
    await db()
  ).query(`UPDATE site_content SET "updatedAt" = (now() at time zone 'utc') - $2::interval WHERE "key" = $1`, [
    TEST_KEY,
    `${Math.round(ms / 1000)} seconds`,
  ]);
}

beforeEach(forget);

afterAll(async () => {
  await forget();
  await client?.end();
  client = null;
});

describe("claimCronRun", () => {
  it("claims a slot that has never been claimed", async () => {
    expect(await claimCronRun(TEST_JOB, DAY_MS)).toBe(true);
  });

  it("refuses a second claim inside the window", async () => {
    expect(await claimCronRun(TEST_JOB, DAY_MS)).toBe(true);
    expect(await claimCronRun(TEST_JOB, DAY_MS)).toBe(false);
  });

  it("claims again once the window has passed", async () => {
    expect(await claimCronRun(TEST_JOB, DAY_MS)).toBe(true);
    await backdate(DAY_MS + 60_000);
    expect(await claimCronRun(TEST_JOB, DAY_MS)).toBe(true);
  });

  it("lets exactly one of several concurrent claims through", async () => {
    expect(await claimCronRun(TEST_JOB, DAY_MS)).toBe(true);
    await backdate(DAY_MS + 60_000);

    const results = await Promise.all([
      claimCronRun(TEST_JOB, DAY_MS),
      claimCronRun(TEST_JOB, DAY_MS),
      claimCronRun(TEST_JOB, DAY_MS),
      claimCronRun(TEST_JOB, DAY_MS),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("stores the claim time in UTC, not the database session's timezone", async () => {
    const before = Date.now();
    await claimCronRun(TEST_JOB, DAY_MS);

    // Read back as timestamptz so the assertion is about the stored instant rather than
    // about whichever timezone the machine running the test happens to be in.
    const { rows } = await (
      await db()
    ).query<{ ts: Date }>(`SELECT "updatedAt" AT TIME ZONE 'utc' AS ts FROM site_content WHERE "key" = $1`, [TEST_KEY]);

    expect(rows).toHaveLength(1);
    // Generous bound: this is looking for an hours-wide timezone skew, not clock drift.
    expect(Math.abs(rows[0].ts.getTime() - before)).toBeLessThan(5 * 60 * 1000);
  });

  it("does not discard the previous run's history when claiming the next slot", async () => {
    await claimCronRun(TEST_JOB, DAY_MS);
    await recordCronRun(TEST_JOB, { at: new Date().toISOString(), trigger: "schedule", ok: true, durationMs: 12 });
    await backdate(DAY_MS + 60_000);

    expect(await claimCronRun(TEST_JOB, DAY_MS)).toBe(true);

    const { rows } = await (
      await db()
    ).query<{ data: { history: unknown[] } }>(`SELECT "data" FROM site_content WHERE "key" = $1`, [TEST_KEY]);
    expect(rows[0].data.history).toHaveLength(1);
  });
});

describe("runCron", () => {
  it("records a successful run, its trigger and what it returned", async () => {
    await runCron(TEST_JOB, "schedule", async () => ({ rateLimitRowsDeleted: 7 }));

    const { rows } = await (
      await db()
    ).query<{ data: { lastRun: { trigger: string; ok: boolean; summary: { rateLimitRowsDeleted: number } } } }>(
      `SELECT "data" FROM site_content WHERE "key" = $1`,
      [TEST_KEY],
    );

    expect(rows[0].data.lastRun.trigger).toBe("schedule");
    expect(rows[0].data.lastRun.ok).toBe(true);
    expect(rows[0].data.lastRun.summary.rateLimitRowsDeleted).toBe(7);
  });

  /**
   * The case the whole finding turns on. "It ran and threw" and "it never ran at all" look
   * identical from the database, and they have completely different fixes — so a failed run
   * has to leave a record, and the caller still has to see the error.
   */
  it("records a failed run and still rethrows", async () => {
    await expect(
      runCron(TEST_JOB, "fallback", async () => {
        throw new Error("Neon is asleep");
      }),
    ).rejects.toThrow("Neon is asleep");

    const { rows } = await (
      await db()
    ).query<{ data: { lastRun: { ok: boolean; error: string }; lastSuccessAt: string | null } }>(
      `SELECT "data" FROM site_content WHERE "key" = $1`,
      [TEST_KEY],
    );

    expect(rows[0].data.lastRun.ok).toBe(false);
    expect(rows[0].data.lastRun.error).toBe("Neon is asleep");
    // A failure must not be able to make a job look freshly successful to `/api/health`.
    expect(rows[0].data.lastSuccessAt).toBeNull();
  });
});
