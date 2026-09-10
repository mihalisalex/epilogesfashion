"use client";

import { motion } from "framer-motion";
import { Play } from "lucide-react";
import { fadeUp, viewportOnce } from "@/constants/animation";

/**
 * A placeholder for a future video embed — a gradient stand-in with a play affordance, not
 * a real player. Swap the inner block for an actual <video> or embed once footage exists;
 * the copy and the pulsing play button are here to show where it goes and how it reads.
 */
export function VideoMoment() {
  return (
    <section className="container-luxe pb-20 md:pb-28">
      <motion.div
        initial="hidden"
        whileInView="visible"
        viewport={viewportOnce}
        variants={fadeUp}
        className="relative flex aspect-[21/9] items-center justify-center overflow-hidden bg-gradient-to-br from-luxe-black via-luxe-purple to-[#c9a8d8]/40 text-center text-luxe-white"
      >
        <div className="relative flex flex-col items-center gap-4 px-6">
          <p className="text-eyebrow text-luxe-white/80">Behind the Seams</p>
          <h3 className="font-heading max-w-[18ch] text-2xl md:text-3xl">How a blazer gets its half-canvas</h3>
          <span className="relative mt-2 flex size-16 items-center justify-center rounded-full border border-luxe-white/80">
            <span className="absolute -inset-2.5 animate-ping rounded-full border border-luxe-white/30" />
            <Play className="ml-0.5 size-5 fill-luxe-white" strokeWidth={0} />
          </span>
          <p className="text-xs tracking-[0.05em] text-luxe-white/65">2:14 · The Atelier Series</p>
        </div>
      </motion.div>
    </section>
  );
}
