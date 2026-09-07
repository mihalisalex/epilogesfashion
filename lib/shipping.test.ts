import { describe, it, expect } from "vitest";
import { buildShippingRates, computeShippingChargeForRate, resolveShippingRate } from "./shipping";
import shippingFallback from "@/data/shipping.json";
import type { ShippingSettings } from "@/types";

/**
 * Built from the shipped defaults rather than from literals, so these tests exercise the same
 * configuration a fresh install runs on. The threshold and prices are read back off the
 * settings instead of being repeated here — a test that hardcodes 150 keeps passing after
 * someone changes the default to 100 and stops describing the shop.
 */
const DEFAULTS = shippingFallback as ShippingSettings;
const THRESHOLD = DEFAULTS.freeShippingThreshold!;
const RATES = buildShippingRates(DEFAULTS);
const STANDARD = RATES.find((rate) => rate.id === "standard")!;
const EXPRESS = RATES.find((rate) => rate.id === "express")!;

describe("buildShippingRates", () => {
  it("folds the threshold onto free-eligible rates only", () => {
    expect(STANDARD.freeOverAmount).toBe(THRESHOLD);
    expect(EXPRESS.freeOverAmount).toBeNull();
  });

  it("drops disabled rates so a shopper is never offered one that cannot be picked", () => {
    const settings: ShippingSettings = {
      ...DEFAULTS,
      rates: DEFAULTS.rates.map((rate) => (rate.id === "express" ? { ...rate, enabled: false } : rate)),
    };
    const ids = buildShippingRates(settings).map((rate) => rate.id);

    // Derived from the fixture rather than written out as a literal. This assertion used to
    // read `toEqual(["standard"])`, which silently encoded "the defaults contain exactly two
    // rates" into a test about something else entirely — so adding store pickup to
    // data/shipping.json failed it, for no reason connected to what it checks.
    expect(ids).not.toContain("express");
    expect(ids).toEqual(DEFAULTS.rates.filter((rate) => rate.enabled && rate.id !== "express").map((rate) => rate.id));
  });

  /**
   * Remote-area pricing. These decide what a real customer is charged, and the two ways to get
   * it wrong cost real money in opposite directions: undercharging every island order, or
   * surcharging the whole mainland.
   *
   * Postal codes are read out of the settings rather than written as literals — the list is
   * ACS's and runs to 488 entries, so a hardcoded "84600" here would silently stop testing
   * anything the day the list is regenerated without it.
   */
  describe("remote areas", () => {
    const standardSetting = DEFAULTS.rates.find((rate) => rate.id === "standard")!;
    const remote = standardSetting.remoteAreas!;
    const aRemoteCode = remote.postalCodes[0];

    it("charges the remote price for a postal code on the list", () => {
      const rate = buildShippingRates(DEFAULTS, "EUR", aRemoteCode).find((r) => r.id === "standard")!;
      expect(rate.price.amount).toBe(remote.amount);
    });

    it("charges the ordinary price for a postal code that is not", () => {
      // Heraklion, where the shop itself is, and deliberately absent from ACS's remote list.
      const rate = buildShippingRates(DEFAULTS, "EUR", "71202").find((r) => r.id === "standard")!;
      expect(rate.price.amount).toBe(standardSetting.amount);
      expect(remote.amount).not.toBe(standardSetting.amount);
    });

    it("charges the ordinary price when there is no address yet", () => {
      // The cart, which prices before anyone has said where it is going and labels it an
      // estimate. Quoting the surcharge to everyone on the chance they live on an island
      // would overstate the total for almost every shopper.
      const rate = buildShippingRates(DEFAULTS).find((r) => r.id === "standard")!;
      expect(rate.price.amount).toBe(standardSetting.amount);
    });

    it("matches a postal code written with a space, as Greek addresses often are", () => {
      const spaced = `${aRemoteCode.slice(0, 3)} ${aRemoteCode.slice(3)}`;
      const rate = buildShippingRates(DEFAULTS, "EUR", spaced).find((r) => r.id === "standard")!;
      expect(rate.price.amount).toBe(remote.amount);
    });

    it("leaves rates with no remote list on one price everywhere", () => {
      const pickup = buildShippingRates(DEFAULTS, "EUR", aRemoteCode).find((r) => r.id === "pickup")!;
      expect(pickup.price.amount).toBe(DEFAULTS.rates.find((r) => r.id === "pickup")!.amount);
    });

    it("still delivers free over the threshold to a remote address", () => {
      // The owner's decision on 2026-09-07: the threshold clears the whole charge, remote or
      // not, so "Δωρεάν αποστολή άνω των 100 €" needs no asterisk.
      const rate = buildShippingRates(DEFAULTS, "EUR", aRemoteCode).find((r) => r.id === "standard")!;
      expect(computeShippingChargeForRate(rate, THRESHOLD, true)).toBe(0);
      expect(computeShippingChargeForRate(rate, THRESHOLD - 1, true)).toBe(remote.amount);
    });
  });

  it("carries no threshold at all when free shipping is switched off", () => {
    const settings: ShippingSettings = { ...DEFAULTS, freeShippingThreshold: null };
    const standard = buildShippingRates(settings).find((rate) => rate.id === "standard")!;
    expect(standard.freeOverAmount).toBeNull();
    expect(computeShippingChargeForRate(standard, 10_000, true)).toBe(standard.price.amount);
  });
});

describe("resolveShippingRate", () => {
  it("returns the picked rate", () => {
    expect(resolveShippingRate(RATES, "express")?.id).toBe("express");
  });

  it("falls back to the first rate for an unknown or absent id", () => {
    // A rate can be disabled between a cart being built and its checkout completing; the
    // order still has to price against something rather than throwing at the till.
    expect(resolveShippingRate(RATES, "no-such-rate")?.id).toBe("standard");
    expect(resolveShippingRate(RATES)?.id).toBe("standard");
  });

  it("returns undefined when no rate is configured at all", () => {
    expect(resolveShippingRate([], "standard")).toBeUndefined();
  });
});

describe("computeShippingChargeForRate", () => {
  it("charges Express its full listed price even over the free-shipping threshold", () => {
    expect(computeShippingChargeForRate(EXPRESS, THRESHOLD + 50, true)).toBe(EXPRESS.price.amount);
  });

  it("charges Standard under the threshold", () => {
    expect(computeShippingChargeForRate(STANDARD, THRESHOLD - 1, true)).toBe(STANDARD.price.amount);
  });

  it("regression: an explicitly selected Standard rate stays free at/over the threshold (past revenue bug — see PROGRESS.md)", () => {
    expect(computeShippingChargeForRate(STANDARD, THRESHOLD, true)).toBe(0);
    expect(computeShippingChargeForRate(STANDARD, THRESHOLD + 50, true)).toBe(0);
  });

  it("is free with no active items regardless of rate", () => {
    expect(computeShippingChargeForRate(EXPRESS, 500, false)).toBe(0);
  });
});
