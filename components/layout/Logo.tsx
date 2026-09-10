import Link from "next/link";
import { cn } from "@/lib/utils";

interface LogoProps {
  siteName: string;
  className?: string;
}

export function Logo({ siteName, className }: LogoProps) {
  return (
    <Link
      href="/"
      aria-label={`${siteName} — Home`}
      className={cn(
        "font-heading text-lg font-light tracking-[0.4em] uppercase",
        className
      )}
    >
      {siteName}
    </Link>
  );
}
