import { useTranslations } from "next-intl";
import { formatMoney } from "@/lib/format";
import type { CartTotals } from "@/lib/commerce/types";

interface CartTotalsSummaryProps {
  totals: CartTotals;
  /**
   * Marks the shipping figure as an estimate rather than a decision.
   *
   * Opt-in, because this component is shared by the cart page, the cart drawer AND checkout's
   * own `OrderSummary`. In the cart nothing has been chosen yet, so the amount shown is
   * whichever rate the store lists first — which stopped being a safe assumption the day store
   * pickup was added, since that one is free. By checkout the shopper has picked, so the same
   * caveat there would be false.
   *
   * The line is NOT removed and the total still includes it: a "Σύνολο" that omits delivery is
   * not the amount anyone pays, and finding that out at the payment step is the single most
   * common reason a basket is abandoned. Better an estimate that says so than a total that is
   * quietly wrong.
   */
  shippingEstimated?: boolean;
}

export function CartTotalsSummary({ totals, shippingEstimated = false }: CartTotalsSummaryProps) {
  const t = useTranslations("Cart");
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
      <div>
        <div className="flex justify-between">
          <span className="text-luxe-gray-dark">{t("shipping")}</span>
          <span>{totals.shippingTotal.amount === 0 ? t("free") : formatMoney(totals.shippingTotal)}</span>
        </div>
        {shippingEstimated ? (
          <p className="mt-0.5 text-xs text-luxe-gray-dark">{t("shippingEstimateNote")}</p>
        ) : null}
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
        <span>{formatMoney(totals.total)}</span>
      </div>
      {/* Below the total, not above it: VAT is contained in these prices, not added to
          them, and a tax row sitting between the fee and the total reads as a surcharge. */}
      <div className="flex justify-between text-xs text-luxe-gray-dark">
        <span>{t("estimatedTax")}</span>
        <span>{formatMoney(totals.taxTotal)}</span>
      </div>
    </div>
  );
}
