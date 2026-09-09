import { z } from "zod";
import { isValidGreekVatNumber, normaliseGreekVatNumber } from "@/lib/greek-vat";
import { isSupportedCountryCode } from "@/constants/countries";

/**
 * Validation messages, resolved by key rather than written inline.
 *
 * A Greek shop was showing "First name is required" under a field labelled ΟΝΟΜΑ, because
 * these strings lived in the schema and the schema is shared by client forms and API routes.
 *
 * So each schema is a factory taking a message resolver, and the bare exports below call it
 * with `defaultMessages`. That keeps the split honest in both directions:
 *
 *   - A form passes `useTranslations("Validation")`, which has exactly this signature, and the
 *     shopper reads errors in the language the rest of the page is in.
 *   - An API route keeps the English defaults. A JSON error body is read by developers and
 *     logs, not by a shopper — the route has already been through a client form that said the
 *     same thing in Greek — and a server-side `getTranslations` call per request would buy
 *     nothing for that audience.
 *
 * A missing key falls back to the key itself rather than throwing, so a half-translated
 * catalogue degrades to an ugly message instead of a broken checkout.
 */
export type ValidationMessages = (key: string) => string;

const DEFAULT_MESSAGES: Record<string, string> = {
  emailRequired: "Email is required",
  emailInvalid: "Enter a valid email address",
  firstNameRequired: "First name is required",
  lastNameRequired: "Last name is required",
  address1Required: "Enter a street address",
  cityRequired: "City is required",
  postalCodeInvalid: "Enter a valid postal code",
  countryRequired: "Select a country",
  countryUnsupported: "We don't ship to that country yet",
  phoneRequired: "Phone number is required so the courier can reach you",
  phoneInvalid: "Enter a valid phone number",
  phoneCharacters: "Phone number can only contain digits, spaces and + ( ) - . /",
  invoiceCompanyRequired: "Company name is required",
  invoiceVatInvalid: "That VAT number is not valid",
  invoiceTaxOfficeRequired: "Tax office is required",
};

export const defaultMessages: ValidationMessages = (key) => DEFAULT_MESSAGES[key] ?? key;

export const buildContactSchema = (t: ValidationMessages = defaultMessages) =>
  z.object({
    email: z.string().trim().min(1, t("emailRequired")).email(t("emailInvalid")),
  });
export const contactSchema = buildContactSchema();
export type ContactFormValues = z.infer<typeof contactSchema>;

/**
 * Τιμολόγιο — the details a Greek business needs on a tax invoice rather than a receipt.
 *
 * Present only when the shopper asked for one; absent means a receipt, which is what almost
 * every order is. It rides along inside the address JSON rather than in columns of its own,
 * and that is a deployment decision as much as a modelling one: `Checkout.shippingAddress` and
 * `Order.shippingAddress` are already `Json`, and this shop applies migrations BY HAND — a new
 * column would mean the feature ships one manual step after the deploy that needs it, or
 * breaks until someone runs it.
 *
 * `companyName` is separate from the address's own optional `company` on purpose. That field is
 * a delivery convenience ("leave it at reception at Acme"); this one is the legal επωνυμία the
 * invoice is issued to, and the two are not reliably the same string.
 */
export const buildInvoiceSchema = (t: ValidationMessages = defaultMessages) =>
  z.object({
    companyName: z.string().trim().min(1, t("invoiceCompanyRequired")),
    vatNumber: z
      .string()
      .trim()
      .transform(normaliseGreekVatNumber)
      .refine(isValidGreekVatNumber, t("invoiceVatInvalid")),
    taxOffice: z.string().trim().min(1, t("invoiceTaxOfficeRequired")),
    activity: z.string().trim().optional(),
  });
export const invoiceSchema = buildInvoiceSchema();
export type InvoiceDetails = z.infer<typeof invoiceSchema>;

/**
 * The stored form is deliberately looser: it validates nothing about the ΑΦΜ.
 *
 * Same rule the phone field learned the hard way — tightening what the app ACCEPTS must never
 * retroactively invalidate what it already WROTE. An invoice recorded before a rule changed is
 * a fact about a sale that happened, and the admin has to be able to read it.
 */
const storedInvoiceSchema = z.object({
  companyName: z.string(),
  vatNumber: z.string(),
  taxOffice: z.string(),
  activity: z.string().optional(),
});

/**
 * The fields that never changed their rules, shared by both schemas below.
 */
