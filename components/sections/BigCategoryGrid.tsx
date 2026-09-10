"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { fadeUp, staggerContainer, viewportOnce } from "@/constants/animation";

interface GridTile {
  name: string;
  count: string;
  href: string;
  className: string;
}

const TALL: GridTile = {
  name: "Evening Dresses",
  count: "24 pieces",
  href: "/collections/evening-dresses",
  className: "bg-gradient-to-br from-luxe-gray-light to-[#c9a8d8]",
};

const STACK: GridTile[] = [
  {
    name: "Coats & Outerwear",
    count: "16 pieces",
    href: "/collections/coats-outerwear",
    className: "bg-gradient-to-br from-luxe-purple to-luxe-black",
  },
  {
    name: "The Denim Edit",
    count: "12 pieces",
    href: "/collections/denim-edit",
    className: "bg-gradient-to-br from-[#8c6a99] to-luxe-purple",
  },
];

/**
 * The "bigger, asymmetric grid" the client asked for — one tall tile plus two stacked,
 * instead of a flat row of equal squares. Placeholder colour blocks in place of real
 * category photography, same reasoning as SplitHero: swap `className` for an `<Image>`
 * per tile once real photos are chosen, without touching the layout.
 */
export function BigCategoryGrid() {
  return (
    <section className="container-luxe py-20 md:py-28">
      <div className="mb-10 text-center md:mb-14">
        <p className="text-eyebrow">Shop the Edit</p>
        <h2 className="font-heading mt-2 text-3xl md:text-4xl">Chic &amp; Considered</h2>
      </div>
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        whileInView="visible"
        viewport={viewportOnce}
        className="grid grid-cols-1 gap-4 md:grid-cols-[1.15fr_1fr]"
      >
        <motion.div variants={fadeUp}>
          <Tile tile={TALL} className="h-[320px] md:h-full" />
        </motion.div>
        <motion.div variants={fadeUp} className="grid grid-rows-2 gap-4">
          {STACK.map((tile) => (
            <Tile key={tile.name} tile={tile} className="h-[190px] md:h-auto" />
          ))}
        </motion.div>
      </motion.div>
    </section>
  );
}

function Tile({ tile, className }: { tile: GridTile; className?: string }) {
  return (
    <Link
      href={tile.href}
      className={`group relative flex items-end overflow-hidden ${tile.className} ${className ?? ""}`}
    >
      <div className="relative flex w-full items-center justify-between p-6 text-luxe-white">
        <div>
          <p className="font-heading text-xl">{tile.name}</p>
          <p className="mt-1 text-xs tracking-[0.05em] text-luxe-white/80 uppercase">{tile.count}</p>
        </div>
        <ArrowRight className="size-5 shrink-0 transition-transform group-hover:translate-x-1" strokeWidth={1.5} />
      </div>
    </Link>
  );
}
