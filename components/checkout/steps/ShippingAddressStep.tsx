"use client";
import { useTranslations } from "next-intl";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight } from "lucide-react";
import { buildContactAndAddressSchema, buildInvoiceSchema, type ContactAndAddressFormValues, type InvoiceDetails } from "@/lib/validation/checkout";
import { isValidGreekVatNumber, normaliseGreekVatNumber } from "@/lib/greek-vat";
import { COUNTRIES, DEFAULT_COUNTRY_CODE } from "@/constants/countries";
import { useCheckout } from "@/components/providers/CheckoutProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { AddressAutocompleteInput } from "@/components/checkout/AddressAutocompleteInput";
import { cn } from "@/lib/utils";

const inputClass =
  "h-11 w-full border border-border bg-transparent px-3 text-sm outline-none focus:border-luxe-black aria-invalid:border-destructive";

export function ShippingAddressStep() {
  const t = useTranslations("Checkout");
  const tAddr = useTranslations("Address");
  /**
   * The validation messages, in the shopper's language. `useTranslations` returns exactly the
   * resolver signature the schema factories take, so this is the whole wiring.
   *
   * Memoised because a new schema object on every render would give `zodResolver` a new
   * identity each time and re-run validation for no reason.
   */
  const tValidation = useTranslations("Validation");
  const schema = useMemo(() => buildContactAndAddressSchema(tValidation), [tValidation]);
  const invoiceValidator = useMemo(() => buildInvoiceSchema(tValidation), [tValidation]);
  const { email, setEmail, shippingAddress, setShippingAddress } = useCheckout();
  const { customer, isLoading: isAuthLoading } = useAuth();
  const {
    register,
    handleSubmit,
    setValue,
    control,
    reset,
    getValues,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ContactAndAddressFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      email,
      ...(shippingAddress ?? {
        firstName: "",
        lastName: "",
        company: "",
        address1: "",
        city: "",
        region: "",
        postalCode: "",
        countryCode: DEFAULT_COUNTRY_CODE,
        phone: "",
      }),
    },
  });

  // Prefill from the signed-in customer — their email, and their default address. Guest
  // checkout stays blank. Skipped once the checkout session already holds the value, or once
  // the shopper has started typing, so this never clobbers in-progress or confirmed input.
  useEffect(() => {
    if (isAuthLoading || !customer || isDirty) return;
    const defaultAddress = customer.addresses.find((a) => a.id === customer.defaultAddressId) ?? customer.addresses[0];
    const nextEmail = email || customer.email || "";
    if (shippingAddress && !nextEmail) return;
    reset({ ...(shippingAddress ?? defaultAddress ?? getValues()), email: nextEmail });
  }, [customer, isAuthLoading, email, shippingAddress, isDirty, reset, getValues]);

  /**
   * Save the email as soon as the shopper leaves the field, not only when the whole form is
   * submitted.
   *
   * This is what makes merging the old contact step into this one safe. While email had a step
   * of its own it was persisted before the address was even shown, so anyone who gave up
   * partway through the address was still reachable by the abandoned-cart cron — which resolves
   * its recipient from `checkouts[].email`. Waiting for submit would have silently ended that
   * for exactly the shoppers worth recovering: the ones who left without finishing.
   *
   * Guarded on a real change and a valid-looking value so a tab-through does not fire a write,
   * and `void`-ed with a catch because a failed bookkeeping write must never block someone from
   * completing their order.
   */
  const persistEmailOnBlur = (value: string) => {
    const next = value.trim();
    if (!next || next === email || !schema.shape.email.safeParse(next).success) return;
    void setEmail(next).catch((error) => console.error("Failed to save checkout email", error));
  };

  /**
   * The invoice fields sit outside react-hook-form and are validated by hand on submit.
   *
   * Deliberate rather than lazy. `invoice` is optional in the schema, but RHF would still hold
   * the four inputs as empty strings whether or not the box is ticked, so the resolver would
   * have to be taught to ignore them conditionally — and getting that subtly wrong means either
   * blocking every ordinary receipt order or letting a half-filled invoice through. Parsing the
   * object only when it is wanted keeps the address form exactly as it was.
   */
  const [wantsInvoice, setWantsInvoice] = useState(Boolean(shippingAddress?.invoice));
  const [invoice, setInvoice] = useState<Record<string, string>>({
    companyName: shippingAddress?.invoice?.companyName ?? "",
    vatNumber: shippingAddress?.invoice?.vatNumber ?? "",
    taxOffice: shippingAddress?.invoice?.taxOffice ?? "",
    activity: shippingAddress?.invoice?.activity ?? "",
  });
  const [invoiceErrors, setInvoiceErrors] = useState<Record<string, string>>({});

  /**
   * Autofilling Επωνυμία, ΔΟΥ and δραστηριότητα from the ΑΦΜ, via AADE's company registry.
   *
   * Three rules, all of them about not taking the form away from the person filling it in:
   *
   *   - It never blocks. Every failure — service down, no credentials configured, ΑΦΜ not in
   *     the registry — leaves the fields exactly as they were and the shopper types them. The
   *     submit path does not consult this at all.
   *   - It only writes into a field that is empty or that it filled itself. Correcting an
   *     autofilled ΔΟΥ and then fixing a typo in the ΑΦΜ must not silently undo the
   *     correction, so `autofilled` tracks what is still ours to overwrite.
   *   - It fires on blur, not per keystroke, and only once the checksum passes. That is what
   *     keeps a shopper to one call: nine digits are not a valid ΑΦΜ until they are all there.
   */
  const [vatLookup, setVatLookup] = useState<"loading" | "found" | "inactive" | "not_found" | null>(null);
  const [autofilled, setAutofilled] = useState<Set<string>>(new Set());
  const lastLookedUp = useRef<string | null>(null);
  // Set once the endpoint says the shop has no AADE credentials, so we stop asking it.
  const registryUnavailable = useRef(false);

  const lookupVat = useCallback(
    async (raw: string) => {
      const vatNumber = normaliseGreekVatNumber(raw);
      if (registryUnavailable.current || !isValidGreekVatNumber(vatNumber)) return;
      // Tabbing back out of an unchanged field should not spend another AADE call.
      if (lastLookedUp.current === vatNumber) return;
      lastLookedUp.current = vatNumber;

      setVatLookup("loading");
      let data: { status?: string; companyName?: string; taxOffice?: string; activity?: string; active?: boolean | null };
      try {
        const res = await fetch("/api/vat-lookup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vatNumber }),
        });
        data = await res.json();
      } catch {
        // Offline or blocked. Say nothing and let them type — a network error under the ΑΦΜ
        // field would read as "your VAT number is wrong", which it is not.
        setVatLookup(null);
        return;
      }

      if (data.status === "unavailable") {
        registryUnavailable.current = true;
        setVatLookup(null);
        return;
      }
      if (data.status !== "found") {
        setVatLookup("not_found");
        return;
      }

      const incoming: Record<string, string> = {
        companyName: data.companyName ?? "",
        taxOffice: data.taxOffice ?? "",
        activity: data.activity ?? "",
      };
      const filled = new Set(autofilled);
      setInvoice((prev) => {
        const next = { ...prev };
        for (const [field, value] of Object.entries(incoming)) {
          if (!value) continue;
          const isOursToWrite = !prev[field]?.trim() || autofilled.has(field);
          if (!isOursToWrite) continue;
          next[field] = value;
          filled.add(field);
        }
        return next;
      });
      setAutofilled(filled);
      // Clear any stale "required" errors on the fields we just filled.
      setInvoiceErrors((prev) => {
        const next = { ...prev };
        for (const field of filled) delete next[field];
        return next;
      });
      /**
       * `active === false` is shown as a warning and nothing more. The registry says this ΑΦΜ
       * is deactivated, which usually means the shopper mistyped a digit into another real
       * business — but `interpretActive` is explicit that these flag values are the unverified
       * part of the integration, and a wrong reading would refuse a real customer's invoice.
       * Warn, fill the fields anyway, let them submit.
       */
      setVatLookup(data.active === false ? "inactive" : "found");
    },
    [autofilled]
  );

  const onSubmit = async (values: ContactAndAddressFormValues) => {
    const { email: submittedEmail, ...address } = values;

    let invoiceDetails: InvoiceDetails | undefined;
    if (wantsInvoice) {
      const parsed = invoiceValidator.safeParse(invoice);
      if (!parsed.success) {
        // Shown against the individual fields rather than as one message: "check your invoice
        // details" tells someone nothing about which of four is wrong.
        setInvoiceErrors(
          Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]))
        );
        return;
      }
      setInvoiceErrors({});
      invoiceDetails = parsed.data;
    }

    // Ordered, not parallel: the address submit is what advances the step, so the email must
    // already be stored when it does.
    if (submittedEmail.trim() !== email) await setEmail(submittedEmail.trim());
    await setShippingAddress({ ...address, ...(invoiceDetails ? { invoice: invoiceDetails } : {}) });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
      <div>
        <h2 className="font-heading text-xl">{t("contactTitle")}</h2>
        <p className="mt-1 text-sm text-luxe-gray-dark">{t("contactSubtitle")}</p>
      </div>

      <div>
        <label htmlFor="checkout-email" className="mb-1.5 block text-eyebrow">
          {t("emailAddress")}
        </label>
        <input
          id="checkout-email"
          type="email"
          autoComplete="email"
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? "checkout-email-error" : undefined}
          className={inputClass}
          {...register("email", { onBlur: (event) => persistEmailOnBlur(event.target.value) })}
        />
        {errors.email ? (
          <p id="checkout-email-error" className="mt-1.5 text-xs text-destructive">
            {errors.email.message}
          </p>
        ) : null}
      </div>

      <div className="border-t border-border pt-6">
        <h2 className="font-heading text-xl">{t("shippingAddressTitle")}</h2>
        <p className="mt-1 text-sm text-luxe-gray-dark">{t("shippingAddressSubtitle")}</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="firstName" className="mb-1.5 block text-eyebrow">
            {tAddr("firstName")}
          </label>
          <input
            id="firstName"
            autoComplete="given-name"
            aria-invalid={Boolean(errors.firstName)}
            aria-describedby={errors.firstName ? "firstName-error" : undefined}
            className={inputClass}
            {...register("firstName")}
          />
          {errors.firstName ? (
            <p id="firstName-error" className="mt-1.5 text-xs text-destructive">
              {errors.firstName.message}
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor="lastName" className="mb-1.5 block text-eyebrow">
            {tAddr("lastName")}
          </label>
          <input
            id="lastName"
            autoComplete="family-name"
            aria-invalid={Boolean(errors.lastName)}
            aria-describedby={errors.lastName ? "lastName-error" : undefined}
            className={inputClass}
            {...register("lastName")}
          />
          {errors.lastName ? (
            <p id="lastName-error" className="mt-1.5 text-xs text-destructive">
              {errors.lastName.message}
            </p>
          ) : null}
        </div>
      </div>

      <div>
        <label htmlFor="company" className="mb-1.5 block text-eyebrow">
          {tAddr("company")}
        </label>
        <input id="company" autoComplete="organization" className={inputClass} {...register("company")} />
      </div>

      <Controller
        name="address1"
        control={control}
        render={({ field }) => (
          <AddressAutocompleteInput
            id="address1"
            label={tAddr("streetAddress")}
            value={field.value}
            onChange={field.onChange}
            error={errors.address1?.message}
            onSelect={(suggestion) => {
              setValue("address1", suggestion.address1, { shouldValidate: true });
              setValue("city", suggestion.city, { shouldValidate: true });
              setValue("region", suggestion.region, { shouldValidate: true });
              setValue("postalCode", suggestion.postalCode, { shouldValidate: true });
              setValue("countryCode", suggestion.countryCode, { shouldValidate: true });
            }}
          />
        )}
      />

      {/*
        No apartment/floor field. The merchant removed it as unused, and on a Greek address it
        was mostly noise: the street line already carries the number, and the courier gets a
        phone number to ring for anything finer.

        `address2` itself stays optional in the schemas and keeps rendering wherever a stored
        address is shown, because orders already placed have one and the standing rule holds —
        tightening what the form ACCEPTS must never invalidate what the shop already WROTE.
      */}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="city" className="mb-1.5 block text-eyebrow">
            {tAddr("city")}
          </label>
          <input
            id="city"
            autoComplete="address-level2"
            aria-invalid={Boolean(errors.city)}
            aria-describedby={errors.city ? "city-error" : undefined}
            className={inputClass}
            {...register("city")}
          />
          {errors.city ? (
            <p id="city-error" className="mt-1.5 text-xs text-destructive">
              {errors.city.message}
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor="region" className="mb-1.5 block text-eyebrow">
            {tAddr("region")}
          </label>
          <input id="region" autoComplete="address-level1" className={inputClass} {...register("region")} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="postalCode" className="mb-1.5 block text-eyebrow">
            {tAddr("postalCode")}
          </label>
          <input
            id="postalCode"
            autoComplete="postal-code"
            aria-invalid={Boolean(errors.postalCode)}
            aria-describedby={errors.postalCode ? "postalCode-error" : undefined}
            className={inputClass}
            {...register("postalCode")}
          />
          {errors.postalCode ? (
            <p id="postalCode-error" className="mt-1.5 text-xs text-destructive">
              {errors.postalCode.message}
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor="countryCode" className="mb-1.5 block text-eyebrow">
            {tAddr("country")}
          </label>
          <select
            id="countryCode"
            autoComplete="country"
            aria-invalid={Boolean(errors.countryCode)}
            className={cn(inputClass, "appearance-none")}
            {...register("countryCode")}
          >
            {COUNTRIES.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="phone" className="mb-1.5 block text-eyebrow">
          {tAddr("phone")}
        </label>
        <input
          id="phone"
          type="tel"
          autoComplete="tel"
          aria-invalid={Boolean(errors.phone)}
          aria-describedby={errors.phone ? "phone-error" : "phone-hint"}
          className={inputClass}
          {...register("phone")}
        />
        {errors.phone ? (
          <p id="phone-error" className="mt-1.5 text-xs text-destructive">
            {errors.phone.message}
          </p>
        ) : (
          <p id="phone-hint" className="mt-1.5 text-xs text-luxe-gray-dark">
            {tAddr("phoneHelp")}
          </p>
        )}
      </div>

      {/*
        Τιμολόγιο, collapsed behind a checkbox.

        Almost every order is a receipt, so the four business fields stay out of the way until
        someone says they need them — and a shopper who does need one is looking for exactly
        this word and will find it. Expanding in place rather than on a step of its own keeps
        it where the rest of the buyer's details are.
      */}
      <div className="border-t border-border pt-6">
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={wantsInvoice}
            onChange={(event) => {
              setWantsInvoice(event.target.checked);
              if (!event.target.checked) setInvoiceErrors({});
            }}
            className="size-4 accent-luxe-black"
          />
          <span>{t("invoiceToggle")}</span>
        </label>

        {wantsInvoice ? (
          <div className="mt-4 space-y-4">
            {/*
              ΑΦΜ first, because it is now the field that fills the other three. The order
              on screen is the order of work: type the number, watch Επωνυμία, ΔΟΥ and
              δραστηριότητα arrive, correct anything that is wrong.
            */}
            {(
              [
                ["vatNumber", t("invoiceVatNumber"), true],
                ["companyName", t("invoiceCompanyName"), true],
                ["taxOffice", t("invoiceTaxOffice"), true],
                ["activity", t("invoiceActivity"), false],
              ] as const
            ).map(([field, label, required]) => (
              <div key={field}>
                <label htmlFor={`invoice-${field}`} className="mb-1.5 block text-eyebrow">
                  {label}
                  {required ? "" : ` (${tAddr("optional")})`}
                </label>
                <input
                  id={`invoice-${field}`}
                  value={invoice[field] ?? ""}
                  onChange={(event) => {
                    setInvoice((prev) => ({ ...prev, [field]: event.target.value }));
                    // Typing over an autofilled value takes ownership of it, so a later
                    // lookup will not overwrite what this person just decided to correct.
                    if (field !== "vatNumber") {
                      setAutofilled((prev) => {
                        if (!prev.has(field)) return prev;
                        const next = new Set(prev);
                        next.delete(field);
                        return next;
                      });
                    }
                  }}
                  onBlur={field === "vatNumber" ? () => void lookupVat(invoice.vatNumber ?? "") : undefined}
                  aria-invalid={Boolean(invoiceErrors[field])}
                  className={inputClass}
                />
                {field === "vatNumber" && vatLookup ? (
                  <p
                    className={cn(
                      "mt-1.5 text-xs",
                      vatLookup === "inactive" ? "text-destructive" : "text-luxe-gray-dark"
                    )}
                  >
                    {t(
                      vatLookup === "loading"
                        ? "invoiceLookupLoading"
                        : vatLookup === "found"
                          ? "invoiceLookupFound"
                          : vatLookup === "inactive"
                            ? "invoiceLookupInactive"
                            : "invoiceLookupNotFound"
                    )}
                  </p>
                ) : null}
                {invoiceErrors[field] ? (
                  <p className="mt-1.5 text-xs text-destructive">{invoiceErrors[field]}</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="flex h-12 w-full items-center justify-center gap-2 bg-luxe-black text-sm font-medium tracking-[0.08em] text-luxe-white uppercase transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {t("continueToDelivery")}
        <ArrowRight className="size-4" strokeWidth={1.5} />
      </button>
    </form>
  );
}
