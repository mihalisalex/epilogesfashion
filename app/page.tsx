import type { Metadata } from "next";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { SectionRenderer } from "@/components/sections/SectionRenderer";
import { SplitHero } from "@/components/sections/SplitHero";
import { BigCategoryGrid } from "@/components/sections/BigCategoryGrid";
import { VideoMoment } from "@/components/sections/VideoMoment";
import { buildMetadata } from "@/lib/seo";
import { getNavigation, getSeoDefaults, getSiteSettings, getVisibleHomepageSections } from "@/services";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const seo = await getSeoDefaults();
  return buildMetadata({
    seo,
    title: seo.defaultTitle,
    description: seo.defaultDescription,
    path: "/",
  });
}

export default async function HomePage() {
  const [navigation, settings, sections] = await Promise.all([
    getNavigation(),
    getSiteSettings(),
    getVisibleHomepageSections(),
  ]);

  /**
   * Minimal-grid concept under client review: SplitHero and BigCategoryGrid stand in for
   * the CMS-driven "hero" and "featuredCollections" sections (placeholder colour blocks,
   * not wired into the admin homepage editor yet), and VideoMoment is a new placeholder
   * slot that doesn't exist in the CMS at all. Everything else — the product carousel,
   * editorial banner, brand story, newsletter — is still the real, live-data sections;
   * only the newsletter's own background moved to the purple accent (Newsletter.tsx) to
   * match. Once a direction is picked, this becomes real CMS section types instead of a
   * page.tsx special case.
   */
  const withoutReplacedSections = sections.filter(
    (section) => section.type !== "hero" && section.type !== "featuredCollections"
  );
  const newsletterSection = withoutReplacedSections.find((section) => section.type === "newsletter");
  const middleSections = withoutReplacedSections.filter((section) => section.type !== "newsletter");

  return (
    <>
      <Header
        navigation={navigation}
        siteName={settings.siteName}
        announcementMessages={settings.announcementMessages}
      />
      <main id="main" className="flex-1">
        <SplitHero />
        <BigCategoryGrid />
        {middleSections.map((section) => (
          <SectionRenderer key={section.id} section={section} />
        ))}
        <VideoMoment />
        {newsletterSection ? <SectionRenderer section={newsletterSection} /> : null}
      </main>
      <Footer navigation={navigation} settings={settings} />
    </>
  );
}
