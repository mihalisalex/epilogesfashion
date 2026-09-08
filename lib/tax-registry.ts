import "server-only";

/**
 * AADE's public company-registry lookup (RgWsPublic2) — turns an ΑΦΜ into the business
 * details an invoice has to carry.
 *
 * ## Why this exists
 *
 * `isValidGreekVatNumber` can only reject the arithmetically impossible. It cannot say the
 * number is registered, still active, or belongs to the company the shopper typed above it.
 * This can, and it fills in ΔΟΥ and δραστηριότητα — two fields most people have to go and
 * look up, and the two most likely to be wrong when typed from memory.
 *
 * ## What was verified, and when
 *
 * Checked against the live WSDL and XSD on 2026-09-08:
 *   - WSDL: https://www1.gsis.gr/wsaade/RgWsPublic2/RgWsPublic2?WSDL
 *   - XSD:  https://www1.gsis.gr/wsaade/RgWsPublic2/RgWsPublic2?xsd=1
 *
 * Both the request AND the response shapes below come from that schema, which is the
 * important difference from the ACS provider next door: ACS publishes no response schema at
 * all, so its parsing is a defensive guess pending a live call. Here every element name
 * (`basic_rec`, `onomasia`, `doy_descr`, `firm_act_tab`, `error_rec`) is declared in AADE's
 * own XSD. The service is SOAP 1.2, document/literal, operation `rgWsPublic2AfmMethod`.
 *
 * **The request shape HAS now been exercised against the live service** (2026-09-08), and the
 * first version was wrong in a way no schema reading would have caught — see `buildEnvelope`.
 * Reading a published schema tells you what is ALLOWED, not what the server's parser survives.
 *
 * What remains unverified is the VALUES of two flag fields — see `interpretActive` below,
 * which is why nothing here blocks a checkout on them.
 *
 * ## Credentials
 *
 * Special-purpose web-service credentials issued by AADE, distinct from TAXISnet login. Every
 * call is logged by AADE against the calling account, which is the main reason the route in
 * front of this is rate limited hard: abuse is attributable to this shop.
 */

const AADE_ENDPOINT = "https://www1.gsis.gr/wsaade/RgWsPublic2/RgWsPublic2";
const AADE_SOAP_ACTION = "http://rgwspublic2/RgWsPublic2Service:rgWsPublic2AfmMethod";
const SERVICE_NS = "http://rgwspublic2/RgWsPublic2Service";
const TYPES_NS = "http://rgwspublic2/RgWsPublic2";
const WSSE_NS = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd";

/**
 * Shorter than the courier's 10s. A shopper is sitting in front of this one with a half-filled
 * form, whereas a voucher is created after the order already exists. Six seconds is long
 * enough for a government SOAP service on a good day and short enough that a bad day reads as
 * "type it yourself" rather than a hang.
 */
const AADE_TIMEOUT_MS = 6_000;

export interface TaxRegistryRecord {
  vatNumber: string;
  /** Trading name where the business has one, otherwise the legal name. */
  companyName: string;
  taxOffice: string;
  /** The main ΚΑΔ description, empty when the registry lists none. */
  activity: string;
  /** `null` when the registry's flag was not one of the values we recognise — see below. */
  active: boolean | null;
}

export class TaxRegistryError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "TaxRegistryError";
    this.code = code;
  }
}

export function isTaxRegistryConfigured(): boolean {
  return Boolean(process.env.AADE_WS_USERNAME && process.env.AADE_WS_PASSWORD);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    // Last, so that an escaped entity in the source ("&amp;lt;") does not get double-decoded.
    .replace(/&amp;/g, "&");
}

/**
 * Reads one leaf element's text, ignoring whatever namespace prefix the server chose.
 *
 * A regex rather than a parser because the project has no XML dependency and this response is
 * a flat record of string leaves — every field consumed here is declared `xsd:string` in the
 * XSD, so there is no nesting to get wrong. Self-closing elements yield "" rather than null,
 * which is what a nillable-and-absent field should mean to a caller filling in a form.
 */
function tagText(xml: string, name: string): string {
  const selfClosing = new RegExp(`<(?:[\\w.-]+:)?${name}\\b[^>]*/>`).test(xml);
  if (selfClosing) return "";
  const match = new RegExp(`<(?:[\\w.-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>`).exec(xml);
  return match ? decodeXml(match[1].trim()) : "";
}

/**
 * The main activity out of `firm_act_tab`, which lists every ΚΑΔ a business is registered for.
 *
 * Tries the description first ("ΚΥΡΙΑ") and the numeric kind second, because those are two
 * different conventions for the same fact and only one of them is self-describing. Falls back
 * to the first entry: a business with activities listed but none marked main is better served
 * by a real one it can correct than by an empty field.
 */
function mainActivity(xml: string): string {
  const items = xml.match(/<(?:[\w.-]+:)?item\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?item>/g) ?? [];
  if (items.length === 0) return "";
  const byDescr = items.find((item) => tagText(item, "firm_act_kind_descr").includes("ΚΥΡΙΑ"));
  const byKind = items.find((item) => tagText(item, "firm_act_kind") === "1");
  return tagText(byDescr ?? byKind ?? items[0]!, "firm_act_descr");
}

/**
 * Whether the ΑΦΜ is currently active — and deliberately three-valued.
 *
 * `deactivation_flag` is documented in the XSD as a string but its VALUE SET is not published
 * anywhere in the schema. "1 = active, 2 = inactive" is the convention every third-party client
 * uses and is very probably right, but "probably" is not good enough to refuse someone's
 * invoice on, so an unrecognised value returns `null` and the caller treats it as "no opinion"
 * rather than as inactive. The failure this avoids: AADE adds a third flag value, and a Greek
 * shop starts silently rejecting valid businesses at checkout.
 */
