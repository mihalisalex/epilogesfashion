"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { fadeUp, viewportOnce } from "@/constants/animation";

interface SplitHeroPanel {
  eyebrow: string;
  headline: string;
  ctaLabel: string;
  href: string;
  image: { src: string; alt: string };
}

/**
 * The shop is women's-only — there is no men's line, so the two panels split by occasion
 * (new season pieces vs. curated complete looks) rather than by a gender the catalog
 * doesn't carry.
 *
 * Both photos are already live elsewhere on this site (the wool trench coat is the site's
 * own hero image; the knitwear flat-lay is used in Everyday Essentials) — reused
 * deliberately rather than picked fresh, so these placeholders are proven to load rather
 * than a new, unverified URL.
 */
const PANELS: SplitHeroPanel[] = [
  {
    eyebrow: "A/W 2026",
    headline: "Tailoring, softened.",
    ctaLabel: "Shop New In",
    href: "/new-in",
    image: {
      src: "https://images.unsplash.com/photo-1539533018447-63fcce2678e3?auto=format&fit=crop&w=1200&q=80",
      alt: "Black wool trench coat, editorial styling",
    },
  },
  {
    eyebrow: "Curated by Us",
    headline: "Complete looks, zero guesswork.",
    ctaLabel: "Shop Ready to Wear",
    href: "/collections",
    image: {
      src: "https://images.unsplash.com/photo-1516762689617-e1cffcef479d?auto=format&fit=crop&w=1200&q=80",
      alt: "Folded knitwear and accessories, styled flat-lay",
    },
  },
];

/**
 * Two independent panels instead of one full-bleed banner — the "minimal grid" direction
 * the client approved. Photography placeholders, not final shoot images: swap `image` for
 * whatever's chosen once photography is commissioned, copy and layout don't change.
 */
export function SplitHero() {
  return (
    // No `pt-header`: the header renders `transparent` on this page (see app/page.tsx), so
    // these panels need to run full-bleed up under it rather than start below it — that's
    // the whole point of the white-on-photo treatment. The announcement bar above the header
    // stays opaque regardless and simply overlaps the very top of the image, same as before.
    <section className="grid grid-cols-1 gap-px bg-border md:grid-cols-2">
      {PANELS.map((panel, index) => (
        <Link
          key={panel.href}
          href={panel.href}
          className="group relative flex h-[420px] items-end overflow-hidden bg-luxe-black md:h-[560px]"
        >
          <Image
            src={panel.image.src}
            alt={panel.image.alt}
            fill
            priority={index === 0}
            sizes="(min-width: 768px) 50vw, 100vw"
            className="object-cover transition-transform duration-700 ease-out group-hover:scale-105"
          />
          {/* Bottom-weighted scrim rather than a flat overlay — keeps the top of each photo
              true to itself and only darkens where the caption actually sits. */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-luxe-black/80 via-luxe-black/15 to-transparent" />
          {/* Separate, short top scrim — purely so the transparent header's white wordmark
              and icons stay readable over whatever happens to be at the top of the photo
              (sky, pale stone, fabric), independent of the bottom scrim that serves the
              caption instead. Fades out well above the caption so it never doubles up. */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-luxe-black/55 to-transparent md:h-32" />

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={viewportOnce}
            variants={fadeUp}
            transition={{ delay: index * 0.1 }}
            className="relative p-8 text-luxe-white md:p-10"
          >
            <p className="text-eyebrow text-luxe-white/80">{panel.eyebrow}</p>
            <h2 className="font-heading mt-3 text-3xl font-semibold md:text-4xl">{panel.headline}</h2>
            <span className="mt-5 inline-flex items-center border-b border-luxe-white/70 pb-1 text-xs font-semibold tracking-[0.14em] uppercase transition-opacity group-hover:opacity-70">
              {panel.ctaLabel}
            </span>
          </motion.div>
        </Link>
      ))}
    </section>
  );
}
