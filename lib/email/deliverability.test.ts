import { describe, expect, it } from "vitest";
import { isUndeliverableAddress } from "@/lib/email/deliverability";

/**
 * The guard has to be right in BOTH directions, and the two failures are not equally bad.
 *
 * A missed test address costs one hard bounce. A real customer wrongly classified costs them
 * their order confirmation, silently, with an `EmailLog` row absent and nothing to notice it
 * by — so the false-positive cases below matter more than the ones they look like padding
 * next to.
 */
describe("isUndeliverableAddress", () => {
  it("catches the address the e2e suite actually leaves in production", () => {
    expect(isUndeliverableAddress("e2e-test@example.com")).toBe(true);
  });

  it.each([
    "someone@example.com",
    "someone@example.net",
    "someone@example.org",
    "someone@anything.test",
    "someone@box.invalid",
    "someone@dev.localhost",
    "someone@my.example",
  ])("refuses %s", (address) => {
    expect(isUndeliverableAddress(address)).toBe(true);
  });

  it("refuses subdomains of a reserved domain", () => {
    expect(isUndeliverableAddress("someone@mail.example.com")).toBe(true);
  });

  it("is case- and whitespace-insensitive, because form input is neither", () => {
    expect(isUndeliverableAddress("  E2E-Test@Example.COM  ")).toBe(true);
  });

  /**
   * The important half. Every one of these is a domain a real Greek customer could plausibly
   * hold, and several are near-misses chosen to break a sloppier `includes("example")` or
   * `endsWith("test")` rule.
   */
  it.each([
    "maria@gmail.com",
    "kostas@otenet.gr",
    "info@alexandrisstores.gr",
    "someone@example.com.gr",
    "someone@examples.com",
    "someone@myexample.com",
    "someone@protest.com",
    "someone@contest.gr",
    "someone@invalidation.com",
    "test@gmail.com",
  ])("allows %s", (address) => {
    expect(isUndeliverableAddress(address)).toBe(false);
  });

  it("does not throw on malformed input", () => {
    expect(isUndeliverableAddress("")).toBe(false);
    expect(isUndeliverableAddress("not-an-email")).toBe(false);
  });
});