function interpretActive(flag: string): boolean | null {
  if (flag === "1") return true;
  if (flag === "2") return false;
  return null;
}

/**
 * Builds the request envelope.
 *
 * ## An optional element you do not need is OMITTED, never sent empty
 *
 * This cost a production outage of the feature, so it is worth being explicit. The first
 * version sent `<pub:as_on_date/>` — a self-closing empty element for an `xsd:date` that the
 * shop has no value for. AADE's JAX-WS stack does not treat that as absent; it tries to parse
 * "" as a date and dies, and every single call came back:
 *
 *     HTTP 500 — SOAPMessage request format error - java.lang.NullPointerException
 *
 * Isolated by probing the live service with deliberately wrong credentials, which is a cheap
 * test anyone can repeat: a malformed envelope returns that format error, while a well-formed
 * one returns `RG_WS_PUBLIC_TOKEN_USERNAME_NOT_AUTHENTICATED`. Getting the authentication
 * error is therefore PROOF the shape is right, and needs no real credentials to obtain.
 *
 * Both `afm_called_by` and `as_on_date` are `minOccurs="0"` in the XSD, so leaving them out
 * entirely is what "we have no value" is spelled as. `as_on_date` is never sent — the shop
 * always wants the register as it stands today. `afm_called_by` is sent only when configured.
 */
function buildEnvelope(vatNumber: string, username: string, password: string, calledBy: string): string {
  const calledByElement = calledBy ? `\n        <pub:afm_called_by>${escapeXml(calledBy)}</pub:afm_called_by>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope">
  <env:Header>
    <wsse:Security xmlns:wsse="${WSSE_NS}">
      <wsse:UsernameToken>
        <wsse:Username>${escapeXml(username)}</wsse:Username>
        <wsse:Password>${escapeXml(password)}</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </env:Header>
  <env:Body>
    <srv:rgWsPublic2AfmMethod xmlns:srv="${SERVICE_NS}" xmlns:pub="${TYPES_NS}">
      <srv:INPUT_REC>${calledByElement}
        <pub:afm_called_for>${escapeXml(vatNumber)}</pub:afm_called_for>
      </srv:INPUT_REC>
    </srv:rgWsPublic2AfmMethod>
  </env:Body>
</env:Envelope>`;
}

/** Exported for its regression test — the shape is the half that broke in production. */
export const buildEnvelopeForTest = buildEnvelope;

/**
 * Parses a `rgWsPublic2AfmMethodResponse` body.
 *
 * Exported for its test: this is the only part of the integration that can be exercised
 * without credentials, so it is the part that gets pinned.
 */
export function parseAadeResponse(xml: string): TaxRegistryRecord | null {
  const errorCode = tagText(xml, "error_code");
  if (errorCode) {
    /**
     * An unknown or never-registered ΑΦΜ comes back as an application error, not an empty
     * record, and it is not a failure of ours — the shopper simply mistyped. It is reported as
     * "not found" so the form can say so quietly instead of showing a service error.
     */
    if (errorCode === "RG_WS_PUBLIC_WRONG_AFM" || errorCode === "RG_WS_PUBLIC_AFM_CALLED_BY_NOT_FOUND") {
      return null;
    }
    throw new TaxRegistryError(tagText(xml, "error_descr") || `AADE returned ${errorCode}`, errorCode);
  }

  const afm = tagText(xml, "afm");
  if (!afm) return null;

  const legalName = tagText(xml, "onomasia");
  const tradingName = tagText(xml, "commer_title");
  return {
    vatNumber: afm,
    companyName: tradingName || legalName,
    taxOffice: tagText(xml, "doy_descr"),
    activity: mainActivity(xml),
    active: interpretActive(tagText(xml, "deactivation_flag")),
  };
}

/**
 * Looks up one ΑΦΜ. Returns `null` when the registry has no such number.
 *
 * Throws `TaxRegistryError` for anything else — transport, credentials, AADE being down. The
 * caller's job is to swallow that and leave the shopper typing by hand, never to fail a
 * checkout because a government web service had a bad afternoon.
 */
export async function lookupGreekVatNumber(vatNumber: string): Promise<TaxRegistryRecord | null> {
  const username = process.env.AADE_WS_USERNAME;
  const password = process.env.AADE_WS_PASSWORD;
  if (!username || !password) {
    throw new TaxRegistryError("AADE_WS_USERNAME / AADE_WS_PASSWORD are not set.");
  }

  let res: Response;
  try {
    res = await fetch(AADE_ENDPOINT, {
      method: "POST",
      headers: {
        // SOAP 1.2 carries the action as a Content-Type parameter, not a SOAPAction header.
        "Content-Type": `application/soap+xml;charset=UTF-8;action="${AADE_SOAP_ACTION}"`,
      },
      body: buildEnvelope(vatNumber, username, password, process.env.AADE_WS_CALLED_BY_VAT ?? ""),
      signal: AbortSignal.timeout(AADE_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new TaxRegistryError(`AADE did not respond within ${AADE_TIMEOUT_MS}ms.`);
    }
    throw new TaxRegistryError(`AADE request failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const text = await res.text();
  // A SOAP fault arrives with a 500, and its body says more than the status does.
  if (!res.ok) {
    const faultReason = tagText(text, "Text") || tagText(text, "faultstring");
    throw new TaxRegistryError(faultReason || `AADE returned ${res.status}.`);
  }
  return parseAadeResponse(text);
}
