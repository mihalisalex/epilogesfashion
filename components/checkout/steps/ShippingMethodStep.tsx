"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCheckout } from "@/components/providers/CheckoutProvider";
import { useCart } from "@/components/providers/CartProvider";
import { shippingChargeForRate } from "@/lib/commerce/checkout-totals";

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
  /**
   * `Cart.free` rather than a new `Checkout.free`. The string already exists and
   * `CartTotalsSummary` already renders a zero shipping total through it, so duplicating it
   * into a second namespace would give the same word two places to be edited and one to be
   * forgotten. Reading one key from another namespace is already the pattern here —
   * `ShippingAddressStep` does it with `Address`.
   */
  const tCart = useTranslations("Cart");
  const { shippingRates, selectedRateId, selectShippingRate } = useCheckout();
  const { cart } = useCart();
  /**
   * Defaults to the first rate the destination can actually use, not simply the first.
   *
   * With a non-Greek address `shippingRates[0]` is home delivery, which is disabled — so
   * preselecting it left the step with nothing selectable highlighted and the continue button
   * submitting a rate the server would refuse.
   */
  const firstAvailable = shippingRates.find((rate) => rate.available !== false);
  const [selected, setSelected] = useState<string | null>(selectedRateId ?? firstAvailable?.id ?? null);
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
          /**
           * Options that do not apply to this address are shown, greyed and unselectable,
           * rather than removed. A Greek shopper should not have to wonder whether collection
           * from the store exists, and someone in Portugal is better told that home delivery
           * is Greece-only than left to assume the shop simply has one option.
           *
           * The disabling is a courtesy, not the control. `resolveShippingRate` refuses these
           * server-side, so a crafted request cannot buy a Greek rate to a Portuguese address.
           */
          const isAvailable = rate.available !== false;
          const isSelected = isAvailable && selected === rate.id;
          const charge = cart ? shippingChargeForRate(cart.totals, rate) : rate.price.amount;
          return (
            <button
              key={rate.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={!isAvailable}
              onClick={() => isAvailable && setSelected(rate.id)}
              className={cn(
                "flex w-full items-center justify-between gap-4 px-1 py-4 text-left",
                !isAvailable && "cursor-not-allowed opacity-40"
              )}
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
              {/*
                What this rate actually costs THIS basket, not its list price, and rendered as
                "Δωρεάν" rather than "0 €" to match what `CartTotalsSummary` already does.
                Covers both ways a delivery option can be free: store pickup, which costs
                nothing outright, and a rate whose free-shipping threshold this basket has
                cleared. The second used to be wrong here — a 113,90 EUR basket against a
                100 EUR threshold read "Δωρεάν" in the cart and "4,95 €" one screen later.
              */}
              <span className="shrink-0 text-sm">
                {charge === 0 ? tCart("free") : formatMoney({ amount: charge, currencyCode: rate.price.currencyCode })}
              </span>
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
