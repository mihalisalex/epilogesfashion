export interface SocialLink {
  platform: "instagram" | "facebook" | "tiktok" | "pinterest" | "youtube" | "x";
  url: string;
}

export interface SiteSettings {
  siteName: string;
  tagline: string;
  logo: string;
  logoDark?: string;
  favicon: string;
  contactEmail: string;
  currency: string;
  locale: string;
  socialLinks: SocialLink[];
  announcementMessages: string[];
  /**
   * Drives the site-wide "we're live on TikTok" popup (see TikTokLiveModal). Flip
   * `liveOnTikTok` on right before/during a stream; every storefront visitor then sees the
   * popup until it's flipped back off. `tiktokLiveUrl` is where "answering" the popup sends
   * them — kept separate from `socialLinks` because that list is the profile link shown
   * year-round in the footer, not a specific live session's URL.
   *
   * Optional, like `logoDark`: an existing settings row written before this field existed
   * has neither key, and this store never backfills a row that's already there (see
   * lib/site-content.ts) — every reader treats a missing value as "off" / "unset".
   */
  liveOnTikTok?: boolean;
  tiktokLiveUrl?: string;
}
