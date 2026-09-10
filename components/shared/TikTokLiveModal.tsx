"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Phone, PhoneOff } from "lucide-react";

/**
 * sessionStorage, not a client-only useState flag: a shopper who answers or declines once
 * shouldn't get the same full-screen takeover again on every internal link click for the
 * rest of that visit. A fresh tab (or the merchant flipping the toggle off and back on
 * later) starts clean, since sessionStorage doesn't survive past the browser tab.
 */
const DISMISSED_KEY = "epiloges_tiktok_live_dismissed";

interface TikTokLiveModalProps {
  /** `settings.liveOnTikTok` — the merchant's dashboard toggle. Off renders nothing. */
  enabled: boolean;
  /** `settings.tiktokLiveUrl` — where "answering" sends the shopper. */
  tiktokUrl: string;
}

/**
 * A full-screen "incoming call" takeover, styled after iOS's own call screen, that the
 * merchant switches on right before/during a TikTok live: pulsing avatar, caller-ID-style
 * name, red decline / green accept. Answering opens the live stream in a new tab; declining
 * (or Escape) just closes it — either way the shop underneath is untouched, exactly as it
 * was before the toggle. Purely presentational: whether it can appear at all lives entirely
 * in `enabled`, sourced from the site settings the admin dashboard edits.
 */
export function TikTokLiveModal({ enabled, tiktokUrl }: TikTokLiveModalProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    try {
      if (sessionStorage.getItem(DISMISSED_KEY) === "true") return;
    } catch {
      // Storage blocked (private mode, etc.) — fall through and show it anyway.
    }
    // sessionStorage-hydration-on-mount — the dismissed flag genuinely doesn't exist until
    // now (SSR has no sessionStorage), same pattern as CookieConsentBanner.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisible(true);
  }, [enabled]);

  const dismiss = () => {
    setVisible(false);
    try {
      sessionStorage.setItem(DISMISSED_KEY, "true");
    } catch {
      // Nothing to fall back to — worst case it can show again this visit.
    }
  };

  const answer = () => {
    window.open(tiktokUrl, "_blank", "noopener,noreferrer");
    dismiss();
  };

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible]);

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Ζωντανά τώρα στο TikTok"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-300 flex flex-col items-center justify-between overflow-hidden bg-gradient-to-b from-[#1c1024] via-luxe-black to-black px-8 pt-16 pb-14 text-luxe-white"
        >
          {/* Ambient glow, purely decorative — echoes the story-ring gradient used elsewhere
              on the site (CategoryStories) so this reads as the same brand, not a bolted-on
              system dialog. */}
          <div
            aria-hidden
            className="pointer-events-none absolute top-1/3 left-1/2 size-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-luxe-purple/25 blur-3xl"
          />

          <motion.div
            initial={{ y: -10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.4 }}
            className="relative flex items-center gap-2 rounded-full bg-luxe-white/10 px-4 py-1.5 backdrop-blur-sm"
          >
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-red-500" />
            </span>
            <span className="text-[11px] font-semibold tracking-[0.18em] uppercase">TikTok Live</span>
          </motion.div>

          <motion.div
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.15, duration: 0.5 }}
            className="relative flex flex-col items-center gap-5 text-center"
          >
            <div className="relative flex size-28 items-center justify-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-luxe-purple/40" />
              <span className="absolute inset-0 rounded-full bg-gradient-to-tr from-[#f9a13f] via-[#e0356b] to-luxe-purple p-[3px]">
                <span className="block size-full rounded-full bg-luxe-black p-[3px]">
                  <span className="flex size-full items-center justify-center rounded-full bg-luxe-black">
                    <TikTokGlyph className="size-11 text-luxe-white" />
                  </span>
                </span>
              </span>
            </div>

            <div>
              <p className="font-heading text-2xl font-semibold">Epiloges Fashion Boutique</p>
              <p className="mt-1.5 text-sm text-luxe-white/70">Μόλις ξεκινήσαμε live στο TikTok</p>
            </div>
          </motion.div>

          <motion.div
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="relative flex items-end gap-16"
          >
            <div className="flex flex-col items-center gap-2.5">
              <button
                type="button"
                onClick={dismiss}
                aria-label="Απόρριψη"
                className="flex size-16 items-center justify-center rounded-full bg-red-500 shadow-lg shadow-red-500/30 transition-transform active:scale-95"
              >
                <PhoneOff className="size-6" strokeWidth={2} />
              </button>
              <span className="text-xs text-luxe-white/60">Απόρριψη</span>
            </div>
            <div className="flex flex-col items-center gap-2.5">
              <button
                type="button"
                onClick={answer}
                aria-label="Μετάβαση στο live"
                className="flex size-16 items-center justify-center rounded-full bg-green-500 shadow-lg shadow-green-500/30 transition-transform active:scale-95"
              >
                <Phone className="size-6" strokeWidth={2} />
              </button>
              <span className="text-xs text-luxe-white/60">Σύνδεση</span>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** TikTok's musical-note mark, hand-drawn: lucide-react carries no brand icons. */
function TikTokGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M16.5 2h-3.2v13.6a2.9 2.9 0 1 1-2.06-2.78V9.5a6.1 6.1 0 1 0 5.26 6.05V8.83a7.3 7.3 0 0 0 4.3 1.38V6.99a4.1 4.1 0 0 1-4.3-4.1V2Z" />
    </svg>
  );
}
