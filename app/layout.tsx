import type { Metadata } from "next";
import { Suspense } from "react";
import { Nunito_Sans, Quicksand } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { JsonLd } from "@/components/shared/JsonLd";
import { organizationSchema, websiteSchema } from "@/lib/seo";
import { getSeoDefaultsCached, getSiteSettings } from "@/services";
import { TikTokLiveModal } from "@/components/shared/TikTokLiveModal";
import { ToastProvider } from "@/components/providers/ToastProvider";
import { AuthProvider } from "@/components/providers/AuthProvider";
import { CartProvider } from "@/components/providers/CartProvider";
import { WishlistProvider } from "@/components/providers/WishlistProvider";
import { CategoryNamesProvider } from "@/components/providers/CategoryNamesProvider";
import { localizeCategory } from "@/lib/localize";
import { getAllCategoriesCached } from "@/services";
import type { Locale } from "@/i18n/config";
import { ToastViewport } from "@/components/shared/ToastViewport";
import { CookieConsentBanner } from "@/components/shared/CookieConsentBanner";
import { Analytics } from "@/components/shared/Analytics";
import { ReferralCapture } from "@/components/shared/ReferralCapture";
import { CartDrawer } from "@/components/cart/CartDrawer";
import { getShippingRatesCached } from "@/services/shipping";
import "./globals.css";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

const nunitoSans = Nunito_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  display: "swap",
});

const quicksand = Quicksand({
  variable: "--font-heading",
  subsets: ["latin"],
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const seo = await getSeoDefaultsCached();

  return {
    metadataBase: new URL(seo.siteUrl),
    title: {
      template: seo.titleTemplate,
      default: seo.defaultTitle,
    },
    description: seo.defaultDescription,
    applicationName: seo.organization.name,
    openGraph: {
      type: "website",
      siteName: seo.organization.name,
      // No `images` here on purpose. Declaring one overrides Next's file-based convention,
      // and app/opengraph-image.tsx already renders a branded 1200x630 card from the live
      // site name and tagline. Setting a default image is what turns the generated one OFF
      // — which is the opposite of how the field reads (QA-028).
      ...(seo.defaultOgImage ? { images: [{ url: seo.defaultOgImage, width: 1200, height: 630 }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      creator: seo.twitterHandle,
    },
    icons: {
      icon: "/icon.svg",
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const seo = await getSeoDefaultsCached();
  const settings = await getSiteSettings();
  const locale = await getLocale();
  const messages = await getMessages();

  /**
   * slug -> localised name, for every client component that only ever has a product's bare
   * category slug (see CategoryNamesProvider). One query per page render, the same cost
   * `getSeoDefaults` above already pays every time — the categories table is small.
   */
  const categories = await getAllCategoriesCached();
  /**
   * The free-shipping threshold for the cart drawer, which the layout renders on every page.
   * Read from the cross-request cache, so this is not a database round trip per page view —
   * see getShippingRatesCached.
   */
  const shippingRates = await getShippingRatesCached();
  const freeShippingRate = shippingRates.find((rate) => rate.freeOverAmount != null);
  const freeShippingThreshold =
    freeShippingRate?.freeOverAmount != null
      ? { amount: freeShippingRate.freeOverAmount, currencyCode: freeShippingRate.price.currencyCode }
      : null;
  const categoryNames = Object.fromEntries(
    categories.map((category) => [category.slug, localizeCategory(category, locale as Locale).name])
  );

  return (
    <html
      lang={locale}
      className={`${nunitoSans.variable} ${quicksand.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Runs before first paint, so a visitor who has already answered the cookie banner
            never sees it flash. The banner itself is server-rendered (see
            CookieConsentBanner) because it sits in the viewport and was otherwise the
            homepage's LCP element, painting only after hydration. Reading localStorage is
            the one thing the server cannot do, so it is done here instead of deferring the
            whole banner to an effect. Kept inline and dependency-free: an external file
            would be a network round trip in front of first paint. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('alexandris_cookie_consent'))document.documentElement.dataset.consent='set'}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <JsonLd data={organizationSchema(seo)} />
        <JsonLd data={websiteSchema(seo)} />
        <NextIntlClientProvider messages={messages}>
          {/*
            Skip to content — WCAG 2.4.1 (Bypass Blocks), Level A (A11Y-001).
            Without it a keyboard or screen-reader user tabs through the announcement bar,
            the wordmark, six nav links, search, wishlist, account and cart before reaching
            the page itself, on EVERY navigation.

            Visually hidden until focused rather than hidden outright: `sr-only` alone would
            leave a sighted keyboard user pressing Tab with no idea where focus went. Every
            page's <main> carries id="main" as the target.
          */}
          <a
            href="#main"
            className="sr-only z-200 bg-luxe-black px-4 py-3 text-sm text-luxe-white focus:not-sr-only focus:fixed focus:top-4 focus:left-4"
          >
            Μετάβαση στο περιεχόμενο
          </a>
          {/* Deliberately ahead of {children}. It is position:fixed, so DOM order does not
              affect where it appears — but it does decide when it appears. Sitting after
              {children} meant its markup only flushed once the page's slowest server
              component had finished streaming, so this banner painted ~3.3s in and became
              the homepage's LCP element. Emitted first, it paints with the shell.
              Stacking is unaffected: the cart drawer portals to the end of <body>, the
              toast viewport is z-200, and the header is top-fixed with no overlap. */}
          <CookieConsentBanner />
          {/* Renders nothing until the visitor has consented AND a measurement id is
              configured. Suspense because its page-view tracker reads useSearchParams,
              which would otherwise opt every route into client-side rendering. */}
          <Suspense fallback={null}>
            <Analytics />
          </Suspense>
          <ToastProvider>
            <CartProvider>
              <WishlistProvider>
                <AuthProvider>
                  <CategoryNamesProvider names={categoryNames}>{children}</CategoryNamesProvider>
                </AuthProvider>
              </WishlistProvider>
              <CartDrawer freeShippingThreshold={freeShippingThreshold} />
              {/* Inside CartProvider so it can step aside while the drawer is open. */}
              <ToastViewport />
            </CartProvider>
          </ToastProvider>
          <ReferralCapture />
          {/* Sibling to ReferralCapture, outside the cart/auth/toast providers on purpose —
              it's a dashboard-toggled marketing takeover, not app state, and has nothing to
              coordinate with any of them. */}
          <TikTokLiveModal
            enabled={settings.liveOnTikTok ?? false}
            tiktokUrl={settings.tiktokLiveUrl ?? "https://www.tiktok.com/live"}
          />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
