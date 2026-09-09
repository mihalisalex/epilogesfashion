"use server";

import { revalidatePath, updateTag } from "next/cache";
import { requireCapability } from "@/lib/admin-session";
import { SHIPPING_CACHE_TAG, saveShippingSettings } from "@/services/shipping";
import type { ShippingSettings } from "@/types";

export async function saveShippingSettingsAction(settings: ShippingSettings): Promise<void> {
  await requireCapability("admin:settings");
  await saveShippingSettings(settings);
  // Shipping shows up in cart totals and at checkout on every page that renders a cart, so
  // this invalidates the whole tree rather than a single route.
  revalidatePath("/", "layout");
  /**
   * And the cross-request cache the root layout reads the free-shipping threshold from.
   * `revalidatePath` alone does not touch it — an `unstable_cache` entry is keyed by its tag,
   * not by the route that happened to read it — so without this a changed threshold would keep
   * being advertised in the cart drawer for up to an hour.
   */
  updateTag(SHIPPING_CACHE_TAG);
}
