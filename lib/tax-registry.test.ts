import { describe, expect, it } from "vitest";
import { buildEnvelopeForTest, parseAadeResponse, TaxRegistryError } from "@/lib/tax-registry";

/**
 * Envelopes shaped exactly as AADE's published XSD declares
 * (https://www1.gsis.gr/wsaade/RgWsPublic2/RgWsPublic2?xsd=1), including the namespace
 * prefixes JAX-WS emits, because stripping the prefix is half of what the parser does.
 *
 * These are constructed from the schema rather than captured from a live call, so what they pin
 * is the parsing. The request half is pinned separately at the bottom of this file — and had to
 * be, because that is the half that broke.
 */
function envelope(inner: string): string {
  return `<?xml version='1.0' encoding='UTF-8'?>
<S:Envelope xmlns:S="http://www.w3.org/2003/05/soap-envelope">
  <S:Body>
    <ns2:rgWsPublic2AfmMethodResponse xmlns:ns2="http://rgwspublic2/RgWsPublic2Service" xmlns:ns3="http://rgwspublic2/RgWsPublic2">
      <ns2:result>
        <ns3:rg_ws_public2_result_rtType>
          ${inner}
        </ns3:rg_ws_public2_result_rtType>
      </ns2:result>
    </ns2:rgWsPublic2AfmMethodResponse>
  </S:Body>
</S:Envelope>`;
}

const BASIC_REC = `
  <ns3:error_rec>
    <ns3:error_code xsi:nil="true" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>
    <ns3:error_descr xsi:nil="true" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>
  </ns3:error_rec>
  <ns3:basic_rec>
    <ns3:afm>094014201</ns3:afm>
    <ns3:doy>1159</ns3:doy>
    <ns3:doy_descr>ΦΑΕ ΑΘΗΝΩΝ</ns3:doy_descr>
    <ns3:deactivation_flag>1</ns3:deactivation_flag>
    <ns3:deactivation_flag_descr>ΕΝΕΡΓΟΣ ΑΦΜ</ns3:deactivation_flag_descr>
    <ns3:firm_flag_descr>ΕΠΙΤΗΔΕΥΜΑΤΙΑΣ</ns3:firm_flag_descr>
    <ns3:onomasia>ΠΑΡΑΔΕΙΓΜΑ ΑΝΩΝΥΜΗ ΕΤΑΙΡΕΙΑ</ns3:onomasia>
    <ns3:commer_title>ΠΑΡΑΔΕΙΓΜΑ Α.Ε.</ns3:commer_title>
    <ns3:postal_address>ΕΒΑΝΣ</ns3:postal_address>
    <ns3:postal_zip_code>71201</ns3:postal_zip_code>
  </ns3:basic_rec>
  <ns3:firm_act_tab>
    <ns3:item>
      <ns3:firm_act_code>47721000</ns3:firm_act_code>
      <ns3:firm_act_descr>ΛΙΑΝΙΚΟ ΕΜΠΟΡΙΟ ΥΠΟΔΗΜΑΤΩΝ</ns3:firm_act_descr>
      <ns3:firm_act_kind>1</ns3:firm_act_kind>
      <ns3:firm_act_kind_descr>ΚΥΡΙΑ</ns3:firm_act_kind_descr>
    </ns3:item>
    <ns3:item>
      <ns3:firm_act_code>46421200</ns3:firm_act_code>
      <ns3:firm_act_descr>ΧΟΝΔΡΙΚΟ ΕΜΠΟΡΙΟ ΥΠΟΔΗΜΑΤΩΝ</ns3:firm_act_descr>
      <ns3:firm_act_kind>2</ns3:firm_act_kind>
      <ns3:firm_act_kind_descr>ΔΕΥΤΕΡΕΥΟΥΣΑ</ns3:firm_act_kind_descr>
    </ns3:item>
  </ns3:firm_act_tab>`;

