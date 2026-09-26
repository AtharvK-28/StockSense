import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
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
  const body = await res.json();
  return { user: body.user, cookie: res.headers.get("set-cookie")!.split(";")[0]! };
}

/** First sign-up becomes the manager; the second joins as staff. Sets up one location + product. */
async function team() {
  const manager = await signup("manager1");
  const staff = await signup("staffer1");
  await call("POST", "/warehouses", manager.cookie, { name: "Main", code: "WH" });
  const locationId = (await call("GET", "/locations", manager.cookie)).body.items[0].id;
  const productId = (await call("POST", "/products", manager.cookie, { name: "Steel", sku: "STL-1", uom: "kg" })).body.product.id;
  return { manager, staff, locationId, productId };
}

const stockOf = async (productId: string) =>
  (await prisma.stockLevel.aggregate({ where: { productId }, _sum: { quantity: true } }))._sum.quantity?.toNumber() ?? 0;

describe("roles", () => {
  it("makes only the first account a manager", async () => {
    const { manager, staff } = await team();
    expect(manager.user.role).toBe("manager");
    expect(staff.user.role).toBe("staff");
  });

  it("keeps the catalog and settings manager-only", async () => {
    const { staff, productId } = await team();
    expect((await call("POST", "/products", staff.cookie, { name: "X", sku: "X-1", uom: "kg" })).status).toBe(403);
    expect((await call("PUT", `/products/${productId}/rule`, staff.cookie, { minQty: 1, maxQty: 5 })).status).toBe(403);
    expect((await call("POST", `/products/${productId}/replenish`, staff.cookie, { quantity: 5 })).status).toBe(403);
    expect((await call("POST", "/categories", staff.cookie, { name: "Tools" })).status).toBe(403);
    expect((await call("POST", "/warehouses", staff.cookie, { name: "Depot", code: "DP" })).status).toBe(403);
    expect((await call("GET", "/users", staff.cookie)).status).toBe(403);
    // …but staff can still read everything.
    expect((await call("GET", "/products", staff.cookie)).status).toBe(200);
  });

  it("lets staff run receipts end to end but not cancel", async () => {
    const { staff, locationId, productId } = await team();
    const doc = (
      await call("POST", "/documents", staff.cookie, {
        type: "receipt",
        partnerName: "Vendor",
        destinationLocationId: locationId,
        lines: [{ productId, quantity: 50 }],
      })
    ).body.document;
    expect((await call("POST", `/documents/${doc.id}/cancel`, staff.cookie)).status).toBe(403);
    expect((await call("POST", `/documents/${doc.id}/confirm`, staff.cookie)).status).toBe(200);
    expect((await call("POST", `/documents/${doc.id}/validate`, staff.cookie)).status).toBe(200);
    expect(await stockOf(productId)).toBe(50);
  });

  it("routes staff stock counts to a manager for approval", async () => {
    const { manager, staff, locationId, productId } = await team();
    const submitted = await call("POST", "/stock/adjust", staff.cookie, { productId, locationId, quantity: 12, reason: "Count" });
    expect(submitted.status).toBe(201);
    expect(submitted.body.applied).toBe(false);
    expect(await stockOf(productId)).toBe(0);

    const dashboard = await call("GET", "/dashboard", manager.cookie);
    expect(dashboard.body.awaitingApproval).toHaveLength(1);

    const docId = submitted.body.document.id;
    expect((await call("POST", `/documents/${docId}/validate`, staff.cookie)).status).toBe(403);
    expect((await call("POST", `/documents/${docId}/validate`, manager.cookie)).status).toBe(200);
    expect(await stockOf(productId)).toBe(12);

    const direct = await call("POST", "/stock/adjust", manager.cookie, { productId, locationId, quantity: 10 });
    expect(direct.body.applied).toBe(true);
    expect(await stockOf(productId)).toBe(10);
  });

  it("judges low stock company-wide even when the dashboard is filtered to one location", async () => {
    const { manager, locationId, productId } = await team();
    await call("PUT", `/products/${productId}/rule`, manager.cookie, { minQty: 10, maxQty: 100 });
    const warehouseId = (await call("GET", "/warehouses", manager.cookie)).body.items[0].id;
    const rack = (await call("POST", "/locations", manager.cookie, { name: "Rack Z", warehouseId })).body.location.id;
    const receipt = (
      await call("POST", "/documents", manager.cookie, {
        type: "receipt",
        partnerName: "Vendor",
        destinationLocationId: locationId,
        lines: [{ productId, quantity: 50 }],
      })
    ).body.document;
    await call("POST", `/documents/${receipt.id}/validate`, manager.cookie);

    const atRack = (await call("GET", `/dashboard?locationId=${rack}`, manager.cookie)).body;
    expect(atRack.kpis.inStock).toBe(0); // nothing on Rack Z…
    expect(atRack.alerts).toHaveLength(0); // …but 50 in total is well above the reorder point
    expect(atRack.kpis.outOfStock).toBe(0);
  });

  it("lets managers promote staff but never remove the last manager", async () => {
    const { manager, staff } = await team();
    expect((await call("PUT", `/users/${manager.user.id}/role`, manager.cookie, { role: "staff" })).status).toBe(409);
    expect((await call("PUT", `/users/${staff.user.id}/role`, manager.cookie, { role: "manager" })).status).toBe(200);
    expect((await call("GET", "/users", staff.cookie)).status).toBe(200);
    expect((await call("PUT", `/users/${manager.user.id}/role`, staff.cookie, { role: "staff" })).status).toBe(200);
  });
});
