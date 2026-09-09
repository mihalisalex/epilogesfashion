import type { Metadata } from "next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { CartPageContent } from "@/components/cart/CartPageContent";
import { getNavigation, getSiteSettings } from "@/services";
import { getShippingRates } from "@/services/shipping";
import { getTranslations } from "next-intl/server";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Cart");
  return { title: t("yourBag"), robots: { index: false, follow: false } };
}

export default async function CartPage() {
  const [navigation, settings, rates] = await Promise.all([getNavigation(), getSiteSettings(), getShippingRates()]);

  /**
   * Read off the rates rather than from the settings directly, and as `Money` rather than a
   * bare number — the same shape `ProductAccordion` uses for the same figure.
   *
   * `buildShippingRates` folds the threshold onto each rate it applies to, so a rate carrying
   * one is the only proof that free shipping is switched on at all: turn it off and no rate has
   * a `freeOverAmount`, this is null, and the cart simply stops promising anything.
   */
  const freeShippingRate = rates.find((rate) => rate.freeOverAmount != null);
  const freeShippingThreshold =
    freeShippingRate?.freeOverAmount != null
      ? { amount: freeShippingRate.freeOverAmount, currencyCode: freeShippingRate.price.currencyCode }
      : null;

  return (
    <>
      <Header
        navigation={navigation}
        siteName={settings.siteName}
        announcementMessages={settings.announcementMessages}
      />
      <main id="main" className="flex-1 pt-header">
        <CartPageContent freeShippingThreshold={freeShippingThreshold} />
      </main>
      <Footer navigation={navigation} settings={settings} />
    </>
  );
}
