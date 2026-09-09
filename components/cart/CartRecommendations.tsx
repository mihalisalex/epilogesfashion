"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getCommerceProvider } from "@/lib/commerce";
import { useCart } from "@/components/providers/CartProvider";
import { ProductCard } from "@/components/product/ProductCard";
import type { Product } from "@/types";

export function CartRecommendations() {
  const t = useTranslations("Cart");
  const { cart } = useCart();
  const [recommendations, setRecommendations] = useState<Product[]>([]);

  const cartId = cart?.id;
  const lineItemCount = cart?.lineItems.length ?? 0;

  // Refetches recommendations (or clears them) whenever the bag's contents change —
  // an unavoidable direct setState either way.
  useEffect(() => {
    if (!cartId || lineItemCount === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRecommendations([]);
      return;
    }
    getCommerceProvider().cart.getRecommendations(cartId, 4).then(setRecommendations);
  }, [cartId, lineItemCount]);

  if (recommendations.length === 0) return null;

  /**
   * `mt-8 pt-8` rather than the `mt-16 pt-10` this used to carry.
   *
   * That was 104px of whitespace sitting directly between the checkout button and the first
   * product image — on a phone, the single largest thing keeping the recommendations off
   * screen, more than the summary's padding and gaps put together. The border still reads as a
   * separator; it just no longer costs a third of the visible peek to draw one.
   */
  return (
    <section className="mt-8 border-t border-border pt-8">
      <h2 className="font-heading text-2xl">{t("youMightAlsoLike")}</h2>
      <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-4">
        {recommendations.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  );
}
