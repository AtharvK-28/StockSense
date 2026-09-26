import { expect, test } from "@playwright/test";
import { login, onHandOf, pickProduct, scan } from "./helpers";

test.describe.configure({ mode: "serial" });

test("receiving stock through a receipt updates on-hand", async ({ page }) => {
  await login(page);
  const before = await onHandOf(page, "Hex Bolts M8");

  await page.goto("/operations/receipts/new");
  await page.getByLabel("Receive from").fill("Bolt Suppliers");
  await pickProduct(page, "Hex Bolts M8");
  await page.locator('input[aria-label="Quantity"]:visible').fill("15");
  await page.getByRole("button", { name: "Save & mark as To Do" }).click();
  await page.getByRole("button", { name: "Validate", exact: true }).click();
  await expect(page.getByText("Received — stock increased")).toBeVisible();
  await expect(page.getByText("Stock ledger entries")).toBeVisible();

  expect(await onHandOf(page, "Hex Bolts M8")).toBe(before + 15);
});

test("a partial receipt creates a backorder for the rest", async ({ page }) => {
  await login(page);
  await page.goto("/operations/receipts?status=ready");
  await page.locator("tbody tr").first().click();
  const received = page.locator('input[aria-label^="Received quantity"]:visible').first();
  const demand = Number(await received.inputValue());
  await received.fill(String(demand - 5));
  await page.getByRole("button", { name: "Validate", exact: true }).click();
  await expect(page.getByText("Create a backorder?")).toBeVisible();
  await page.getByRole("button", { name: "Create backorder" }).click();
  await expect(page.getByText(/backorder .* created for the rest/)).toBeVisible();
  await page.getByRole("link", { name: /WH\/IN\// }).filter({ hasText: /Ready/ }).first().click();
  await expect(page.locator('input[aria-label^="Received quantity"]:visible').first()).toHaveValue("5");
});

test("a delivery waits for stock and must be picked and packed", async ({ page }) => {
  await login(page);
  await page.goto("/operations/deliveries/new");
  await page.getByLabel("Deliver to (contact)").fill("E2E Customer");
  await pickProduct(page, "Ergonomic Office Chair");
  await page.locator('input[aria-label="Quantity"]:visible').fill("2");
  await page.getByRole("button", { name: "Save & mark as To Do" }).click();
  await page.getByRole("button", { name: "Mark as picked" }).click();
  await page.getByRole("button", { name: "Mark as packed" }).click();
  await page.getByRole("button", { name: "Validate", exact: true }).click();
  await expect(page.getByText("Shipped — stock reduced")).toBeVisible();

  // Returning it brings the stock back.
  await page.getByRole("button", { name: "Return" }).click();
  await expect(page.getByText(/Return .* started/)).toBeVisible();
  await expect(page.getByText("Return of", { exact: true })).toBeVisible();
});

test("staff counts need a manager's approval", async ({ browser }) => {
  const staff = await (await browser.newContext()).newPage();
  await login(staff, "meena.staff");
  await staff.goto("/stock");
  await staff.locator("tr", { hasText: "Aluminium Sheets" }).getByRole("button", { name: "Count" }).click();
  await staff.getByLabel(/New quantity/).fill("100");
  await staff.getByLabel("Reason").fill("E2E count");
  await staff.getByRole("button", { name: "Submit for approval" }).click();
  await expect(staff.getByText("Count sent for approval")).toBeVisible();
  await expect(staff.getByRole("link", { name: "Team" })).toHaveCount(0);

  const manager = await (await browser.newContext()).newPage();
  await login(manager);
  await expect(manager.getByText("Awaiting your approval")).toBeVisible();
  await manager.locator("li", { hasText: "Aluminium Sheets" }).getByText("Review").click();
  await manager.getByRole("button", { name: "Approve & apply" }).click();
  await expect(manager.getByText("Adjustment applied")).toBeVisible();
  expect(await onHandOf(manager, "Aluminium Sheets")).toBe(100);
});

test("scanning adds products to a draft", async ({ page }) => {
  await login(page);
  await page.goto("/operations/receipts/new");
  await page.getByRole("button", { name: "Scan", exact: true }).click();
  await scan(page, "STL-001");
  await scan(page, "STL-001");
  await scan(page, "FUR-101");
  await scan(page, "NOPE-000");
  await expect(page.getByText("No product with SKU NOPE-000")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.locator('input[aria-label="Quantity"]:visible')).toHaveCount(2);
  await expect(page.locator('input[aria-label="Quantity"]:visible').first()).toHaveValue("2");
});

test("analytics and valuation render from the ledger", async ({ page }) => {
  await login(page);
  await page.goto("/analytics");
  await expect(page.getByRole("img", { name: "Stock value" })).toBeVisible();
  await expect(page.getByText("Top movers")).toBeVisible();
  await page.getByRole("button", { name: /Valuation report/ }).click();
  await expect(page.getByText("Stock valuation by product")).toBeVisible();
});
