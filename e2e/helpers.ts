import { type Page, expect } from "@playwright/test";

export const PASSWORD = "Demo@1234";

export async function login(page: Page, loginId = "manager", password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Login ID").fill(loginId);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
}

/** Types into the scan dialog the way a USB scanner does: the code, then Enter. */
export async function scan(page: Page, code: string) {
  await page.getByLabel("Barcode", { exact: true }).fill(code);
  await page.keyboard.press("Enter");
}

/** Picks a product in the first empty product picker. */
export async function pickProduct(page: Page, name: string) {
  const picker = page.locator('input[aria-label="Product"]:visible').last();
  await picker.click();
  await picker.fill(name);
  await page.locator("li", { hasText: name }).first().click();
}

/** Current total on hand shown on a product page. */
export async function onHandOf(page: Page, product: string) {
  await page.goto("/products");
  await page.getByRole("link", { name: new RegExp(product) }).first().click();
  const text = await page.getByText("Total on hand").locator("xpath=following-sibling::p[1]").innerText();
  return Number(text.replace(/[^\d.]/g, ""));
}
