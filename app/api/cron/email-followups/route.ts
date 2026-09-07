import { NextResponse } from "next/server";
import { runAbandonedCartRecovery, runReviewRequestFollowup } from "@/services/email-followups";
import { cronTriggerFromRequest, runCron } from "@/services/cron-runs";

/**
 * Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` to the path
 * configured in vercel.json — verifying it here is what stops this endpoint being
 * triggerable by an arbitrary public request (which could spam customers with
 * recovery/review emails on demand).
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  // An unset secret must never mean "open" — reject outright rather than matching
  // literal "Bearer undefined".
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // Recorded like the other two (OPS-001). This job's only trace was the rows it wrote, so
  // "it ran and had nothing to send" and "it never ran" were indistinguishable — and with no
  // eligible cart for most of a quiet week, the second is easy to miss for a long time.
  const summary = await runCron("email-followups", cronTriggerFromRequest(request), async () => {
    const [abandonedCarts, reviewRequests] = await Promise.all([runAbandonedCartRecovery(), runReviewRequestFollowup()]);
    return { abandonedCarts, reviewRequests };
  });

  return NextResponse.json(summary);
}
