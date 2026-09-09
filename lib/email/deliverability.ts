/**
 * Addresses that can never receive mail, and must therefore never be mailed.
 *
 * `example.com`, `example.net` and `example.org` are reserved by RFC 2606 and the TLDs
 * `.test`, `.example`, `.invalid` and `.localhost` by RFC 2606/6761, precisely so they can be
 * used in documentation and tests without colliding with anything real. None of them has an
 * MX record and none of them ever will, so a message addressed there is a guaranteed hard
 * bounce.
 *
 * That matters more than "a wasted API call". Mailbox providers score a sender on its bounce
 * rate, and Resend suspends accounts that accumulate them — so a test address in a real
 * sending path is a slow leak in the shop's ability to deliver order confirmations. The cost
 * lands on real customers' mail, not on the test.
 *
 * This is not hypothetical here. The e2e suite runs against **production** by design
 * (playwright.config.ts explains why), and its checkout spec fills `e2e-test@example.com`.
 * A day later the abandoned-cart cron finds that cart, resolves the address from the
 * checkout, and mails it: four such sends went out on 2026-09-07 at 08:56 UTC. It is also the
 * second time test data has reached a live business flow in this shop — `QA-012` was six
 * `example.com` orders adding EUR 1,196.43 of revenue that was never taken.
 *
 * Deliberately a fixed list of reserved names rather than a "looks like a test" heuristic.
 * Anything cleverer eventually refuses to mail a real customer, which is a far worse failure
 * than sending one bounce, and these names are undeliverable by standard rather than by
 * guess.
 */

const RESERVED_DOMAINS = ["example.com", "example.net", "example.org"];
const RESERVED_TLDS = [".test", ".example", ".invalid", ".localhost"];

export function isUndeliverableAddress(address: string): boolean {
  const domain = address.trim().toLowerCase().split("@").pop();
  if (!domain) return false;

  // Subdomains count: mail.example.com is as undeliverable as example.com.
  return (
    RESERVED_DOMAINS.some((reserved) => domain === reserved || domain.endsWith(`.${reserved}`)) ||
    RESERVED_TLDS.some((tld) => domain.endsWith(tld))
  );
}
