import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { inflateRawSync } from "node:zlib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { resetDatabase } from "./helpers";

let server: Server;
let base: string;

beforeAll(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
beforeEach(resetDatabase);
afterAll(async () => {
  server.close();
  await prisma.$disconnect();
});

async function call(method: string, path: string, cookie: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function signup(loginId: string) {
  const res = await fetch(`${base}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ loginId, email: `${loginId}@test.dev`, password: "Secret@123" }),
  });
  return res.headers.get("set-cookie")!.split(";")[0]!;
}

async function team() {
  const manager = await signup("manager1");
  const staff = await signup("staffer1");
  await call("POST", "/warehouses", manager, { name: "Main", code: "WH" });
  const locationId = (await call("GET", "/locations", manager)).body.items[0].id;
  const product = await call("POST", "/products", manager, {
    name: "Steel, cold-rolled",
    sku: "STL-1",
    uom: "kg",
    unitCost: 12.5,
    initialStock: { locationId, quantity: 40 },
  });
  return { manager, staff, productId: product.body.product.id as string };
}

// 1×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const upload = (productId: string, cookie: string, body: Buffer) =>
  fetch(`${base}/products/${productId}/image`, { method: "PUT", headers: { "Content-Type": "image/png", Cookie: cookie }, body });

describe("product photos", () => {
  it("stores a photo, serves it at a versioned URL and removes it", async () => {
    const { manager, productId } = await team();
    const res = await upload(productId, manager, PNG);
    expect(res.status).toBe(200);
    const { imageUrl } = await res.json();
    expect(imageUrl).toMatch(new RegExp(`^/api/products/${productId}/image\\?v=\\d+$`));

    const list = await call("GET", "/products", manager);
    expect(list.body.items[0].imageUrl).toBe(imageUrl);

    const img = await fetch(base + imageUrl.replace("/api", ""), { headers: { Cookie: manager } });
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("cache-control")).toContain("immutable");
    expect(Buffer.from(await img.arrayBuffer()).equals(PNG)).toBe(true);

    expect((await call("DELETE", `/products/${productId}/image`, manager)).status).toBe(200);
    expect((await call("GET", "/products", manager)).body.items[0].imageUrl).toBeNull();
    expect((await fetch(`${base}/products/${productId}/image`, { headers: { Cookie: manager } })).status).toBe(404);
  });

  it("rejects files that aren't images, whatever their declared type", async () => {
    const { manager, productId } = await team();
    const res = await upload(productId, manager, Buffer.from("<svg onload=alert(1)></svg>"));
    expect(res.status).toBe(415);
  });

  it("only lets managers change photos", async () => {
    const { staff, productId } = await team();
    expect((await upload(productId, staff, PNG)).status).toBe(403);
  });
});

describe("warehouse map pins", () => {
  it("requires both coordinates together", async () => {
    const { manager } = await team();
    const half = await call("POST", "/warehouses", manager, { name: "Depot", code: "DEP", latitude: 19.1 });
    expect(half.status).toBe(400);
    const ok = await call("POST", "/warehouses", manager, { name: "Depot", code: "DEP", latitude: 19.2813, longitude: 73.0483 });
    expect(ok.status).toBe(201);
    expect(ok.body.warehouse.latitude).toBe(19.2813);
  });
});

/** Reads a ZIP's entries (deflate only) — enough to check our own writer. */
function unzip(buf: Buffer) {
  const files: Record<string, string> = {};
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const size = buf.readUInt32LE(at + 18);
    const nameLen = buf.readUInt16LE(at + 26);
    const extra = buf.readUInt16LE(at + 28);
    const name = buf.toString("utf8", at + 30, at + 30 + nameLen);
    const start = at + 30 + nameLen + extra;
    files[name] = inflateRawSync(buf.subarray(start, start + size)).toString("utf8");
    at = start + size;
  }
  return files;
}

describe("data export", () => {
  it("exports products as CSV that spreadsheets read correctly", async () => {
    const { manager } = await team();
    const res = await fetch(`${base}/export/products`, { headers: { Cookie: manager } });
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="stocksense-products-\d{4}-\d{2}-\d{2}\.csv"/);
    const text = await res.text();
    const [header, row] = text.replace(/^﻿/, "").trim().split("\r\n");
    expect(header).toContain("SKU,Product,Category");
    expect(row).toBe('STL-1,"Steel, cold-rolled",,kg,12.5,40,0,40,500,,,In stock');
  });

  it("exports JSON and applies the page's filters", async () => {
    const { manager } = await team();
    const all = await (await fetch(`${base}/export/moves?format=json`, { headers: { Cookie: manager } })).json();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ Operation: "Adjustment", SKU: "STL-1", Change: 40, "Balance after": 40 });
    const none = await (await fetch(`${base}/export/moves?format=json&to=2000-01-01`, { headers: { Cookie: manager } })).json();
    expect(none).toHaveLength(0);
  });

  it("neutralises spreadsheet formulas in text", async () => {
    const { manager } = await team();
    await call("POST", "/categories", manager, { name: "=HYPERLINK(1)" });
    const text = await (await fetch(`${base}/export/categories`, { headers: { Cookie: manager } })).text();
    expect(text).toContain("'=HYPERLINK(1)");
  });

  it("keeps team and audit exports for managers", async () => {
    const { staff } = await team();
    const list = await call("GET", "/export", staff);
    expect(list.body.items.map((d: { key: string }) => d.key)).not.toContain("team");
    expect((await fetch(`${base}/export/team`, { headers: { Cookie: staff } })).status).toBe(403);
    expect((await fetch(`${base}/export/products`, { headers: { Cookie: staff } })).status).toBe(200);
  });

  it("bundles everything into a ZIP and records the download", async () => {
    const { manager } = await team();
    const res = await fetch(`${base}/export/all`, { headers: { Cookie: manager } });
    expect(res.headers.get("content-type")).toBe("application/zip");
    const files = unzip(Buffer.from(await res.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(
      ["audit", "categories", "document-lines", "documents", "locations", "moves", "products", "stock", "team"].map((k) => `${k}.csv`),
    );
    expect(files["stock.csv"]).toContain("WH / Stock,STL-1");
    expect(await prisma.auditLog.count({ where: { action: "data.export" } })).toBe(1);
  });
});
