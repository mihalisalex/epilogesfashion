"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Heart, Menu, X } from "lucide-react";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import type { NavItem } from "@/types";

interface MobileMenuProps {
  items: NavItem[];
  /**
   * Product Care specifically — everything else that used to live down here (Contact, Ask a
   * Stylist, Shipping & Returns, Size Guide) is footer-only now, same as Blog and About: the
   * menu is for getting into the catalogue, not a mirror of the footer. Product Care stays
   * because it sits with Wishlist/Account as something a shopper reaches for mid-browse, not
   * only at checkout time.
   */
  productCareLink?: { label: string; href: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerLight: boolean;
}

export function MobileMenu({ items, productCareLink, open, onOpenChange, triggerLight }: MobileMenuProps) {
  const tA11y = useTranslations("A11y");
  const t = useTranslations("MobileMenu");
  const close = () => onOpenChange(false);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <button
        type="button"
        aria-label={t("openMenu")}
        onClick={() => onOpenChange(true)}
        className={triggerLight ? "text-luxe-white lg:hidden" : "text-luxe-black lg:hidden"}
      >
        <Menu className="size-5" strokeWidth={1.5} />
      </button>
      <SheetContent
        side="left"
        showCloseButton={false}
        className="flex w-full flex-col border-none bg-luxe-white p-0 sm:max-w-md"
      >
        <SheetTitle className="sr-only">{t("siteNavigation")}</SheetTitle>
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-luxe-purple/15 px-6">
          <span className="font-heading text-lg tracking-[0.15em] uppercase">{t("menu")}</span>
          <SheetClose aria-label={t("closeMenu")}>
            <X className="size-5" strokeWidth={1.5} />
          </SheetClose>
        </div>

        <nav className="flex-1 overflow-y-auto px-6 py-4" aria-label={tA11y("mobileNav")}>
          <Accordion>
            {items.map((item) =>
              item.children?.length ? (
                <AccordionItem key={item.id} value={item.id}>
                  <AccordionTrigger className="py-4 text-[13px] font-medium tracking-[0.08em] uppercase no-underline hover:no-underline">
                    {item.label}
                  </AccordionTrigger>
                  <AccordionContent className="[&_a]:no-underline [&_a]:hover:text-luxe-black">
                    <ul className="space-y-3 pl-1">
                      <li>
                        <Link
                          href={item.href}
                          onClick={close}
                          className="font-heading block text-sm font-medium text-luxe-black"
                        >
                          {t("viewAll", { label: item.label })}
                        </Link>
                      </li>
                      {item.children.map((child) => (
                        <li key={child.id}>
                          <Link
                            href={child.href}
                            onClick={close}
                            className="font-heading block text-sm font-medium text-luxe-black no-underline"
                          >
                            {child.label}
                          </Link>
                          {child.children?.length ? (
                            <ul className="mt-2.5 mb-1 space-y-2.5 pl-3">
                              {child.children.map((grandchild) => (
                                <li key={grandchild.id}>
                                  <Link
                                    href={grandchild.href}
                                    onClick={close}
                                    className="font-heading block text-sm text-luxe-gray-dark no-underline"
                                  >
                                    {grandchild.label}
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              ) : (
                <div key={item.id} className="border-b border-border py-4">
                  <Link
                    href={item.href}
                    onClick={close}
                    className="font-heading block text-[13px] font-medium tracking-[0.08em] uppercase no-underline"
                  >
                    {item.label}
                  </Link>
                </div>
              )
            )}
          </Accordion>
        </nav>

        <div className="shrink-0 border-t border-border px-6 py-6">
          <ul className="font-heading flex flex-col gap-3 text-sm text-luxe-gray-dark">
            <li>
              <Link href="/account" onClick={close} className="no-underline">
                {t("account")}
              </Link>
            </li>
            <li>
              <Link href="/wishlist" onClick={close} className="no-underline">
                {t("wishlist")}
              </Link>
            </li>
            {productCareLink ? (
              <li>
                <Link href={productCareLink.href} onClick={close} className="no-underline">
                  {productCareLink.label}
                </Link>
              </li>
            ) : null}
          </ul>
        </div>

        {/* A quiet closing note rather than another link — everything actionable is already
            above it, this is just the menu ending somewhere warmer than a plain edge. */}
        <div className="flex shrink-0 flex-col items-center gap-2 border-t border-luxe-purple/15 bg-luxe-gray-light py-6">
          <Heart className="size-5 fill-luxe-purple text-luxe-purple" strokeWidth={0} />
          <p className="text-eyebrow text-[10px] text-luxe-gray-dark">Handpicked in Heraklion</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