describe("parseAadeResponse", () => {
  it("reads the fields the invoice form fills", () => {
    const record = parseAadeResponse(envelope(BASIC_REC));
    expect(record).toEqual({
      vatNumber: "094014201",
      companyName: "ΠΑΡΑΔΕΙΓΜΑ Α.Ε.",
      taxOffice: "ΦΑΕ ΑΘΗΝΩΝ",
      activity: "ΛΙΑΝΙΚΟ ΕΜΠΟΡΙΟ ΥΠΟΔΗΜΑΤΩΝ",
      active: true,
    });
  });

  it("picks the main activity rather than whichever is listed first", () => {
    const secondaryFirst = BASIC_REC.replace(
      /<ns3:firm_act_tab>[\s\S]*<\/ns3:firm_act_tab>/,
      `<ns3:firm_act_tab>
        <ns3:item>
          <ns3:firm_act_descr>ΧΟΝΔΡΙΚΟ ΕΜΠΟΡΙΟ</ns3:firm_act_descr>
          <ns3:firm_act_kind>2</ns3:firm_act_kind>
          <ns3:firm_act_kind_descr>ΔΕΥΤΕΡΕΥΟΥΣΑ</ns3:firm_act_kind_descr>
        </ns3:item>
        <ns3:item>
          <ns3:firm_act_descr>ΛΙΑΝΙΚΟ ΕΜΠΟΡΙΟ</ns3:firm_act_descr>
          <ns3:firm_act_kind>1</ns3:firm_act_kind>
          <ns3:firm_act_kind_descr>ΚΥΡΙΑ</ns3:firm_act_kind_descr>
        </ns3:item>
      </ns3:firm_act_tab>`
    );
    expect(parseAadeResponse(envelope(secondaryFirst))?.activity).toBe("ΛΙΑΝΙΚΟ ΕΜΠΟΡΙΟ");
  });

  it("falls back to the legal name when there is no trading name", () => {
    const noTradingName = BASIC_REC.replace(
      "<ns3:commer_title>ΠΑΡΑΔΕΙΓΜΑ Α.Ε.</ns3:commer_title>",
      '<ns3:commer_title xsi:nil="true" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>'
    );
    expect(parseAadeResponse(envelope(noTradingName))?.companyName).toBe("ΠΑΡΑΔΕΙΓΜΑ ΑΝΩΝΥΜΗ ΕΤΑΙΡΕΙΑ");
  });

  it("reports a deactivated ΑΦΜ as inactive without hiding the rest of the record", () => {
    const deactivated = BASIC_REC.replace(
      "<ns3:deactivation_flag>1</ns3:deactivation_flag>",
      "<ns3:deactivation_flag>2</ns3:deactivation_flag>"
    );
    const record = parseAadeResponse(envelope(deactivated));
    expect(record?.active).toBe(false);
    expect(record?.companyName).toBe("ΠΑΡΑΔΕΙΓΜΑ Α.Ε.");
  });

  /**
   * The guard described in `interpretActive`: an unrecognised flag must read as "no opinion",
   * never as inactive, or a future AADE flag value would start rejecting real businesses.
   */
  it("says nothing about a status flag it does not recognise", () => {
    const unknownFlag = BASIC_REC.replace(
      "<ns3:deactivation_flag>1</ns3:deactivation_flag>",
      "<ns3:deactivation_flag>7</ns3:deactivation_flag>"
    );
    expect(parseAadeResponse(envelope(unknownFlag))?.active).toBeNull();
  });

  it("treats an unknown ΑΦΜ as not found rather than as a failure", () => {
    const notFound = `
      <ns3:error_rec>
        <ns3:error_code>RG_WS_PUBLIC_WRONG_AFM</ns3:error_code>
        <ns3:error_descr>ΑΦΜ δεν βρέθηκε</ns3:error_descr>
      </ns3:error_rec>`;
    expect(parseAadeResponse(envelope(notFound))).toBeNull();
  });

  it("raises other AADE errors so they are not mistaken for an empty registry", () => {
    const denied = `
      <ns3:error_rec>
        <ns3:error_code>RG_WS_PUBLIC_TOKEN_USERNAME_NOT_AUTHENTICATED</ns3:error_code>
        <ns3:error_descr>Λάθος στοιχεία πιστοποίησης</ns3:error_descr>
      </ns3:error_rec>`;
    expect(() => parseAadeResponse(envelope(denied))).toThrow(TaxRegistryError);
    expect(() => parseAadeResponse(envelope(denied))).toThrow("Λάθος στοιχεία πιστοποίησης");
  });

  it("decodes escaped characters in a company name", () => {
    const ampersand = BASIC_REC.replace(
      "<ns3:commer_title>ΠΑΡΑΔΕΙΓΜΑ Α.Ε.</ns3:commer_title>",
      "<ns3:commer_title>ΑΛΦΑ &amp; ΒΗΤΑ</ns3:commer_title>"
    );
    expect(parseAadeResponse(envelope(ampersand))?.companyName).toBe("ΑΛΦΑ & ΒΗΤΑ");
  });
});

/**
 * The envelope, pinned.
 *
 * These exist because the parsing was tested and the REQUEST was not, and it was the request
 * that failed in production: an empty `<as_on_date/>` made AADE's parser throw a
 * NullPointerException on every call. A schema says what is allowed; only the live service
 * says what its parser survives.
 */
describe("buildEnvelope", () => {
  const envelope = () => buildEnvelopeForTest("094014201", "user", "pass", "");

  it("never sends an empty optional element", () => {
    const xml = envelope();
    // The exact shape that produced "SOAPMessage request format error".
    expect(xml).not.toContain("as_on_date");
    expect(xml).not.toContain("<pub:afm_called_by></pub:afm_called_by>");
    expect(xml).not.toMatch(/<pub:\w+\/>/);
  });

  it("sends afm_called_by only when the shop configured one", () => {
    expect(envelope()).not.toContain("afm_called_by");
    expect(buildEnvelopeForTest("094014201", "user", "pass", "123456789")).toContain(
      "<pub:afm_called_by>123456789</pub:afm_called_by>"
    );
  });

  it("puts INPUT_REC and its children in the two namespaces the WSDL declares", () => {
    const xml = envelope();
    expect(xml).toContain('xmlns:srv="http://rgwspublic2/RgWsPublic2Service"');
    expect(xml).toContain('xmlns:pub="http://rgwspublic2/RgWsPublic2"');
    expect(xml).toContain("<srv:INPUT_REC>");
    expect(xml).toContain("<pub:afm_called_for>094014201</pub:afm_called_for>");
  });

  it("escapes credentials rather than letting them break the envelope", () => {
    const xml = buildEnvelopeForTest("094014201", "a&b", "p<w>", "");
    expect(xml).toContain("<wsse:Username>a&amp;b</wsse:Username>");
    expect(xml).toContain("<wsse:Password>p&lt;w&gt;</wsse:Password>");
  });
});
