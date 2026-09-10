import Link from "next/link";
import { cn } from "@/lib/utils";

interface LogoProps {
  siteName: string;
  className?: string;
}

/**
 * Splits the site name into a prominent first word plus a smaller, quieter rest ("Epiloges"
 * / "Fashion Boutique") on one line, rather than the whole name at one size and one
 * generous tracking — which is what was wrapping onto a second line in the header. Falls
 * back to rendering the name plain if it's a single word, so this doesn't assume anything
 * about a name it wasn't written for.
 */
export function Logo({ siteName, className }: LogoProps) {
  const [firstWord, ...rest] = siteName.trim().split(/\s+/);
  const subtitle = rest.join(" ");

  return (
    <Link
      href="/"
      aria-label={`${siteName} — Home`}
      className={cn("font-heading flex items-baseline gap-2 whitespace-nowrap uppercase", className)}
    >
      <span className="text-lg font-bold tracking-[0.24em]">{firstWord}</span>
      {subtitle ? (
        <span className="text-[10px] font-normal tracking-[0.16em] opacity-60">{subtitle}</span>
      ) : null}
    </Link>
  );
}
