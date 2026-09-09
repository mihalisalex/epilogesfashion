import "server-only";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { claimCronRun, runCron } from "@/services/cron-runs";

/**
 * Scheduled deletion of personal data this shop no longer has a reason to hold (PRIV-001).
 *
 * The shop operates in Greece, so GDPR applies: personal data may be kept only as long as
 * the purpose it was collected for lasts. Two stores here had no end date at all.
 *
 * Nothing in this module touches an order, a customer or anything a person might later ask
 * for a copy of. It clears operational debris — a forensic copy of a webhook body, and the
 * IP addresses the rate limiter keys on.
 */

/**
 * Webhook bodies are kept for forensics: when a payment goes wrong, the exact bytes the
 * provider signed are what settles the argument. That need is measured in days, but the
 * payloads were kept forever — and a card provider's payload carries the shopper's name,
 * email, billing address and card metadata.
 *
 * Ninety days covers any dispute window a payment provider offers while ending the
 * indefinite hold.
 */
export const WEBHOOK_PAYLOAD_RETENTION_DAYS = 90;

/**
 * Rate-limit rows are IP addresses, which are personal data in the EU. They were pruned
 * opportunistically on ~1% of calls, which is unreliable at low traffic — the tail of a
 * quiet shop is exactly where rows sit longest. This makes it a scheduled certainty.
 *
 * Two days, comfortably past the longest window any limiter in this app uses (one hour).
 */
export const RATE_LIMIT_RETENTION_DAYS = 2;

export interface RetentionSummary {
  webhookPayloadsCleared: number;
  rateLimitRowsDeleted: number;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export async function runDataRetention(): Promise<RetentionSummary> {
  /**
   * The payload is BLANKED, not the row deleted.
   *
   * The event record itself is the audit trail — which events arrived, when, whether they
   * verified, whether they applied. Deleting the row would destroy that history and, worse,
   * free the `(provider, eventId)` unique constraint that makes replay suppression work: a
   * provider redelivering a two-year-old event would then be processed as new. Clearing
   * only the body removes the personal data and keeps both properties.
   */
  const cleared = await prisma.paymentWebhookEvent.updateMany({
    where: { receivedAt: { lt: daysAgo(WEBHOOK_PAYLOAD_RETENTION_DAYS) }, rawPayload: { not: "" } },
    data: { rawPayload: "" },
  });

  const rateLimits = await prisma.rateLimitAttempt.deleteMany({
    where: { createdAt: { lt: daysAgo(RATE_LIMIT_RETENTION_DAYS) } },
  });

  const summary = {
    webhookPayloadsCleared: cleared.count,
    rateLimitRowsDeleted: rateLimits.count,
  };

  if (summary.webhookPayloadsCleared > 0 || summary.rateLimitRowsDeleted > 0) {
    logger.info("Data retention pass completed", summary);
  }
  return summary;
}

/**
 * 25 hours, not 24, and the extra hour is doing a job.
 *
 * The scheduled run must always win the race against the fallback, because which one ran is
 * the evidence OPS-001 turns on. Hobby crons fire anywhere inside their hour (Vercel's
 * documented precision is ±59 min), so consecutive scheduled runs can legitimately be up to
 * ~25 hours apart. A 24-hour window would let the fallback claim the slot minutes before a
 * late-but-working cron arrived, and the run log would then show `fallback` forever while
 * the scheduler quietly recovered — masking exactly the fact this is meant to expose.
 */
export const RETENTION_FALLBACK_INTERVAL_MS = 25 * 60 * 60 * 1000;

/**
 * Run the retention pass if nothing else has for a day (OPS-001).
 *
 * This exists because the schedule does not fire. The job is correctly written, deployed,
 * authorized, registered and enabled, and three consecutive 03:30 slots have passed without
 * it running; every explanation reachable from this side has been eliminated and the next
 * step is Vercel's. Meanwhile `PRIV-001`'s GDPR position is only honoured when a human
 * remembers to trigger it by hand, and "we delete IP addresses after two days, provided
 * someone runs a command" is not a retention policy.
 *
 * So retention stops depending on the scheduler: `lib/rate-limit.ts` calls this from
 * ordinary request traffic, and the daily claim in `claimCronRun` makes it run at most once
 * a day however many requests arrive. That is the same opportunistic pattern the rate
 * limiter already used for its own pruning, with the probability swapped for a time window
 * — at this shop's traffic, a 1-in-100 coin flip was effectively never landing.
 *
 * **It is a workaround and the run log keeps it visible as one.** Every pass records whether
 * it was `schedule` or `fallback`, so the day Vercel starts firing the cron, the log says so
 * rather than hiding it behind a working shop.
 */
export async function runDataRetentionIfDue(): Promise<RetentionSummary | null> {
  if (!(await claimCronRun("data-retention", RETENTION_FALLBACK_INTERVAL_MS))) return null;
  return runCron("data-retention", "fallback", runDataRetention);
}
