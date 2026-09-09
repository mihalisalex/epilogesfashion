import "server-only";
import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimitedResponse } from "@/lib/commerce/http-errors";
import { runDataRetentionIfDue } from "@/services/data-retention";

interface RateLimitWindow {
  /** Scopes the limit — e.g. "sign-in:{ip}", "sign-in:{email}", "sign-up:{ip}". */
  key: string;
  limit: number;
  windowMs: number;
}

interface RateLimitStatus {
  limited: boolean;
  retryAfterSeconds: number;
}

/**
 * Sliding-window rate limit backed by a row-per-attempt table (see `RateLimitAttempt`
 * in schema.prisma) rather than a running counter column — counting rows in the
 * window is race-free under concurrent requests with no read-then-write locking
 * needed, at the cost of a bit more storage (self-pruned in `recordAttempt` below).
 *
 * Split into peek (`isRateLimited`) and record (`recordAttempt`) rather than one
 * check-and-record call so callers can choose what counts toward the limit — e.g.
 * sign-in only wants to count *failed* attempts (a legitimate user signing in
 * repeatedly shouldn't get themselves locked out), while sign-up/password-reset
 * want to count every attempt regardless of outcome, since the thing being limited
 * there is request volume itself, not "wrongness."
 */
export async function isRateLimited({ key, limit, windowMs }: RateLimitWindow): Promise<RateLimitStatus> {
  const windowStart = new Date(Date.now() - windowMs);
  const [count, oldest] = await Promise.all([
    prisma.rateLimitAttempt.count({ where: { key, createdAt: { gte: windowStart } } }),
    prisma.rateLimitAttempt.findFirst({ where: { key, createdAt: { gte: windowStart } }, orderBy: { createdAt: "asc" } }),
  ]);

  if (count < limit) return { limited: false, retryAfterSeconds: 0 };
  const retryAfterMs = oldest ? oldest.createdAt.getTime() + windowMs - Date.now() : windowMs;
  return { limited: true, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
}

/**
 * When this instance last asked whether retention is due. Module scope, so it costs nothing
 * and resets with the instance.
 *
 * This replaced a `Math.random() < 0.01` gate, and the reason is measurement rather than
 * taste. A 1-in-100 chance needs traffic to be reliable, and the tail of a quiet shop is
 * exactly where rows sit longest: on a day this shop recorded 61 attempts, the expected
 * number of prunes was 0.6. The cleanup was least likely to happen precisely when it was
 * the only thing happening.
 *
 * An hour per warm instance, converging through the daily claim in `claimCronRun` to one
 * real pass a day however many instances Vercel keeps warm. A cold instance starts at 0 and
 * so checks on its first request, which costs one `INSERT … ON CONFLICT` that almost always
 * updates nothing.
 */
let lastRetentionCheckAt = 0;
const RETENTION_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export async function recordAttempt(key: string): Promise<void> {
  await prisma.rateLimitAttempt.create({ data: { key } });

  /**
   * The rate limiter is where this shop's personal data accumulates fastest — these rows
   * are IP addresses — so it is also where retention gets driven from while the Vercel cron
   * does not fire (OPS-001).
   *
   * The old opportunistic prune deleted rate-limit rows over a day old and nothing else.
   * `runDataRetentionIfDue` runs the whole documented policy instead: rate-limit rows at two
   * days AND webhook payload bodies at ninety, which the prune never touched and which no
   * other code path clears. Rows now live up to two days rather than one, which is not a
   * regression — two days is the stated policy (`RATE_LIMIT_RETENTION_DAYS`), and the old
   * one-day figure was an unrelated number chosen for a different mechanism.
   *
   * Off the response path, so a customer adding to their cart never pays for it — but via
   * `after` rather than a floating promise, and the difference is the whole fallback working
   * or not. Vercel freezes the instance once the response is sent; a bare `void promise()`
   * can therefore be suspended mid-pass. That failure is silent and, worse, self-locking:
   * the daily slot has already been claimed, so nothing retries for 25 hours and retention
   * quietly does half its job every day. `after` is Next's primitive for exactly this — it
   * keeps the invocation alive until the callback settles.
   *
   * Every caller of `recordAttempt` is a Route Handler or a server action, which is where
   * `after` is available. The `try` is there because outside a request scope it throws, and
   * this module's own rule — the one that keeps `enforceRateLimit`'s floating write inside a
   * `.catch` — is that housekeeping must never be able to break the request it rode in on.
   */
  if (Date.now() - lastRetentionCheckAt >= RETENTION_CHECK_INTERVAL_MS) {
    lastRetentionCheckAt = Date.now();
    const pass = async () => {
      try {
        await runDataRetentionIfDue();
      } catch (error) {
        console.error("[rate-limit] data retention fallback failed", error);
      }
    };
    try {
      after(pass);
    } catch {
      void pass();
    }
  }
}

/**
 * The client IP every rate limit in this app is keyed on — including admin sign-in.
 *
 * Header order is a trust decision, not a preference. `x-forwarded-for` is an ordinary
 * request header: anyone can send one. If the platform in front APPENDS to a client-supplied
 * value rather than replacing it, then reading the leftmost entry reads whatever the caller
 * put there — and a single attacker gets a fresh rate-limit bucket per request by varying
 * it, defeating brute-force protection on the login form along with every other limit here.
 *
 * So the platform's own header is preferred. `x-vercel-forwarded-for` is set by Vercel's
 * edge and cannot be spoofed: the `x-vercel-*` prefix is reserved, and inbound copies are
 * stripped before a request reaches the function. `x-real-ip` is likewise set by the
 * platform. Only when neither is present — local dev, or a host that sets nothing — does
 * this fall back to `x-forwarded-for`, where there is no proxy in front to be lied to about
 * in the first place.
 *
 * Deliberately NOT resolved by counting hops from the right: that needs the exact number of
 * trusted proxies, which is a deployment detail this module has no way to know and which
 * changes silently when one is added.
 */
export function getClientIp(headers: Headers): string {
  for (const header of ["x-vercel-forwarded-for", "x-real-ip", "x-forwarded-for"]) {
    const value = headers.get(header);
    // A comma-separated list only ever appears in a forwarded-for style header; taking the
    // first entry is correct for the platform-set ones, which name the true client first.
    const first = value?.split(",")[0]?.trim();
    if (first) return first;
  }
  return "unknown";
}

/**
 * Check-and-record in one call, returning a 429 response when the caller should stop.
 *
 * The auth routes deliberately keep the two-step peek/record form because they only want
 * FAILED attempts to count. Everything else — cart writes, checkout creation, order
 * completion, the catalog endpoint — is limiting request volume itself, where every call
 * counts and the split was just six lines of ceremony repeated per route. Of 47 API
 * routes only ten had any limit at all, and the ones that could create rows or run the
 * heaviest queries were among those that didn't.
 *
 * Usage: `const limited = await enforceRateLimit(request, {...}); if (limited) return limited;`
 */
export async function enforceRateLimit(
  request: Request,
  { name, limit, windowMs }: { name: string; limit: number; windowMs: number }
): Promise<NextResponse | null> {
  const key = `${name}:ip:${getClientIp(request.headers)}`;
  const status = await isRateLimited({ key, limit, windowMs });
  if (status.limited) return rateLimitedResponse(status.retryAfterSeconds);

  /**
   * The attempt is recorded WITHOUT awaiting it, which buys a round trip on every request that
   * passes the limit — the write has no bearing on the answer already given above.
   *
   * **This is safe here and would not be in the sign-in paths, so the distinction matters.**
   * Nothing that guards a credential goes through `enforceRateLimit`: sign-in, sign-up,
   * password reset, change-password, admin login and the OAuth routes all call `isRateLimited`
   * and `recordAttempt` separately, because they need to choose what counts as an attempt (a
   * failed sign-in, not a successful one). Those still await their writes. `enforceRateLimit`
   * covers volume limits only — cart, checkout, search, products, media — where a request
   * slipping through a wider window costs nothing worth protecting.
   *
   * The window was never airtight in any case: the read and the write are not atomic, so
   * concurrent requests could already read before either wrote. This widens a gap that exists
   * rather than opening a new one. `.catch` because an unhandled rejection in a floating promise
   * takes the function down, and a lost rate-limit row must not be able to do that.
   */
  void recordAttempt(key).catch((error) => {
    console.error("[rate-limit] failed to record attempt", { key, error });
  });
  return null;
}
