import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { code128Widths } from "../client/src/lib/code128";
import { login } from "./helpers";

/**
 * A fake webcam that shows a Code 128 label for SKU STL-001, as a Y4M video Chromium can play as
 * its camera. Lets the camera scanner (BarcodeDetector or the bundled ZXing fallback) run for real.
 */
function barcodeVideo(text: string) {
  const W = 640;
  const H = 480;
  const MODULE = 3;
  const widths = code128Widths(text);
  const luma = Buffer.alloc(W * H, 235);
  let x = Math.round((W - widths.reduce((a, b) => a + b, 0) * MODULE) / 2);
  widths.forEach((w, i) => {
    if (i % 2 === 0) for (let dx = 0; dx < w * MODULE; dx++) for (let row = 150; row < 330; row++) luma[row * W + x + dx] = 16;
    x += w * MODULE;
  });
  const frame = Buffer.concat([Buffer.from("FRAME\n"), luma, Buffer.alloc(W * H / 2, 128)]);
  const dir = path.join(tmpdir(), "stocksense-e2e");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${text}.y4m`);
  writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F30:1 Ip A1:1 C420jpeg\n`), frame, frame]));
  return file;
}

test.describe("camera scanning", () => {
  test.use({
    permissions: ["camera"],
    launchOptions: {
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${barcodeVideo("STL-001")}`],
    },
  });

  test("reads a label through the camera and opens the product", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: "Scan a barcode" }).click();
    await page.getByRole("button", { name: "Use camera" }).click();
    await expect(page).toHaveURL(/\/products\/[0-9a-f-]+$/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Steel Rods" })).toBeVisible();
  });
});

test("header toggle switches light and dark, in sync with the account menu", async ({ page }) => {
  await login(page);
  const surface = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  expect(await surface()).toBe("rgb(22, 22, 22)");
  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(page.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "Light" }).click();
  expect(await surface()).toBe("rgb(255, 255, 255)");
  await expect(page.getByRole("button", { name: "Switch to dark mode" })).toBeVisible();
});

test("categories open to show their products", async ({ page }) => {
  await login(page);
  await page.goto("/products/categories");
  const furniture = page.getByRole("button", { name: /^Furniture \d+ products?$/ });
  await expect(furniture).toHaveAttribute("aria-expanded", "false");
  await furniture.click();
  await expect(furniture).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("link", { name: /Oak Work Desk/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Steel Rods/ })).toBeHidden();
});

test("a manager adds a product photo and it shows in the catalog", async ({ page }) => {
  await login(page);
  await page.goto("/products");
  await page.getByRole("link", { name: /Hex Bolts M8/ }).first().click();
  await page.getByLabel("Product photo").setInputFiles(path.join(__dirname, "../client/public/icon-192.png"));
  await expect(page.getByText("Photo updated")).toBeVisible();
  await page.goto("/products");
  const img = page.getByRole("link", { name: /Hex Bolts M8/ }).locator("img");
  await expect(img).toHaveAttribute("src", /\/api\/products\/[0-9a-f-]+\/image\?v=\d+/);
  expect(await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
});

test("warehouses show a map with directions", async ({ page }) => {
  await login(page);
  await page.goto("/settings/warehouses");
  await expect(page.locator('iframe[title="Map of Main Warehouse"]')).toHaveAttribute("src", /openstreetmap\.org\/export\/embed\.html.*marker=18\.6298,73\.8478/);
  const directions = page.getByRole("link", { name: "Directions" }).first();
  await expect(directions).toHaveAttribute("href", "https://www.google.com/maps/dir/?api=1&destination=18.6298%2C73.8478");
});

test("exports follow the page's filters", async ({ page }) => {
  await login(page);
  await page.goto("/products");
  await page.getByLabel("Category").selectOption({ label: "Furniture" });
  await expect(page.getByText("2 products")).toBeVisible();
  await page.getByRole("button", { name: "Export" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: /CSV/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/^stocksense-products-\d{4}-\d{2}-\d{2}\.csv$/);
  const rows = readFileSync(await download.path(), "utf8").trim().split("\r\n");
  expect(rows).toHaveLength(3); // header + 2 furniture products
  expect(rows.slice(1).every((r) => r.includes(",Furniture,"))).toBe(true);
});

test("the data export page downloads everything as a ZIP", async ({ page }) => {
  await login(page);
  await page.goto("/settings/export");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download ZIP" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^stocksense-export-.*\.zip$/);
  const zip = readFileSync(await download.path());
  expect(zip.subarray(0, 4).toString("hex")).toBe("504b0304");
});
