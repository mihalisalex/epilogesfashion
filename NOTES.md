# Session Summary — 2026-09-06 → 09-07 (performance, real 404s, and an audit that kept correcting itself)

Quick-reference recap of the LATEST session only — this file gets replaced each session, it's the fast catch-up, not the archive. See `PROGRESS.md` for the detailed build log and **`AUDIT.md` for everything below in full**.

## Read this first

**The shop is live at https://shopalexandris.vercel.app**, HEAD is `0da6d45`, tree clean, all 28
commits pushed to `origin/main`. `tsc` / `eslint` / `next build` green, **455 unit tests**,
**44 browser specs**, health endpoint reporting `healthy`.

**Two owner-facing docs, and they are separate copies that do NOT sync:**
- `AUDIT.md` in this repo — the engineering source of truth.
- https://claude.ai/code/artifact/83ae5d39-da47-4a63-a835-912a2e9db761 — the published audit.
  **Update it in place by passing that URL as `url`.** "Update the audit" almost always means both.

## The one thing that is actually wrong

**`OPS-001` is much smaller than this repo has been saying, and the correction is the useful
part.** As of 09-07 the position is: **Vercel's scheduler works here**, retention is being
enforced automatically, and the one thing genuinely outstanding is that the `data-retention`
slot has never been *watched*.

**Vercel's cron fires.** `email-followups` (`0 8 * * *`) has sent abandoned-cart mail at 08:56,
08:57, 08:03, 08:32 and 08:56 UTC across five dates — every one inside its slot's hour, which
is exactly how Hobby crons behave. It fired at 08:56 on 09-07. The other days it ran and had
no eligible cart, so it left no trace: the blind spot the run log now fills.

**The evidence that retention was "still failing" was three measurement defects, not a bug.**

1. **The marker test could not discriminate.** 33 rows were nominated as "gone means it ran
   late, still there means it never runs". `lib/rate-limit.ts` prunes rows over a day old on
   ~1% of calls, so it deletes them too.
2. **A non-zero overdue count is the NORMAL state of a working daily job.** A job deleting
   rows older than two days always leaves those created between its last cutoff and two days
   ago — a set that grows all day and empties at the next run. The 33 rows and the 198 rows
   recorded as proof of failure are what a healthy job produces. Only rows older than the last
   *pass's own cutoff* mean anything.
3. **Every timestamp the ad-hoc tooling printed was three hours early.** `createdAt` is
   `TIMESTAMP(3)` **without** time zone, and node-postgres parses such columns in the client's
   local zone — Athens, UTC+3. The DB session is `GMT`, so the SQL counts were right and only
   the displayed instants were wrong, which is the dangerous combination. It flipped the 09-07
   reading on its own: the oldest surviving row was 04:55 UTC, not 01:55, which is *newer* than
   the 03:30 slot's cutoff and was supposed to survive.

**The 09-05 finding survives all of it** — 1,639 rows with the oldest 45 days old was real, and
retention genuinely had never run until the manual trigger. What is not established is that it
has failed since.

**Retention no longer depends on the cron either way.** `runDataRetentionIfDue` runs the full
pass from ordinary request traffic when a day passes with no recorded run — verified in
production on 09-07: 492 overdue rows to zero, no human involved. And all three jobs now record
their own runs, so the check is one command:

```bash
npm run cron:status
```

It refuses to conclude anything until a slot has actually elapsed under observation. Telling
you the cron is dead before it has had a chance is the precise error this finding made three
times.

Two explanations also died on 09-07, one of them a hypothesis this repo had been carrying:
**the plan cron limit is a myth** — Vercel documents 100 cron jobs per project on *every* plan.
Also dead: a cached response masking the run (`X-Vercel-Cache: MISS`, so the function really
does execute).

**If you read one thing into this:** all three defects share a shape. Each was a number
trusted because it was a number, without first asking *what a passing result would look like*.
None survives that question.

