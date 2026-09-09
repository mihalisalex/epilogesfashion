import { NextResponse, type NextRequest } from "next/server";
import { setCustomerNote, setPaymentMethod, setShippingRate, updateBillingAddress, updateEmail, updateShippingAddress } from "@/services/checkout";
import { commerceErrorResponse, invalidInputResponse, rateLimitedResponse } from "@/lib/commerce/http-errors";
import { getClientIp, isRateLimited, recordAttempt } from "@/lib/rate-limit";
import { addressSchema, contactSchema } from "@/lib/validation/checkout";
import { canAccessCheckout } from "@/lib/checkout-access";
import type { Checkout } from "@/lib/commerce/types";

/**
 * Real PATCH-partial-update semantics — consolidates 4 CheckoutService methods
 * (updateEmail/updateShippingAddress/updateBillingAddress/setShippingRate) into
 * one route; the body may include any subset of {email, shippingAddress,
 * billingAddress, shippingRateId}, applied in that order.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ checkoutId: string }> }) {
  try {
    // Rate-limited by IP as well as gated by the grant below — the limit bounds how fast
    // an unauthorized caller can probe, the grant decides whether they get anything.
    // Generous, because a real shopper legitimately calls this several times walking
    // through contact/shipping/billing/delivery, plus edits.
    const ip = getClientIp(request.headers);
    const key = `checkout-patch:ip:${ip}`;
    const limit = await isRateLimited({ key, limit: 60, windowMs: 10 * 60 * 1000 });
    if (limit.limited) return rateLimitedResponse(limit.retryAfterSeconds);
    await recordAttempt(key);

    const { checkoutId } = await params;

    /**
     * The id alone is no longer authority (SEC-001).
     *
     * This endpoint returns the whole checkout — email, phone, shipping and billing
     * address — and can overwrite the delivery address on it. Holding the id used to be
     * enough for both. The grant cookie is set when the checkout is created, so the browser
     * that started it is unaffected and nothing about the client flow changes.
     *
     * 404, not 403: a checkout somebody may not touch should be indistinguishable from one
     * that does not exist, or the response becomes an oracle confirming which ids are real.
     */
    if (!(await canAccessCheckout(checkoutId))) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Checkout not found." } },
        { status: 404 }
      );
    }

    const body = await request.json();

    // Validate every provided field up front, before applying any of them — otherwise
    // a bad billingAddress could leave an already-applied, good email update in place,
    // an inconsistent partial-write the caller has no way to detect from the response.
    if (body.email !== undefined) {
      const result = contactSchema.shape.email.safeParse(body.email);
      if (!result.success) return invalidInputResponse(result.error.issues[0]?.message ?? "Invalid email.");
    }
    if (body.shippingAddress !== undefined) {
      const result = addressSchema.safeParse(body.shippingAddress);
      if (!result.success) return invalidInputResponse(result.error.issues[0]?.message ?? "Invalid shipping address.");
    }
    if (body.billingAddress !== undefined) {
      const result = addressSchema.safeParse(body.billingAddress);
      if (!result.success) return invalidInputResponse(result.error.issues[0]?.message ?? "Invalid billing address.");
    }

    let checkout: Checkout | undefined;

    if (typeof body.email === "string") checkout = await updateEmail(checkoutId, body.email);
    if (body.shippingAddress) checkout = await updateShippingAddress(checkoutId, body.shippingAddress);
    if (body.billingAddress) checkout = await updateBillingAddress(checkoutId, body.billingAddress);
    if (typeof body.shippingRateId === "string") checkout = await setShippingRate(checkoutId, body.shippingRateId);
    /**
     * `giftWrap` is deliberately no longer accepted here.
     *
     * The checkbox came out of ShippingMethodStep when the merchant retired the service, but
     * this route kept taking the field, so "nothing sets giftWrap any more" was only ever true
     * of the UI. A checkout could still be handed a fee that no screen could take back off, and
     * checkouts created before the removal are still carrying one.
     *
     * `setGiftWrap` and the columns behind it stay, for the reasons ShippingMethodStep gives:
     * historical orders must keep rendering, and December is a UI change rather than a rebuild.
     * What is gone is the last live path that could switch it on.
     */
    // Stored as a preference only — services/checkout.ts re-validates it against the
    // live configuration at order time, so writing it here grants nothing.
    // Free text, so length and trimming are enforced in the service, never trusted from here.
    if (typeof body.customerNote === "string") checkout = await setCustomerNote(checkoutId, body.customerNote);
    if (typeof body.paymentMethodId === "string") checkout = await setPaymentMethod(checkoutId, body.paymentMethodId);

    if (!checkout) return invalidInputResponse("Body must include at least one of email, shippingAddress, billingAddress, shippingRateId, customerNote, paymentMethodId.");
    return NextResponse.json({ checkout });
  } catch (error) {
    return commerceErrorResponse(error);
  }
}