const addressBase = (t: ValidationMessages) => ({
  firstName: z.string().trim().min(1, t("firstNameRequired")),
  lastName: z.string().trim().min(1, t("lastNameRequired")),
  company: z.string().trim().optional(),
  address1: z.string().trim().min(3, t("address1Required")),
  address2: z.string().trim().optional(),
  city: z.string().trim().min(1, t("cityRequired")),
  region: z.string().trim().optional(),
  postalCode: z.string().trim().min(2, t("postalCodeInvalid")),
});

/**
 * For addresses ALREADY PERSISTED — order snapshots, saved customer addresses, checkout
 * rows written before the rules tightened.
 *
 * This split is not cosmetic. `addressSchema` does double duty as an input validator and
 * as the parser for stored JSON (`toOrder`, `toCheckout`, `completeCheckout`), so making
 * `phone` required immediately broke every order placed while it was optional: the admin
 * dashboard and orders list both 500'd on a ZodError the moment they tried to read one.
 * Tightening what the app ACCEPTS must never retroactively invalidate what it already
 * WROTE — historical records are facts, not submissions, and cannot be corrected by the
 * person now reading them.
 *
 * Not parameterised by messages, and that is the point: nothing here is shown to anyone
 * filling in a form. A failure to parse a stored address is a bug report, not a prompt.
 */
export const storedAddressSchema = z.object({
  ...addressBase(defaultMessages),
  countryCode: z.string().trim().min(2),
  phone: z.string().trim().optional(),
  invoice: storedInvoiceSchema.optional(),
});
export type StoredAddress = z.infer<typeof storedAddressSchema>;

/** The strict INPUT schema: what a form or API request must supply today. */
export const buildAddressSchema = (t: ValidationMessages = defaultMessages) =>
  z.object({
    ...addressBase(t),
    // Checked against the list the shop actually ships to, not just "at least two
    // characters" — the previous rule accepted any string, so a crafted request could
    // put an arbitrary value on the order and every downstream country-based rule
    // (payment-method availability, future shipping zones) would silently not match it.
    countryCode: z
      .string({ error: t("countryRequired") })
      .trim()
      .transform((value) => value.toUpperCase())
      .refine(isSupportedCountryCode, t("countryUnsupported")),
    // Required, not optional. Every order this shop can currently take is Cash on
    // Delivery, and a courier delivering to a Greek address needs a number to call. It
    // was optional and format-free, so an order could reach the courier with no way to
    // contact the customer. Kept deliberately loose on format: real numbers arrive with
    // spaces, dashes, brackets and an optional +country prefix, and rejecting a valid
    // number is worse than accepting a slightly odd one.
    // The `error` argument covers the MISSING-key case as well as a wrong type. Without
    // it an omitted phone surfaced Zod's own "expected string, received undefined" to the
    // shopper — a type error dressed up as a validation message.
    phone: z
      .string({ error: t("phoneRequired") })
      .trim()
      .min(1, t("phoneRequired"))
      .refine((value) => (value.match(/\d/g)?.length ?? 0) >= 8, t("phoneInvalid"))
      .refine((value) => /^[+\d][\d\s()./-]*$/.test(value), t("phoneCharacters")),
    // Optional because a receipt is the default and almost every order. Present only when the
    // shopper ticked "τιμολόγιο", and then fully validated — a half-filled invoice is worse than
    // none, since it looks like a tax document and is not one.
    invoice: buildInvoiceSchema(t).optional(),
  });
export const addressSchema = buildAddressSchema();
export type AddressFormValues = z.infer<typeof addressSchema>;

/**
 * Email and delivery address as one form — the merged first checkout step.
 *
 * Composed from the two schemas rather than restating the email rule, so the field cannot
 * drift from `contactSchema`, which still validates it on its own wherever email is collected
 * outside checkout.
 */
export const buildContactAndAddressSchema = (t: ValidationMessages = defaultMessages) =>
  buildAddressSchema(t).extend({
    email: buildContactSchema(t).shape.email,
  });
export const contactAndAddressSchema = buildContactAndAddressSchema();
export type ContactAndAddressFormValues = z.infer<typeof contactAndAddressSchema>;

/*
 * `cardSchema` (cardName / cardNumber / expiry / cvc) used to live here, backing a
 * demo card form on the payment step. It has been REMOVED deliberately, not
 * misplaced: this application must never accept a card number or a CVV, because
 * doing so pulls it into PCI scope and makes its own logs and error reports a
 * liability. Card data is collected on the payment processor's own page — see
 * lib/payments/providers/stripe.ts — and the only thing that comes back is a token
 * and a status. If a future integration appears to need a card field here, that is
 * a sign the integration is being wired up wrongly.
 */
