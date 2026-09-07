"use client";
import { useTranslations } from "next-intl";

import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight } from "lucide-react";
import { contactAndAddressSchema, type ContactAndAddressFormValues } from "@/lib/validation/checkout";
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
    resolver: zodResolver(contactAndAddressSchema),
    defaultValues: {
      email,
      ...(shippingAddress ?? {
        firstName: "",
        lastName: "",
        company: "",
        address1: "",
        address2: "",
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
    if (!next || next === email || !contactAndAddressSchema.shape.email.safeParse(next).success) return;
    void setEmail(next).catch((error) => console.error("Failed to save checkout email", error));
  };

  const onSubmit = async (values: ContactAndAddressFormValues) => {
    const { email: submittedEmail, ...address } = values;
    // Ordered, not parallel: the address submit is what advances the step, so the email must
    // already be stored when it does.
    if (submittedEmail.trim() !== email) await setEmail(submittedEmail.trim());
    await setShippingAddress(address);
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

      <div>
        <label htmlFor="address2" className="mb-1.5 block text-eyebrow">
          {tAddr("apartment")}
        </label>
        <input id="address2" autoComplete="address-line2" className={inputClass} {...register("address2")} />
      </div>

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
