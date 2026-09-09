import type { Metadata } from "next";
import Link from "next/link";
import { Compass } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { getNavigation, getSiteSettings } from "@/services";
import { getTranslations } from "next-intl/server";

/**
 * Explicitly `noindex`, which it was not until `SEO-002` was fixed — and the reason is a small
 * lesson in how a fix can quietly remove something.
 *
 * While unknown URLs answered 200, Next injected `<meta name="robots" content="noindex">` on its
 * own, because a `notFound()` firing mid-stream is the one case where it does that. Moving the
 * 404 into `proxy.ts` means the page is now reached by a rewrite instead, `notFound()` never
 * fires, and the automatic meta went away with it. The status code more than replaces it — a 404
 * is a stronger signal to a crawler than a 200 carrying a tag — but the tag was still lost
 * without anyone asking for that, and the test that caught it was the one pinning the mitigation.
 *
 * Set here rather than restored in the proxy, so both routes to this page carry it: the rewrite
 * from `proxy.ts`, and any `notFound()` that still fires from a route the proxy does not match.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function NotFound() {
  const [navigation, settings, t] = await Promise.all([getNavigation(), getSiteSettings(), getTranslations("Errors")]);

  return (
    <>
      <Header navigation={navigation} siteName={settings.siteName} announcementMessages={settings.announcementMessages} />
      <main id="main" className="flex-1 pt-header">
        <div className="container-luxe flex flex-col items-center gap-4 py-32 text-center">
          <Compass className="size-12 text-luxe-gray-dark" strokeWidth={1} />
          <p className="text-eyebrow">404</p>
          <h1 className="font-heading text-3xl">{t("notFoundTitle")}</h1>
          <p className="max-w-sm text-sm text-luxe-gray-dark">{t("notFoundBody")}</p>
          <Link
            href="/"
            className="mt-2 flex h-12 items-center justify-center bg-luxe-black px-8 text-xs font-medium tracking-[0.08em] text-luxe-white uppercase"
          >
            {t("backToHome")}
          </Link>
        </div>
      </main>
      <Footer navigation={navigation} settings={settings} />
    </>
  );
}
