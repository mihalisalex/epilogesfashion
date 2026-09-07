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
      const rate = buildShippingRates(DEFAULTS, "EUR", { postalCode: aRemoteCode }).find((r) => r.id === "standard")!;
      expect(rate.price.amount).toBe(remote.amount);
    });

    it("charges the ordinary price for a postal code that is not", () => {
      // Heraklion, where the shop itself is, and deliberately absent from ACS's remote list.
      const rate = buildShippingRates(DEFAULTS, "EUR", { postalCode: "71202" }).find((r) => r.id === "standard")!;
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
      const rate = buildShippingRates(DEFAULTS, "EUR", { postalCode: spaced }).find((r) => r.id === "standard")!;
      expect(rate.price.amount).toBe(remote.amount);
    });

    it("leaves rates with no remote list on one price everywhere", () => {
      const pickup = buildShippingRates(DEFAULTS, "EUR", { postalCode: aRemoteCode }).find((r) => r.id === "pickup")!;
      expect(pickup.price.amount).toBe(DEFAULTS.rates.find((r) => r.id === "pickup")!.amount);
    });

    it("still delivers free over the threshold to a remote address", () => {
      // The owner's decision on 2026-09-07: the threshold clears the whole charge, remote or
      // not, so "Δωρεάν αποστολή άνω των 100 €" needs no asterisk.
      const rate = buildShippingRates(DEFAULTS, "EUR", { postalCode: aRemoteCode }).find((r) => r.id === "standard")!;
      expect(computeShippingChargeForRate(rate, THRESHOLD, true)).toBe(0);
      expect(computeShippingChargeForRate(rate, THRESHOLD - 1, true)).toBe(remote.amount);
    });
  });

  /**
   * Destination scope. Getting this wrong is not a display bug: it decides whether an ACS
   * domestic voucher can be bought for an address in Portugal, and whether a Greek shopper is
   * offered a 14,95 EUR EU rate they should never see.
   */
  describe("destination scope", () => {
    const idsFor = (countryCode: string) =>
      buildShippingRates(DEFAULTS, "EUR", { countryCode }).filter((rate) => rate.available !== false).map((rate) => rate.id);

    it("offers the Greek options in Greece and not the EU one", () => {
      const ids = idsFor("GR");
      expect(ids).toContain("standard");
      expect(ids).toContain("pickup");
      expect(ids).not.toContain("eu-standard");
    });

    it("offers only the EU rate to another EU country", () => {
      const ids = idsFor("PT");
      expect(ids).toEqual(["eu-standard"]);
    });

    it("keeps out-of-scope rates in the list, marked unavailable, so the step can grey them out", () => {
      const rates = buildShippingRates(DEFAULTS, "EUR", { countryCode: "PT" });
      expect(rates.find((rate) => rate.id === "standard")?.available).toBe(false);
      expect(rates.find((rate) => rate.id === "eu-standard")?.available).toBe(true);
    });

    it("treats every rate as available before an address exists", () => {
      // The cart. Hiding options here would be guessing at an address nobody has given.
      expect(buildShippingRates(DEFAULTS).every((rate) => rate.available !== false)).toBe(true);
    });

    it("is case- and whitespace-insensitive about the country code", () => {
      expect(idsFor(" pt ")).toEqual(["eu-standard"]);
    });

    it("never resolves a rate the destination cannot use, however it is asked for", () => {
      // The enforcement that matters: the id arrives in a request, and a disabled radio in the
      // browser stops nobody. Asking for the Greek rate with a Portuguese address must not
      // return it — and must not silently fall through to it either.
      const rates = buildShippingRates(DEFAULTS, "EUR", { countryCode: "PT" });
      expect(resolveShippingRate(rates, "standard")?.id).toBe("eu-standard");
      expect(resolveShippingRate(rates)?.id).toBe("eu-standard");
    });

    it("does not apply Greek remote-area pricing to a foreign postal code that happens to match", () => {
      // Postal codes are not globally unique, and 84600 exists outside Greece too.
      const remoteCode = DEFAULTS.rates.find((rate) => rate.id === "standard")!.remoteAreas!.postalCodes[0];
      const rate = buildShippingRates(DEFAULTS, "EUR", { countryCode: "PT", postalCode: remoteCode }).find(
        (r) => r.id === "eu-standard"
      )!;
      expect(rate.price.amount).toBe(DEFAULTS.rates.find((r) => r.id === "eu-standard")!.amount);
    });

    it("charges the EU rate in full over the free-shipping threshold", () => {
      // Deliberate: the domestic promise is domestic. constants/countries.ts warned for months
      // that shipping abroad free over the threshold loses money on every order.
      const rate = buildShippingRates(DEFAULTS, "EUR", { countryCode: "PT" }).find((r) => r.id === "eu-standard")!;
      expect(rate.freeOverAmount).toBeNull();
      expect(computeShippingChargeForRate(rate, THRESHOLD + 500, true)).toBe(rate.price.amount);
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
