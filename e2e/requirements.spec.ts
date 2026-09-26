import { type Page, expect, test } from "@playwright/test";
import { login, onHandOf, pickProduct } from "./helpers";

/**
 * Requirements traceability: one test per section of the organizers' brief (docs/StockSense.md)
 * and their mockups (docs/excalidrawMockup). Auth rules are covered in auth.spec.ts.
 */

test.describe.configure({ mode: "serial" });

const STEEL = { name: "Brief Steel", sku: "BRF-STL" };

/** Saves the open draft as To Do and waits for the given button to appear. */
async function markToDo(page: Page, next = "Validate") {
  await page.getByRole("button", { name: "Save & mark as To Do" }).click();
  await expect(page.getByRole("button", { name: next, exact: true })).toBeVisible();
}

async function validated(page: Page) {
  await expect(page.getByText("Stock ledger entries")).toBeVisible();
}

async function stockAt(page: Page, location: string) {
  await page.goto("/products");
  await page.getByRole("link", { name: new RegExp(STEEL.name) }).first().click();
  await expect(page.getByText(/locations? holds?|No stock anywhere/)).toBeVisible();
  const row = page.locator("li", { hasText: location }).filter({ hasText: "updated" });
  if ((await row.count()) === 0) return 0;
  return Number((await row.locator("p.font-semibold").last().innerText()).replace(/[^\d.]/g, ""));
}

