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
 * A floating "incoming call" card — rounded, frosted glass, centered over a dimmed shop
 * rather than a full-screen takeover — that the merchant switches on right before/during a
 * TikTok live: pulsing avatar, caller-ID-style name, red decline / green accept. Answering
 * opens the live stream in a new tab; declining (or Escape, or tapping outside the card)
 * just closes it — either way the shop underneath is untouched, exactly as it was before
 * the toggle. Purely presentational: whether it can appear at all lives entirely in
 * `enabled`, sourced from the site settings the admin dashboard edits.
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
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-300 flex items-center justify-center bg-luxe-black/45 p-6 backdrop-blur-[2px]"
          onClick={(e) => {
            if (e.target === e.currentTarget) dismiss();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Ζωντανά τώρα στο TikTok"
            initial={{ opacity: 0, y: 14, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 340, damping: 28 }}
            className="relative w-full max-w-[300px] overflow-hidden rounded-[32px] border border-luxe-white/15 bg-[#160c1d]/75 px-7 pt-7 pb-6 text-center text-luxe-white shadow-2xl shadow-black/40 backdrop-blur-2xl"
          >
            {/* The "liquid glass" read: a soft light sheen across the top third plus an
                ambient purple bloom behind the avatar, both sitting under a blurred,
                semi-transparent panel rather than an opaque one. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-gradient-to-b from-luxe-white/15 via-transparent to-transparent"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute top-8 left-1/2 size-40 -translate-x-1/2 rounded-full bg-luxe-purple/35 blur-3xl"
            />

            <div className="relative flex items-center justify-center gap-1.5">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-red-500" />
              </span>
              <span className="text-[10px] font-semibold tracking-[0.18em] uppercase text-luxe-white/80">
                TikTok Live
              </span>
            </div>

            <div className="relative mx-auto mt-5 flex size-20 items-center justify-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-luxe-purple/40" />
              <span className="absolute inset-0 rounded-full bg-gradient-to-tr from-[#f9a13f] via-[#e0356b] to-luxe-purple p-[2.5px]">
                <span className="block size-full rounded-full bg-[#160c1d] p-[2.5px]">
                  <span className="flex size-full items-center justify-center rounded-full bg-[#160c1d]">
                    <TikTokGlyph className="size-8 text-luxe-white" />
                  </span>
                </span>
              </span>
            </div>

            <div className="relative mt-4">
              <p className="font-heading text-lg font-semibold">Epiloges Fashion Boutique</p>
              <p className="mt-1 text-xs text-luxe-white/70">Μόλις ξεκινήσαμε live στο TikTok</p>
            </div>

            <div className="relative mt-6 flex items-center justify-center gap-14">
              <div className="flex flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={dismiss}
                  aria-label="Απόρριψη"
                  className="flex size-13 items-center justify-center rounded-full bg-red-500 shadow-lg shadow-red-500/30 transition-transform active:scale-95"
                >
                  <PhoneOff className="size-5" strokeWidth={2} />
                </button>
                <span className="text-[10px] text-luxe-white/60">Απόρριψη</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={answer}
                  aria-label="Μετάβαση στο live"
                  className="flex size-13 items-center justify-center rounded-full bg-green-500 shadow-lg shadow-green-500/30 transition-transform active:scale-95"
                >
                  <Phone className="size-5" strokeWidth={2} />
                </button>
                <span className="text-[10px] text-luxe-white/60">Σύνδεση</span>
              </div>
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
