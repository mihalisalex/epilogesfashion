"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import { contactSchema, type ContactFormValues } from "@/lib/validation/checkout";
import { useCheckout } from "@/components/providers/CheckoutProvider";
import { useAuth } from "@/components/providers/AuthProvider";

export function ContactStep() {
  const t = useTranslations("Checkout");
  const { email, setEmail } = useCheckout();
  const { customer, isLoading: isAuthLoading } = useAuth();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ContactFormValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: { email },
  });

  /**
   * Prefill the signed-in customer's own email — guest checkout stays blank.
   *
   * `ShippingAddressStep` has done exactly this with the default address since it was
   * written, which made the omission here an inconsistency rather than a gap: the shop
   * already knew who the shopper was, filled in their street address two steps later, and
   * still asked them to type the address it mails their receipt to.
   *
   * Same guards as the address prefill, and for the same reasons: skipped once the checkout
   * session already carries an email, and once the shopper has started typing, so it can
   * never clobber in-progress input or a deliberate choice to order under a different
   * address from the account one.
   */
  useEffect(() => {
    if (email || isAuthLoading || !customer || isDirty) return;
    if (customer.email) reset({ email: customer.email });
  }, [customer, isAuthLoading, email, isDirty, reset]);

  const onSubmit = async (values: ContactFormValues) => {
    await setEmail(values.email);
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
          className="h-11 w-full border border-border bg-transparent px-3 text-sm outline-none focus:border-luxe-black aria-invalid:border-destructive"
          {...register("email")}
        />
        {errors.email ? (
          <p id="checkout-email-error" className="mt-1.5 text-xs text-destructive">
            {errors.email.message}
          </p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="flex h-12 w-full items-center justify-center gap-2 bg-luxe-black text-sm font-medium tracking-[0.08em] text-luxe-white uppercase transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {t("continueToShipping")}
        <ArrowRight className="size-4" strokeWidth={1.5} />
      </button>
    </form>
  );
}
