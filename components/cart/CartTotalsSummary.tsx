import { useTranslations } from "next-intl";
import { formatMoney } from "@/lib/format";
import { vatIncludedIn } from "@/lib/shipping";
import { round2 } from "@/lib/money";
import type { CartTotals } from "@/lib/commerce/types";

interface CartTotalsSummaryProps {
  totals: CartTotals;
  /**
   * Shows no shipping figure at all, because none is knowable yet.
   *
   * Opt-in, because this component is shared by the cart page, the cart drawer AND checkout's
   * own `OrderSummary`. In the cart nothing has been chosen; by checkout the shopper has picked
   * a method and given an address, so there the amount is real and is shown.
   *
   * What makes it genuinely unknowable rather than merely unchosen: the price depends on the
   * delivery method — store pickup is free — and, for home delivery, on whether the postal code
   * is one of ACS's 488 remote ones at 4,95 rather than 2,95. Any single number printed here
   * would be wrong for a large share of shoppers.
   *
   * The total drops shipping too. Showing "Μεταφορικά —" while the total still contained it
   * would leave `59 € + nothing = 61,95 €` on screen, which discloses the hidden figure and
   * looks like an arithmetic error besides.
   */
  shippingEstimated?: boolean;
}

export function CartTotalsSummary({ totals, shippingEstimated = false }: CartTotalsSummaryProps) {
  const t = useTranslations("Cart");

  /**
   * With no shipping figure shown, the total must not contain one either — otherwise
   * `59 € + nothing = 61,95 €` and the arithmetic gives away the number being withheld.
   *
   * Subtraction of two amounts already on `totals`, not a re-derivation of the price: the
   * server still decides what shipping costs, and this only declines to show a component it
   * has just said is unknown. VAT follows the same subtraction because `vatIncludedIn` is
   * linear, so the tax line keeps describing the figure printed above it rather than a larger
   * one.
   */
  const displayTotal = shippingEstimated ? round2(totals.total.amount - totals.shippingTotal.amount) : totals.total.amount;
  const displayTax = shippingEstimated
    ? round2(totals.taxTotal.amount - vatIncludedIn(totals.shippingTotal.amount))
    : totals.taxTotal.amount;
  return (
    <div className="space-y-2 text-sm">
      <div className="flex justify-between">
        <span className="text-luxe-gray-dark">{t("subtotal")}</span>
        <span>{formatMoney(totals.subtotal)}</span>
      </div>
      {totals.discountTotal.amount > 0 ? (
        <div className="flex justify-between">
          <span className="text-luxe-gray-dark">{t("discount")}</span>
          <span>-{formatMoney(totals.discountTotal)}</span>
        </div>
      ) : null}
      {totals.giftCardTotal.amount > 0 ? (
        <div className="flex justify-between">
          <span className="text-luxe-gray-dark">{t("giftCard")}</span>
          <span>-{formatMoney(totals.giftCardTotal)}</span>
        </div>
      ) : null}
      <div className="flex justify-between">
        <span className="text-luxe-gray-dark">{t("shipping")}</span>
        {/*
          No figure at all before a destination is known — the amount is replaced by the words,
          rather than shown with a caveat under it.

          A price here was never something the shop could stand behind: it depends on whether
          the shopper collects from the store, and on whether their postal code is one of ACS's
          488 remote ones. Showing 2,95 € and hoping is how someone reaches the payment step and
          finds a different number.
        */}
        <span className={shippingEstimated ? "text-luxe-gray-dark" : undefined}>
          {shippingEstimated
            ? t("shippingCalculatedAtCheckout")
            : totals.shippingTotal.amount === 0
              ? t("free")
              : formatMoney(totals.shippingTotal)}
        </span>
      </div>
      {totals.giftWrapTotal.amount > 0 ? (
        <div className="flex justify-between">
          <span className="text-luxe-gray-dark">{t("giftWrapping")}</span>
          <span>{formatMoney(totals.giftWrapTotal)}</span>
        </div>
      ) : null}
      {totals.paymentFeeTotal.amount > 0 ? (
        <div className="flex justify-between">
          <span className="text-luxe-gray-dark">{t("paymentFee")}</span>
          <span>{formatMoney(totals.paymentFeeTotal)}</span>
        </div>
      ) : null}
      <div className="flex justify-between border-t border-border pt-2 text-base font-medium">
        <span>{t("total")}</span>
        <span>{formatMoney({ ...totals.total, amount: displayTotal })}</span>
      </div>
      {/* Below the total, not above it: VAT is contained in these prices, not added to
          them, and a tax row sitting between the fee and the total reads as a surcharge. */}
      <div className="flex justify-between text-xs text-luxe-gray-dark">
        <span>{t("estimatedTax")}</span>
        <span>{formatMoney({ ...totals.taxTotal, amount: displayTax })}</span>
      </div>
      {shippingEstimated ? (
        <p className="pt-1 text-xs text-luxe-gray-dark">{t("shippingAddedAtCheckout")}</p>
      ) : null}
    </div>
  );
}
