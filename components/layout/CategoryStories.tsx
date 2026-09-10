import Image from "next/image";
import Link from "next/link";

interface StoryCategory {
  label: string;
  href: string;
  image: { src: string; alt: string };
}

/**
 * All four reuse photography already proven to load elsewhere on this site (the denim jeans
 * and silk dress images are the Denim Edit / Evening Dresses collection tiles; the linen
 * shirt is the Linen Button-Down Shirt product photo) rather than fresh, unverified URLs —
 * same reasoning as SplitHero's placeholders.
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
];

/**
 * Instagram-story-style shortcuts into the four categories a shopper reaches for most —
 * the gradient ring and the padded-white gap between ring and photo are what make it read
 * as "story" rather than just "circular thumbnail with a border."
 */
export function CategoryStories({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex shrink-0 justify-between gap-2 border-b border-border px-6 py-5">
      {CATEGORIES.map((category) => (
        <Link
          key={category.label}
          href={category.href}
          onClick={onNavigate}
          className="group flex flex-col items-center gap-2"
        >
          <span className="rounded-full bg-gradient-to-tr from-[#f9a13f] via-[#e0356b] to-luxe-purple p-[2.5px] transition-transform duration-200 group-hover:scale-105">
            <span className="block rounded-full bg-luxe-white p-[2.5px]">
              <span className="relative block size-16 overflow-hidden rounded-full bg-luxe-gray-light">
                <Image
                  src={category.image.src}
                  alt={category.image.alt}
                  fill
                  sizes="64px"
                  className="object-cover"
                />
              </span>
            </span>
          </span>
          <span className="text-[11px] font-medium text-luxe-black">{category.label}</span>
        </Link>
      ))}
    </div>
  );
}
