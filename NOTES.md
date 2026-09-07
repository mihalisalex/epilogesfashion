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

**`OPS-001` — the data-retention cron still does not run**, and a third slot failed on 09-07:
198 rows sat past retention four hours after it, the oldest already two days old before the
slot began. The job is correctly written, deployed, authorized, **registered and enabled**
(`vercel crons ls` lists all three). **Next step is Vercel support, not another query.**

**Two things changed on 09-07, and both matter to whoever picks this up.**

1. **The marker test this repo left behind was invalid.** `AUDIT.md` had set 33 rows as the
   discriminator — "if they are gone tomorrow it runs late, if they are still there it does
   not run". They are gone, and it proves nothing: `lib/rate-limit.ts` prunes rows over a day
   old on ~1% of calls, so it deletes those rows too. The entry had already dismissed that
   prune as a confound for a row *surviving*, then used its *deletion* as evidence. Only a row
   that survives can settle it.

2. **Retention no longer depends on the cron.** `runDataRetentionIfDue` runs the full pass from
   ordinary request traffic when a day has gone by with no recorded run, so `PRIV-001` is
   honoured whether or not Vercel ever fires. And all three cron jobs now record their own runs
   (`services/cron-runs.ts`) — including **what triggered them**, from Vercel's
   `x-vercel-cron-schedule` header — so the question stops being forensic:

   ```sql
   SELECT data->'lastRun'->>'trigger' FROM site_content WHERE key = 'cron:data-retention';
   ```

   `schedule` closes the finding. `fallback` means retention is fine and Vercel is still
   broken — which is when the support ticket is worth opening, with a dated log to attach.
   No row at all is a new problem.

Three more explanations died on 09-07, one of them a hypothesis this repo had been carrying:
**the plan cron limit is a myth** — Vercel documents 100 cron jobs per project on *every* plan,
Hobby included. Also dead: a cached response masking the run (`X-Vercel-Cache: MISS`, so the
function really does execute), and redeploy churn resetting the schedule (nothing deployed in
the six hours spanning the slot).

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