Everything else open is a choice about money or timing: the 6-hour restore window, image
optimization (`PERF-001`), the CSP nonce (`SEC-003`), and `PERF-002` — now deliberately deferred.

## What shipped

| | |
| --- | --- |
| `PERF-003` | **309 catalogue JPEGs re-encoded to WebP.** 32.39 MB → 15.61 MB (**52%**), 0 failures. Rollback material and a README in `.image-migration-2026-09-06/`. |
| `SEO-002` | Unknown product/category/collection URLs answered **200**; they now 404 properly. |
| `PERF-004` | Add-to-cart **1245ms → 1045ms**, by removing wasted round trips. |
| `TEST-001` | Suite was flaky on a cold Neon branch; `hookTimeout` raised to 30s. |

## Things that will bite whoever picks this up next

1. **`git push` hangs intermittently.** Git Credential Manager wants an interactive login this
   environment cannot drive; it fails with `unable to get password from user` or just hangs. It
   stalled this session four or five times. **The owner running `git push origin main` once clears
   it.** Commit locally and ask rather than retrying forever.

2. **The browser suite does not pass in one run, and that is not a bug.** A full pass takes ~9
   minutes and runs desktop before mobile, outliving the shop's own `cart-create` limit (60 per 10
   min, `app/api/cart/route.ts`). Desktop spends the budget; every mobile cart spec then fails
   against a limiter doing its job. **Run them alone and they pass.** This has now cost two separate
   investigations — the tell is always: all mobile, all cart, all fine in isolation.

3. **Vercel's image optimizer is still DELIBERATELY OFF** (`images.unoptimized`) — the transform
   quota is exhausted. `PERF-003` re-encoded the *source* files instead, which is a different thing
   and does not close `PERF-001`.

4. **The build's route table and production disagree**, and it is unresolved. `next build` calls
   154 routes `ƒ Dynamic` including `/`, while the edge serves those same routes as `PRERENDER` at
   ~0.2s. The user-visible result is measured and not in doubt; the bookkeeping is not understood.

5. **Dates come from the commit, not from memory.** This session ran past midnight and six entries
   were stamped a day early before the owner caught it. Use `git log`.

6. **`next build` is not silent, and it was not silent before this session either.** It prints
   three `cookies() rejects when the prerender is complete` errors, on `/api/customer/referrals`,
   `/api/admin/media` and `/api/customer/orders`. The message names `after`, so the obvious
   assumption is that the retention fallback caused them — it did not: building `5c4bee6`, before
   any of that work, produces the same three. Unexplained, not investigated, and the build still
   succeeds. Worth an entry of its own if anyone has an hour.

## `PERF-002` is deferred, deliberately — do not "resume" it

Its headline benefit **already landed**: enabling Cache Components dropped `no-store`, which let the
CDN hold the HTML, and warm TTFB went ~1.0s → ~0.2–0.4s. Three routes the build calls *dynamic*
all serve in ~0.2–0.3s. **The CDN is already doing what PPR would.**

What remains would improve only the cache-miss path, for a services-layer migration (`"use cache"`
is in 1 of 48 service files) plus server-side locale reads that live in **components**, not only
pages. Two triggers to revisit, both in `AUDIT.md`: traffic making misses material, or products
getting translated.

**And a correction worth keeping:** `"use cache"` was never being rejected. Next's prerender error
names the *nearest render position*, not the actual uncached access — it kept pointing at a cached
layout call while the real blocker was `SectionRenderer.tsx:27` calling `getLocale()`. Clear the
nearer blockers and the message walks inward. Do not trust its first answer.

## Audit scoring

Overall **74 → 92**, and the number is the **mean of the eleven dimensions, rounded** — it had
drifted to 95 against an average of 92.3, which is now stated under the table so it cannot drift
again. Performance rose 74 → 85 on measurement; Reliability fell 92 → 88 because it had credited
"scheduled retention" that does not run.
