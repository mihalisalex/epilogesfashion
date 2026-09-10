"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { fadeUp, viewportOnce } from "@/constants/animation";

interface SplitHeroPanel {
  eyebrow: string;
  headline: string;
  ctaLabel: string;
  href: string;
  /** Both tones are dark on purpose — a light panel under plain white overlay text has no
   *  contrast once there's no photograph behind it to darken it. See the module comment. */
  tone: "bg-luxe-purple" | "bg-luxe-black";
}

const PANELS: SplitHeroPanel[] = [
  { eyebrow: "Women — A/W 2026", headline: "Tailoring, softened.", ctaLabel: "Shop Women", href: "/women", tone: "bg-luxe-purple" },
  { eyebrow: "Men — A/W 2026", headline: "Sharp lines, quiet rooms.", ctaLabel: "Shop Men", href: "/men", tone: "bg-luxe-black" },
];

/**
 * Two independent panels instead of one full-bleed banner — the "minimal grid" direction
 * the client is reviewing. This is a placeholder: flat colour blocks stand in for real
 * hero photography, which is why both tones are solid rather than photographic (a flat
 * light colour under white text reads fine behind a darkened photo, not behind nothing).
 * Swap `tone` for a real `<Image>` per panel once photography exists — the copy and layout
 * don't change.
 */
export function SplitHero() {
  return (
    <section className="grid grid-cols-1 gap-px bg-border pt-header md:grid-cols-2">
      {PANELS.map((panel, index) => (
        <Link
          key={panel.href}
          href={panel.href}
          className={`group relative flex h-[420px] items-end overflow-hidden md:h-[560px] ${panel.tone}`}
        >
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
