"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCheckout } from "@/components/providers/CheckoutProvider";

/**
 * Gift wrapping is no longer offered, at the merchant's request, so the checkbox and its
 * message box are gone from this step.
 *
 * The machinery behind it deliberately is NOT: `Checkout.giftWrap`, `Order.giftWrap`,
 * `giftMessage` and `giftWrapTotal` all remain. Two reasons. Orders already placed with
 * wrapping have to keep rendering correctly in the admin and in their own confirmation
 * emails, and ripping the field out would break exactly the historical records that are
 * hardest to reconstruct. And a shoe shop plausibly wants this back in December — with the
 * plumbing intact that is a UI change, whereas removing it now would make it a rebuild.
 *
 * Nothing sets `giftWrap` any more, so it stays `false` and `giftWrapTotal` stays zero on
 * every new order.
 */
export function ShippingMethodStep() {
  const t = useTranslations("Checkout");
  const { shippingRates, selectedRateId, selectShippingRate } = useCheckout();
  const [selected, setSelected] = useState<string | null>(selectedRateId ?? shippingRates[0]?.id ?? null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const onSubmit = async () => {
    if (!selected) return;
    setIsSubmitting(true);
    try {
      await selectShippingRate(selected);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (shippingRates.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="font-heading text-xl">{t("deliveryTitle")}</h2>
          <p className="mt-1 text-sm text-luxe-gray-dark">{t("enterAddressForRates")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-xl">{t("deliveryTitle")}</h2>
        <p className="mt-1 text-sm text-luxe-gray-dark">{t("deliverySubtitle")}</p>
      </div>

      <div role="radiogroup" aria-label={t("shippingMethodLabel")} className="divide-y divide-border border-y border-border">
        {shippingRates.map((rate) => {
          const isSelected = selected === rate.id;
          return (
            <button
              key={rate.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => setSelected(rate.id)}
              className="flex w-full items-center justify-between gap-4 px-1 py-4 text-left"
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-full border",
                    isSelected ? "border-luxe-black" : "border-border"
                  )}
                >
                  {isSelected ? <span className="size-2 rounded-full bg-luxe-black" /> : null}
                </span>
                <span>
                  <span className="block text-sm font-medium">{rate.label}</span>
                  <span className="block text-xs text-luxe-gray-dark">{rate.description}</span>
                </span>
              </div>
              <span className="shrink-0 text-sm">{formatMoney(rate.price)}</span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onSubmit}
        disabled={!selected || isSubmitting}
        className="flex h-12 w-full items-center justify-center gap-2 bg-luxe-black text-sm font-medium tracking-[0.08em] text-luxe-white uppercase transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {t("continueToPayment")}
        <ArrowRight className="size-4" strokeWidth={1.5} />
      </button>
    </div>
  );
}
