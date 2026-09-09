import type { CallToAction, Image } from "./common";

/**
 * Every homepage block is a discriminated union member keyed by `type`.
 * The admin homepage editor and the renderer (`components/sections/SectionRenderer`)
 * both switch on `type`, so adding a new section later means: add a member here,
 * a case in the renderer, and an editor panel — nothing else changes.
 */

export type HomepageSectionType =
  | "hero"
  | "featuredCollections"
  | "bestSellers"
  | "editorialBanner"
  | "newArrivals"
  | "brandStory"
  | "socialGrid"
  | "brandStrip"
  | "newsletter";

interface SectionBase {
  id: string;
  type: HomepageSectionType;
  enabled: boolean;
  order: number;
}

export interface HeroSection extends SectionBase {
  type: "hero";
  data: {
    eyebrow?: string;
    headline: string;
    subheadline?: string;
    image: Image;
    primaryCta?: CallToAction;
    secondaryCta?: CallToAction;
  };
}

export interface FeaturedCollectionsSection extends SectionBase {
  type: "featuredCollections";
  data: {
    title: string;
    subtitle?: string;
    /**
     * @deprecated Superseded by `tiles`, and still read when `tiles` is absent so a homepage
     * saved before tiles existed keeps rendering. Remove once no stored section relies on it.
     */
    collectionIds?: string[];
    /**
     * What the grid shows. A tile takes its name, image and link from whatever it points at,
     * so a renamed category or a swapped image reaches the homepage without anyone editing it
     * here — which is the reason a tile references an entity rather than carrying its own copy
     * of the words.
     */
    tiles?: FeaturedTileRef[];
  };
}

/**
 * A tile points at a collection or a category.
 *
 * Categories were added because most of these tiles were categories wearing a different name:
 * one was titled "Everyday Basics" and held three whole categories, another was titled for
 * women and held mostly men's shoes. Pointing a tile at the category makes the label and the
 * destination the same fact, so they cannot drift apart again.
 *
 * Collections keep their place for groupings a category cannot express — "New Arrivals" is the
 * clear case, since recency is not a category.
 */
export type FeaturedTileRef =
  | { type: "collection"; id: string }
  /** Category slug rather than id: it is what the URL uses and what a person recognises. */
  | { type: "category"; slug: string };

export interface BestSellersSection extends SectionBase {
  type: "bestSellers";
  data: {
    title: string;
    subtitle?: string;
    productIds: string[];
    viewAllCta?: CallToAction;
  };
}

export interface EditorialBannerSection extends SectionBase {
  type: "editorialBanner";
  data: {
    eyebrow?: string;
    headline: string;
    body?: string;
    image: Image;
    cta?: CallToAction;
    imagePosition?: "left" | "right";
  };
}

/**
 * One carousel inside the new-arrivals section, scoped to a gender.
 *
 * Products are queried rather than pinned, which is the whole point: a hand-picked list
 * stops being "new" the day after it is written, and nobody remembers to rewrite it.
 */
export interface NewArrivalsRow {
  /** Matches `Product.gender`. Unisex products appear in every row. */
  gender: "women" | "men";
  /** Row heading, e.g. "Γυναικεία". */
  title: string;
  viewAllHref: string;
  viewAllLabel: string;
}

export interface NewArrivalsSection extends SectionBase {
  type: "newArrivals";
  data: {
    title: string;
    subtitle?: string;
    /**
     * A pinned list, and the original behaviour. Superseded by `rows` on the homepage but
     * still honoured, because landing pages share this section type and some of them do
     * want an exact, curated set of products.
     */
    productIds: string[];
    /** When present, replaces the pinned list with one queried carousel per gender. */
    rows?: NewArrivalsRow[];
    /** Products per row. */
    limit?: number;
  };
}

export interface BrandStorySection extends SectionBase {
  type: "brandStory";
  data: {
    eyebrow?: string;
    headline: string;
    body: string;
    cta?: CallToAction;
  };
}

export interface SocialGridSection extends SectionBase {
  type: "socialGrid";
  data: {
    title: string;
    handle?: string;
    images: Image[];
  };
}

export interface Brand {
  name: string;
  /**
   * An official logo file, once the brand supplies one. Absent by default, and absent is a
   * perfectly good state: the strip then sets the name as a house wordmark, which is how
   * eight brands end up looking like a set instead of like eight different logos.
   */
  logo?: string;
  /** Only meaningful with `logo`. The name is already the accessible text otherwise. */
  logoAlt?: string;
  /**
   * Where this brand goes, if anywhere. Optional on purpose — most of these are not
   * separately browsable yet, and a link to nothing is worse than a name that is simply a
   * name.
   */
  href?: string;
}

export interface BrandStripSection extends SectionBase {
  type: "brandStrip";
  data: {
    title?: string;
    subtitle?: string;
    brands: Brand[];
  };
}

export interface NewsletterSection extends SectionBase {
  type: "newsletter";
  data: {
    headline: string;
    subheadline?: string;
    ctaLabel: string;
  };
}

export type HomepageSection =
  | HeroSection
  | FeaturedCollectionsSection
  | BestSellersSection
  | EditorialBannerSection
  | NewArrivalsSection
  | BrandStorySection
  | SocialGridSection
  | BrandStripSection
  | NewsletterSection;

export interface HomepageConfig {
  sections: HomepageSection[];
}
