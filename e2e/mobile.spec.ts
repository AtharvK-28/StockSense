import { expect, test } from "@playwright/test";
import { login } from "./helpers";

// Runs in the "mobile" project (Pixel 7 viewport).

const PAGES = ["/", "/operations/deliveries", "/operations/receipts", "/stock", "/products", "/products/categories", "/analytics", "/moves", "/settings/warehouses", "/settings/export", "/profile"];

test("no page scrolls sideways on a phone", async ({ page }) => {
  await login(page);
  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, `${path} overflows horizontally`).toBeLessThanOrEqual(clientWidth);
  }
});

test("operations show as cards on a phone", async ({ page }) => {
  await login(page);
  await page.goto("/operations/deliveries");
  await expect(page.locator("table").first()).toBeHidden();
  await expect(page.locator("ul li a", { hasText: "WH/OUT/" }).first()).toBeVisible();
});

test("dark mode follows the OS and can be overridden", async ({ browser }) => {
  const page = await (await browser.newContext({ colorScheme: "dark", viewport: { width: 1280, height: 800 } })).newPage();
  await login(page);
  const surface = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(await surface()).toBe("rgb(22, 22, 22)");
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("radio", { name: "Light" }).click();
  expect(await surface()).toBe("rgb(255, 255, 255)");
});

test("the header fits between phone and desktop widths", async ({ page }) => {
  await login(page);
  for (const width of [640, 700, 768, 900, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, `header overflows at ${width}px`).toBeLessThanOrEqual(width);
  }
});
