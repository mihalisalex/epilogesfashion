import Image from "next/image";
import Link from "next/link";

interface StoryCategory {
  label: string;
  href: string;
  image: { src: string; alt: string };
}

/**
 * All eight reuse photography already proven to load elsewhere on this site (product photos
 * and SplitHero/homepage tiles) rather than fresh, unverified URLs — same reasoning as
 * SplitHero's placeholders. Denim gets two distinct entries (jeans vs. the jacket) because
 * the row is a browse shortcut, not a literal one-row-per-category index.
 */
const CATEGORIES: StoryCategory[] = [
  {
    label: "Jeans",
    href: "/women?category=denim",
    image: {
      src: "https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=200&q=80",
      alt: "Denim jeans",
    },
  },
  {
    label: "T-Shirts",
    href: "/women?category=tops",
    image: {
      src: "https://images.unsplash.com/photo-1620012253295-c15cc3e65df4?auto=format&fit=crop&w=200&q=80",
      alt: "Linen shirt",
    },
  },
  {
    label: "Dresses",
    href: "/women?category=dresses",
    image: {
      src: "https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=200&q=80",
      alt: "Silk slip dress",
    },
  },
  {
    label: "Accessories",
    href: "/women?category=accessories",
    image: {
      src: "https://images.unsplash.com/photo-1591561954557-26941169b49e?auto=format&fit=crop&w=200&q=80",
      alt: "Jewellery and accessories",
    },
  },
  {
    label: "Coats",
    href: "/women?category=outerwear",
    image: {
      src: "https://images.unsplash.com/photo-1539533018447-63fcce2678e3?auto=format&fit=crop&w=200&q=80",
      alt: "Black wool trench coat",
    },
  },
  {
    label: "Blazers",
    href: "/women?category=blazers",
    image: {
      src: "https://images.unsplash.com/photo-1594938298603-c8148c4dae35?auto=format&fit=crop&w=200&q=80",
      alt: "Charcoal wool blazer",
    },
  },
  {
    label: "Knitwear",
    href: "/women?category=knitwear",
    image: {
      src: "https://images.unsplash.com/photo-1516762689617-e1cffcef479d?auto=format&fit=crop&w=200&q=80",
      alt: "Merino wool knitwear",
    },
  },
  {
    label: "Denim Jackets",
    href: "/women?category=denim",
    image: {
      src: "https://images.unsplash.com/photo-1601333144130-8cbb312386b6?auto=format&fit=crop&w=200&q=80",
      alt: "Relaxed denim trucker jacket",
    },
  },
];

/**
 * Instagram-story-style shortcuts into eight categories a shopper reaches for most. Eight
 * doesn't fit one screen, so the row scrolls horizontally with snap points instead of
 * shrinking to fit — same feel as swiping through a real story tray, rather than cramming
 * smaller and smaller circles onto the page. The scrollbar is hidden (still keyboard/
 * trackpad/touch scrollable) so it reads as a swipe gesture, not a browser scroll strip.
 */
export function CategoryStories({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div
      className="flex shrink-0 snap-x snap-mandatory gap-2 overflow-x-auto border-b border-border px-4 py-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {CATEGORIES.map((category) => (
        <Link
          key={category.label}
          href={category.href}
          onClick={onNavigate}
          className="group flex shrink-0 snap-start flex-col items-center gap-1"
        >
          <span className="rounded-full bg-gradient-to-tr from-[#f9a13f] via-[#e0356b] to-luxe-purple p-[2px] transition-transform duration-200 group-hover:scale-105">
            <span className="block rounded-full bg-luxe-white p-[1.5px]">
              <span className="relative block size-11 overflow-hidden rounded-full bg-luxe-gray-light">
                <Image
                  src={category.image.src}
                  alt={category.image.alt}
                  fill
                  sizes="44px"
                  className="object-cover"
                />
              </span>
            </span>
          </span>
          {/* w-12, a touch wider than the circle: without it a long label (e.g. "Denim
              Jackets") widens the whole flex item past its circle, throwing off the
              otherwise-even rhythm of the row. Truncates instead, same as Instagram does
              with long usernames. */}
          <span className="w-12 truncate text-center text-[9.5px] font-medium text-luxe-black">
            {category.label}
          </span>
        </Link>
      ))}
    </div>
  );
}
