import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface LogoProps {
  siteName: string;
  className?: string;
}

/**
 * TEMPORARY: the real floral badge, dropped in exactly as supplied (public/logo-badge.png),
 * just so it can be seen live in the actual header rather than judged from a flat image.
 * This is NOT the recommended direction — see the "Logo Directions" mockup — it's here on
 * request, to compare against the plain wordmark below in situ. Swap the `return` back to
 * the commented-out text lockup to revert.
 */
export function Logo({ siteName, className }: LogoProps) {
  const [firstWord, ...rest] = siteName.trim().split(/\s+/);
  const subtitle = rest.join(" ");
  void firstWord;
  void subtitle;

  return (
    <Link href="/" aria-label={`${siteName} — Home`} className={cn("shrink-0", className)}>
      <Image
        src="/logo-badge.png"
        alt={siteName}
        width={567}
        height={440}
        priority
        className="h-14 w-auto md:h-16"
      />
    </Link>
  );

  // --- previous text wordmark, kept for an easy revert ---
  // return (
  //   <Link
  //     href="/"
  //     aria-label={`${siteName} — Home`}
  //     className={cn("font-heading flex items-baseline gap-2 whitespace-nowrap uppercase", className)}
  //   >
  //     <span className="text-lg font-light tracking-[0.28em]">{firstWord}</span>
  //     {subtitle ? (
  //       <span className="text-[10px] font-normal tracking-[0.16em] opacity-60">{subtitle}</span>
  //     ) : null}
  //   </Link>
  // );
}
