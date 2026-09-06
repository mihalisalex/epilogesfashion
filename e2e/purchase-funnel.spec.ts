import { test, expect } from "@playwright/test";
import { BUY_NAME, PRODUCT, SIZE_NAME, cartBadge, dismissConsent } from "./helpers";

/**
 * Browse → product → size → cart. The path every order travels, and the one nothing else
 * in this repo exercises.
 *
 * Stops before placing an order: without a test database that would write a real order and
 * move real stock. What it does cover is everything up to that point, which is where the
 * bugs the merchant actually reported lived.
 */

test.describe("the purchase funnel", () => {
  test("a shopper can go from the homepage to a product page", async ({ page }) => {
    await page.goto("/");
    await dismissConsent(page);

    // The homepage's job is to show product. If the grid is empty the shop is broken in a
    // way no unit test would notice.
    const productLinks = page.locator('a[href^="/products/"]');
    await expect(productLinks.first()).toBeVisible();
    expect(await productLinks.count()).toBeGreaterThan(2);

    await productLinks.first().click();
    await expect(page).toHaveURL(/\/products\//);

    /**
     * `:visible` is load-bearing, and the reason is worth recording.
     *
     * After a client-side navigation the router keeps the previous page in the DOM as a second
     * `<main>` with `display: none`. So a product page reached by clicking really does carry two
     * `<h1>` elements — the product's and the homepage's hero — and a bare `page.locator("h1")`
     * fails strict mode. Scoping to `main` does not help; both are inside one.
     *
     * That is not a defect, and it was checked rather than assumed: the hidden ancestor is
     * `display: none`, which removes it from the accessibility tree, and the server-rendered
     * HTML for the same URL contains exactly one `<h1>`. Neither a screen reader nor a crawler
     * ever sees two. Only a DOM query does.
     *
     * Asserting on the visible heading is therefore both the correct fix and closer to what the
     * test means: the shopper can see the product's title.
     */
    await expect(page.locator("main h1:visible")).toBeVisible();
  });

  test("the product page shows a price, a SKU and sizes", async ({ page }) => {
    await page.goto(PRODUCT);
    await dismissConsent(page);

    await expect(page.locator("h1")).toBeVisible();
    // Euro amount somewhere on the page — the merchant reported a PDP that showed the wrong
    // price shape when a product was on sale, so this is a regression guard, not a smoke test.
    await expect(page.getByText(/€/).first()).toBeVisible();

    /**
     * SKU visibility was one of the four PDP bugs reported from a real browser: it was
     * rendered nowhere at all. Pinned here because it is invisible to every other test.
     */
    await expect(page.getByText(/\b\d{3,}(-\d+)?\b/).first()).toBeVisible();

    // Sizes render as buttons, and at least one must be selectable or nothing can be bought.
    // See SIZE_NAME in ./helpers for why the locator is shaped the way it is — a low-stock
    // badge folds into the accessible name and quietly breaks the obvious version.
    const sizes = page.getByRole("button", { name: SIZE_NAME });
    // toBeVisible auto-waits; count() does not, and the purchase panel hydrates client-side.
    await expect(sizes.first()).toBeVisible();
    expect(await sizes.count()).toBeGreaterThan(0);
  });

  test("the buy button refuses until a size is chosen, then adds to the cart", async ({ page }) => {
    await page.goto(PRODUCT);
    await dismissConsent(page);

    /**
     * The disabled state is the real assertion. An add-to-cart that accepts a null size is
     * how an unfulfillable order gets placed — the shop cannot ship "a loafer" without a size.
     */
    const cta = page.getByRole("button", { name: BUY_NAME });
    await expect(cta).toBeDisabled();

    const size = page.getByRole("button", { name: SIZE_NAME }).first();
    await expect(size).toBeVisible();
    await size.click();
    await expect(size).toHaveAttribute("aria-pressed", "true");

    await expect(cta).toBeEnabled();
    await expect(cta).toHaveText(/προσθήκη στο καλάθι/i);

    /**
     * Clicked immediately, with NO settle — this is the regression test for BUG-002.
     *
     * Before the fix, a click landing before the cart bootstrap resolved was silently
     * discarded: `CartProvider` opened every mutation with `if (!cart) return`, and `cart` is
     * null until `getOrCreateCart` comes back. No request, no error, no toast — the button
     * simply appeared not to work. Mutations now await the bootstrap instead of bailing.
     *
     * If a `waitForTimeout` ever reappears above this line, the bug is back and someone has
     * papered over it.
     */
    await cta.click();

    /**
     * The count badge on the header cart button is the confirmation a shopper actually gets.
     * The drawer does NOT open by itself — asserting on a dialog looks reasonable and fails
     * against the real app, which is how this assertion was written wrong the first time.
     *
     * Generous timeout, and measured rather than guessed: the cart bootstrap is a round trip
     * to a serverless function and Neon, and on a cold start it has been observed taking well
     * past twenty seconds. 20s failed intermittently on mobile; 45s does not.
     *
     * That latency is also why BUG-002 mattered as much as it did — the slower the bootstrap,
     * the wider the window in which a click was silently thrown away.
     */
    await expect(cartBadge(page)).toHaveText("1", { timeout: 45_000 });

    // And the cart survives navigation — the id is persisted in localStorage, so a shopper
    // who browses on and comes back still has their bag.
    await page.goto("/cart");
    await expect(page.locator("#main").getByRole("link", { name: /loafer/i }).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test("an unknown product slug 404s rather than erroring", async ({ page }) => {
    /**
     * KNOWN FAILURE, deliberately left visible — see `SEO-002` in AUDIT.md.
     *
     * This asserted 404 and passed until Cache Components was enabled (`34629b3`). It now gets
     * **200**, because a route with a prerendered shell has already committed its status line
     * before `notFound()` runs. Next's own guide states the constraint plainly: "Once streaming
     * begins, the HTTP response headers (including the status code) have already been sent […]
     * If a `notFound()` fires mid-stream, Next.js cannot go back and change the status to 404."
     *
     * `test.fail()` rather than a weakened assertion. The expectation is still correct and the
     * suite stays green, but the defect stays on the report — and if it is ever fixed, Playwright
     * fails loudly with "expected to fail but passed" rather than quietly agreeing with whatever
     * the app now does.
     */
    test.fail();
    const response = await page.goto("/products/this-product-does-not-exist-xyz");
    expect(response?.status()).toBe(404);
  });

  test("an unknown product slug is at least kept out of the index", async ({ page }) => {
    /**
     * The mitigation for the above, pinned separately so the two cannot regress together.
     *
     * Next injects `<meta name="robots" content="noindex">` when `notFound()` fires mid-stream,
     * which is what stops a soft 404 becoming an indexed phantom page. That mitigation is the
     * only reason `SEO-002` is a defect rather than an emergency, so it is worth its own test:
     * if it ever stops being emitted, the 200 suddenly matters a great deal more.
     */
    await page.goto("/products/this-product-does-not-exist-xyz");
    await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(1);
  });
});

test.describe("regressions that only a browser can catch", () => {
  test("the skip link is the first focusable element and becomes visible", async ({ page }) => {
    /**
     * A11Y-001. `sr-only` until focused is the whole point — hidden outright would leave a
     * sighted keyboard user with focus they cannot see. Only a real browser can tell the
     * difference between "in the DOM" and "actually reachable and visible on focus".
     */
    await page.goto("/");

    /**
     * Deliberately does NOT dismiss the consent banner first.
     *
     * Clicking anything moves the browser's sequential-focus origin to the clicked element,
     * and Chromium resumes tabbing from there — so after dismissing the banner the first Tab
     * lands on the header logo, having already passed the skip link. Neither blurring nor
     * focusing <body> resets that origin. Tabbing on a freshly loaded page is the only way to
     * ask the question the test is actually asking.
     */
    await page.keyboard.press("Tab");
    const focused = page.locator(":focus");
    await expect(focused).toHaveAttribute("href", "#main");
    await expect(focused).toBeVisible();
  });

  test("every main landmark the skip link targets actually exists", async ({ page }) => {
    // The skip link is worthless if #main is missing on the page being viewed.
    for (const path of ["/", PRODUCT, "/cart", "/women"]) {
      await page.goto(path);
      await expect(page.locator("#main")).toHaveCount(1);
    }
  });

  test("no Content-Security-Policy violations are reported", async ({ page }) => {
    /**
     * SEC-005 was a CSP bug found by *reading a live browser console* — `**.` is valid in
     * next/image remotePatterns and invalid in CSP, so the browser silently discarded the
     * whole img-src entry and every Instagram image was blocked. Nothing server-side noticed.
     *
     * This is the test that would have caught it.
     */
    const violations: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      if (/Content Security Policy|Refused to (load|execute|apply)/i.test(text)) {
        violations.push(text);
      }
    });

    await page.goto("/");
    await dismissConsent(page);
    await page.waitForLoadState("load");
    // A brief settle rather than networkidle: this page keeps connections open, so
    // networkidle never fires and the test times out instead of asserting anything.
    await page.waitForTimeout(2000);

    expect(violations, `CSP violations on the homepage:\n${violations.join("\n")}`).toHaveLength(0);
  });

  test("the homepage loads without page errors", async ({ page }) => {
    // An uncaught client exception is invisible server-side and to every unit test.
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/");
    await dismissConsent(page);
    await page.waitForLoadState("load");
    // A brief settle rather than networkidle: this page keeps connections open, so
    // networkidle never fires and the test times out instead of asserting anything.
    await page.waitForTimeout(2000);

    expect(errors, `Uncaught page errors:\n${errors.join("\n")}`).toHaveLength(0);
  });

  test("the health endpoint reports the database as reachable", async ({ request }) => {
    // OBS-001's other half. Cheap here, and it makes a Neon outage fail the suite loudly.
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
  });
});
