import "server-only";
import { CourierError, type CourierProvider, type CreateShipmentInput, type CreateShipmentResult } from "@/lib/courier/types";
import { ACS_CARRIER_NAME, buildTrackingUrl } from "@/lib/courier/tracking-url";

const ACS_BASE_URL = "https://webservices.acscourier.net/ACSRestServices/api/ACSAutoRest";

/**
 * REL-001. Tighter than the Stripe ceiling because nothing a shopper is waiting on depends
 * on it — a voucher is created after the order exists, so failing fast here delays a label,
 * not a purchase.
 */
const ACS_TIMEOUT_MS = 10_000;

export interface AcsCredentials {
  apiKey: string;
  companyId: string;
  companyPassword: string;
  userId: string;
  userPassword: string;
  billingCode: string;
}

/**
 * Real ACS Courier REST API integration — `ACSAlias`/`ACSInputParameters` envelope,
 * `AcsApiKey` header, `ACS_Create_Voucher` method.
 *
 * ## Checked against ACS's published spec on 2026-09-07, and the result is lopsided
 *
 * Fetched from `https://webservices.acscourier.net/ACSRestServices/swagger/docs/v1` — the
 * Swagger UI at `/swagger/` cannot load its own spec (CORS), so go to that URL directly.
 *
 * **The request side is now verified**, not inferred. The endpoint, the envelope, the
 * `AcsApiKey` header and every field sent below appear in ACS's own documented example for
 * `ACS_Create_Voucher`, including `Billing_Code`, which belongs in the per-call parameters
 * rather than being global auth.
 *
 * **The response side cannot be verified from the spec at all, and this is worth stating
 * plainly because it is easy to believe otherwise.** The document declares
 * `"responses": {"200": {}}` for every operation and its `"definitions"` object is empty —
 * so ACS publishes no response schema whatsoever. Names that circulate for the envelope
 * (`ACSOutputResponse`, `ACSExecution_HasError`, `ACSValueOutput`) appear **nowhere** in it;
 * they were suggested by a summariser reading the same file and did not survive being
 * grepped for. Narrowing the parsing below to those names would replace one guess with a
 * more confident-looking guess.
 *
 * So the defensive multi-key read is deliberate, not laziness, and it stays until someone
 * runs a voucher against a real account. **This has still never been exercised against a
 * live ACS account.** When it first is: place one test voucher, read the raw body the error
 * path prints, and replace the candidate list below with what ACS actually returned.
 *
 * Two documented input fields are deliberately not sent. `Language` is in the parameter
 * list but every published example leaves it null and no value set is given, so it is
 * omitted rather than guessed. `Recipient_Email` would have ACS mail the customer tracking
 * updates directly — a real feature, and a decision about customer communication rather
 * than a field to quietly switch on; it also needs `CreateShipmentInput` to carry the email.
 */
export function createAcsCourierProvider(creds: AcsCredentials): CourierProvider {
  async function call(alias: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await fetch(ACS_BASE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          AcsApiKey: creds.apiKey,
        },
        body: JSON.stringify({
          ACSAlias: alias,
          ACSInputParameters: {
            Company_ID: creds.companyId,
            Company_Password: creds.companyPassword,
            User_ID: creds.userId,
            User_Password: creds.userPassword,
            Billing_Code: creds.billingCode,
            ...params,
          },
        }),
        signal: AbortSignal.timeout(ACS_TIMEOUT_MS),
      });
    } catch (error) {
      /**
       * REL-001. Unlike the Stripe path there is no idempotency key here, so a timed-out
       * `ACS_Create_Voucher` may have produced a voucher we never saw the number for. That
       * is the safer direction to fail in — a duplicate voucher costs a courier label, a
       * hung request costs the whole checkout invocation — but it does mean a timeout wants
       * a human to check ACS before retrying, which is what the message says.
       */
      if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new CourierError(
          `ACS did not respond within ${ACS_TIMEOUT_MS}ms (${alias}). The request may still have been processed — check the ACS portal before retrying.`
        );
      }
      throw new CourierError(
        `ACS request failed (${alias}): ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const text = await res.text();
    if (!res.ok) {
      throw new CourierError(`ACS API returned ${res.status}: ${text.slice(0, 500)}`);
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new CourierError(`ACS API returned a non-JSON response: ${text.slice(0, 500)}`);
    }
    return body as Record<string, unknown>;
  }

  return {
    async createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
      const { address, recipientName, weightGrams, itemQuantity } = input;
      const body = await call("ACS_Create_Voucher", {
        Pickup_Date: new Date().toISOString().slice(0, 10),
        Recipient_Name: recipientName,
        Recipient_Address: [address.address1, address.address2].filter(Boolean).join(", "),
        Recipient_Zipcode: address.postalCode,
        Recipient_Region: address.region || address.city,
        Recipient_Phone: address.phone ?? "",
        Recipient_Cell_Phone: address.phone ?? "",
        Recipient_Country: address.countryCode,
        Charge_Type: 2,
        Item_Quantity: itemQuantity,
        Weight: Math.max(0.1, weightGrams / 1000),
        /**
         * Our own order id, carried into ACS's records.
         *
         * `Reference_Key1` is in ACS's documented `ACS_Create_Voucher` parameter list and we
         * were not sending it, despite already holding the value. It is what makes
         * `ACS_POD_FROM_REFERENCE_NO` — proof of delivery looked up by reference — usable at
         * all, and it is the only field that lets a voucher in the ACS portal be traced back
         * to an order in this shop without going through the tracking number.
         *
         * Free to send now, impossible to add retroactively: a voucher created without it
         * cannot be re-keyed later.
         */
        Reference_Key1: input.orderId,
      });

      // ACS wraps results in an output array under a key that varies by account/API
      // version in the sources available at build time — check the documented
      // candidates before giving up, and surface the raw body on failure so a real
      // integrator can see the actual shape from their own account.
      const output = (body.ACSOutputResponce ?? body.ACSOutputResponse ?? body.Data ?? body.data) as
        | Array<Record<string, unknown>>
        | undefined;
      const first = Array.isArray(output) ? output[0] : undefined;
      const trackingNumber = (first?.Voucher_No ?? first?.voucher_No ?? body.Voucher_No) as string | number | undefined;

      if (!trackingNumber) {
        throw new CourierError(`ACS_Create_Voucher succeeded but no voucher number was found in the response: ${JSON.stringify(body).slice(0, 500)}`);
      }

      return {
        trackingNumber: String(trackingNumber),
        carrier: ACS_CARRIER_NAME,
        trackingUrl: buildTrackingUrl(ACS_CARRIER_NAME) ?? "https://www.acscourier.net/en/track-and-trace",
      };
    },
  };
}