test("Navigation: every section in the brief and mockups is reachable from the left sidebar", async ({ page }) => {
  await login(page);
  const nav = page.getByRole("navigation");
  for (const [label, heading] of [
    ["Dashboard", /Good (morning|afternoon|evening)/],
    ["Receipts", "Receipts"],
    ["Deliveries", "Deliveries"],
    ["Internal transfers", "Internal transfers"],
    ["Adjustments", "Adjustments"],
    ["All products", "Products"],
    ["Stock", "Stock"],
    ["Categories", "Product categories"],
    ["Reordering rules", /Reordering rules/],
    ["Move history", "Move history"],
    ["Warehouses", "Warehouses"],
    ["Locations", "Locations"],
  ] as const) {
    await nav.getByRole("link", { name: label, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  }
  // Profile menu (left sidebar): My Profile, Logout.
  await page.locator("aside").first().getByRole("button", { name: /Rakesh Mehta/ }).click();
  await page.locator("aside").first().getByRole("link", { name: "My profile" }).click();
  await expect(page).toHaveURL("/profile");
  await page.locator("aside").first().getByRole("button", { name: /Rakesh Mehta/ }).click();
  await page.locator("aside").first().getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL("/login");
});

test("Dashboard: all five KPIs and every dynamic filter", async ({ page }) => {
  await login(page);
  // KPIs
  await expect(page.getByText("Products in stock")).toBeVisible();
  await expect(page.getByText("Low / out of stock")).toBeVisible();
  await expect(page.getByText(/\d+ to receive/)).toBeVisible(); // pending receipts
  await expect(page.getByText(/\d+ to deliver/)).toBeVisible(); // pending deliveries
  await expect(page.getByText("Internal transfers scheduled")).toBeVisible();

  // Filters: warehouse, location, category…
  await expect(page.getByLabel("Filter by warehouse")).toBeVisible();
  await expect(page.getByLabel("Filter by location")).toBeVisible();
  await expect(page.getByLabel("Filter by category")).toBeVisible();
  await page.getByLabel("Filter by warehouse").selectOption({ label: "Mumbai Depot" });
  await page.getByLabel("Filter by category").selectOption({ label: "Packaging" });

  // …document type and status.
  const overview = page.locator("section", { hasText: "Operations" }).last();
  for (const type of ["Receipts", "Deliveries", "Internal transfers", "Adjustments", "All"]) {
    await expect(page.getByRole("button", { name: type, exact: true }).first()).toBeVisible();
  }
  for (const status of ["Draft", "Waiting", "Ready", "Done", "Canceled"]) {
    await expect(overview.getByRole("button", { name: status, exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "Internal transfers", exact: true }).first().click();
  await overview.getByRole("button", { name: "Done", exact: true }).click();
  const refs = await page.locator("table tbody tr td:first-child").allInnerTexts();
  expect(refs.every((r) => /\/INT\//.test(r))).toBe(true);
});

test("Product management: name, SKU, category, unit of measure and optional initial stock", async ({ page }) => {
  await login(page);
  // Without initial stock.
  await page.goto("/products/new");
  await page.getByLabel("Product name").fill(STEEL.name);
  await page.getByLabel("SKU / code").fill(STEEL.sku);
  await page.getByLabel("Category").selectOption({ label: "Raw Materials" });
  await page.getByLabel("Unit of measure").fill("kg");
  await page.getByLabel("Reorder at (min)").fill("50");
  await page.getByRole("button", { name: "Create product" }).click();
  await expect(page.getByRole("heading", { level: 1, name: STEEL.name })).toBeVisible();
  expect(await onHandOf(page, STEEL.name)).toBe(0);

  // With initial stock, which is logged in the ledger.
  await page.goto("/products/new");
  await page.getByLabel("Product name").fill("Brief Washers");
  await page.getByLabel("SKU / code").fill("BRF-WSH");
  await page.getByLabel("Unit of measure").fill("Box");
  await page.getByLabel("Location").selectOption({ label: "Main Warehouse / Stock" });
  await page.getByLabel(/^Quantity/).fill("12");
  await page.getByRole("button", { name: "Create product" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Brief Washers" })).toBeVisible();
  expect(await onHandOf(page, "Brief Washers")).toBe(12);
  await page.goto("/moves");
  await page.getByLabel("Search moves").fill("BRF-WSH");
  await expect(page.locator("tbody tr")).toHaveCount(1);
});

test("Brief's inventory flow, step 1 — receive 100 kg from a vendor: stock +100", async ({ page }) => {
  await login(page);
  await page.goto("/operations/receipts/new");
  await page.getByLabel("Receive from").fill("Brief Vendor Co");
  await page.getByLabel("Receive into").selectOption({ label: "WH / Stock" });
  await expect(page.getByLabel("Responsible")).toHaveValue(/Rakesh/); // mockup: auto-filled with the logged-in user
  await pickProduct(page, STEEL.name);
  await page.locator('input[aria-label="Quantity"]:visible').fill("100");
  await markToDo(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^WH\/IN\/\d{4}$/); // <Warehouse>/<Operation>/<ID>
  await page.getByRole("button", { name: "Validate", exact: true }).click();
  await validated(page);
  await expect(page.getByRole("button", { name: "Print" })).toBeVisible(); // mockup: print once done
  expect(await onHandOf(page, STEEL.name)).toBe(100);
});

test("Step 2 — internal transfer Main Store → Production Rack: total unchanged, location updated", async ({ page }) => {
  await login(page);
  await page.goto("/operations/transfers/new");
  await page.getByRole("combobox", { name: "From", exact: true }).selectOption({ label: "WH / Stock" });
  await page.getByRole("combobox", { name: "To", exact: true }).selectOption({ label: "WH / Production Floor" });
  await pickProduct(page, STEEL.name);
  await page.locator('input[aria-label="Quantity"]:visible').fill("100");
  await markToDo(page);
  await page.getByRole("button", { name: "Validate", exact: true }).click();
  await validated(page);
  expect(await onHandOf(page, STEEL.name)).toBe(100);
  expect(await stockAt(page, "Production Floor")).toBe(100);
});

test("Step 3 — deliver 20: pick, pack, validate, stock −20", async ({ page }) => {
  await login(page);
  await page.goto("/operations/deliveries/new");
  await page.getByLabel("Deliver to (contact)").fill("Brief Frames Ltd");
  await page.getByLabel("Delivery address").fill("12 Industrial Estate, Pune");
  await page.getByLabel("Ship from").selectOption({ label: "WH / Production Floor" });
  await pickProduct(page, STEEL.name);
  await page.locator('input[aria-label="Quantity"]:visible').fill("20");
  await markToDo(page, "Mark as picked");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^WH\/OUT\/\d{4}$/);
  await page.getByRole("button", { name: "Mark as picked" }).click();
  await page.getByRole("button", { name: "Mark as packed" }).click();
  await page.getByRole("button", { name: "Validate", exact: true }).click();
  await validated(page);
  expect(await onHandOf(page, STEEL.name)).toBe(80);
});

test("Step 4 — 3 kg damaged: count the location, stock −3, logged as an adjustment", async ({ page }) => {
  await login(page);
  await page.goto("/operations/adjustments/new");
  await page.getByLabel("Location counted").selectOption({ label: "WH / Production Floor" });
  await pickProduct(page, STEEL.name);
  await page.locator('input[aria-label="Counted quantity"]:visible').fill("77");
  await expect(page.getByText(/^[−-]3$/).filter({ visible: true })).toBeVisible(); // recorded 80 vs counted 77
  await page.getByRole("button", { name: "Apply adjustment" }).click();
  await validated(page);
  expect(await onHandOf(page, STEEL.name)).toBe(77);
});

test("Everything is logged in the stock ledger (move history), ins in green and outs in red", async ({ page }) => {
  await login(page);
  await page.goto("/moves");
  await page.getByLabel("Search moves").fill(STEEL.name);
  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(5); // receipt, transfer out + in, delivery, adjustment
  const texts = await rows.allInnerTexts();
  const joined = texts.join("\n").replaceAll("−", "-");
  for (const change of [/\+100\b/, /-100\b/, /-20\b/, /-3\b/]) expect(joined).toMatch(change);
  await expect(page.locator("tbody tr.border-l-ok")).toHaveCount(2);
  await expect(page.locator("tbody tr.border-l-bad")).toHaveCount(3);
  // Mockup: columns, search by reference & contact, kanban view.
  for (const col of ["Reference", "Date", "Contact", "From", "To", "Quantity", "Status"]) {
    await expect(page.getByRole("columnheader", { name: col, exact: true })).toBeVisible();
  }
  await page.getByLabel("Search moves").fill("Brief Frames Ltd");
  await expect(rows).toHaveCount(1);
  await page.getByRole("button", { name: "Kanban" }).click();
  await expect(page.getByText("Brief Frames Ltd").first()).toBeVisible();
});

test("Internal transfers: Rack A → Rack B and Warehouse 1 → Warehouse 2", async ({ page }) => {
  await login(page);
  const move = async (from: string, to: string, qty: string) => {
    await page.goto("/operations/transfers/new");
    await page.getByRole("combobox", { name: "From", exact: true }).selectOption({ label: from });
    await page.getByRole("combobox", { name: "To", exact: true }).selectOption({ label: to });
    await pickProduct(page, STEEL.name);
    await page.locator('input[aria-label="Quantity"]:visible').fill(qty);
    await markToDo(page);
    await page.getByRole("button", { name: "Validate", exact: true }).click();
    await validated(page);
  };
  await move("WH / Production Floor", "WH / Rack A", "30");
  await move("WH / Rack A", "WH / Rack B", "30");
  await move("WH / Production Floor", "MUM / Stock", "10");
  expect(await onHandOf(page, STEEL.name)).toBe(77);
  expect(await stockAt(page, "Rack A")).toBe(0);
  expect(await stockAt(page, "Rack B")).toBe(30);
  await expect(page.locator("li", { hasText: "Mumbai Depot" }).filter({ hasText: "10" }).first()).toBeVisible();
});

test("Receipts and deliveries lists: mockup columns, search by reference & contact, list/kanban", async ({ page }) => {
  await login(page);
  for (const [path, contact] of [
    ["/operations/receipts", "Brief Vendor Co"],
    ["/operations/deliveries", "Brief Frames Ltd"],
  ] as const) {
    await page.goto(path);
    await page.getByRole("button", { name: /^All\b/ }).click();
    for (const col of ["Reference", "From", "To", "Contact", "Schedule date", "Status"]) {
      await expect(page.getByRole("columnheader", { name: new RegExp(col) }).first()).toBeVisible();
    }
    await page.getByLabel("Search").last().fill(contact);
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await page.getByRole("button", { name: "Kanban" }).click();
    await expect(page.getByText(contact).first()).toBeVisible();
  }
});

test("Deliveries without stock: the line turns red, an alert shows, and it waits", async ({ page }) => {
  await login(page);
  await page.goto("/operations/deliveries/new");
  await page.getByLabel("Deliver to (contact)").fill("Brief Waiting Co");
  await page.getByLabel("Ship from").selectOption({ label: "WH / Stock" });
  await pickProduct(page, STEEL.name); // none left in WH / Stock
  await page.locator('input[aria-label="Quantity"]:visible').fill("5");
  await expect(page.getByRole("alert").filter({ hasText: "not in stock" })).toBeVisible();
  await expect(page.locator("tr.bg-bad-50\\/70")).toHaveCount(1);
  await page.getByRole("button", { name: "Save & mark as To Do" }).click();
  await expect(page.getByLabel("Status").getByText("Waiting")).toBeVisible();
});

test("Stock page: per-unit cost, on hand, free to use, updated from the page", async ({ page }) => {
  await login(page);
  await page.goto("/stock");
  for (const col of ["Product", "Per unit cost", "On hand", "Free to use"]) {
    await expect(page.getByRole("columnheader", { name: col, exact: true })).toBeVisible();
  }
  await page.locator("tr", { hasText: STEEL.name }).getByRole("button", { name: "Update" }).click();
  await page.getByLabel("Location").selectOption({ label: "WH / Rack B" });
  await page.getByLabel(/New quantity/).fill("31");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Stock updated")).toBeVisible();
  expect(await onHandOf(page, STEEL.name)).toBe(78);
});

test("Settings: warehouse name, short code and address; locations", async ({ page }) => {
  await login(page);
  await page.goto("/settings/warehouses");
  await page.getByRole("button", { name: "New warehouse" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("Brief Warehouse 2");
  await dialog.getByLabel("Short code").fill("BW2");
  await dialog.getByLabel("Address").fill("Plot 9, Chakan MIDC, Pune");
  await dialog.getByRole("button", { name: "Create warehouse" }).click();
  await expect(page.getByRole("heading", { name: "Brief Warehouse 2" })).toBeVisible();
  await page.goto("/settings/locations");
  // Its default "Stock" location is listed under it.
  await expect(page.getByText(/Brief Warehouse 2|BW2/).filter({ visible: true }).first()).toBeVisible();
});

test("Additional features: low-stock alerts, SKU search, multi-warehouse", async ({ page }) => {
  await login(page);
  await expect(page.getByText("Low stock alerts")).toBeVisible();
  await page.getByRole("textbox", { name: "Search" }).fill(STEEL.sku);
  await expect(page.getByRole("button", { name: new RegExp(STEEL.name) })).toBeVisible();
  await page.getByLabel("Filter by warehouse").selectOption({ label: "Mumbai Depot" });
  await expect(page.getByLabel("Filter by warehouse")).toHaveValue(/.+/);
});
