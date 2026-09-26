import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import {
  confirmDocument,
  createReturn,
  packDocument,
  pickDocument,
  validateDocument,
} from "../src/services/documents";
import { updateSettings } from "../src/services/settings";
import { create, fixture, resetDatabase, stockAt } from "./helpers";

let f: Awaited<ReturnType<typeof fixture>>;

beforeEach(async () => {
  await resetDatabase();
  f = await fixture();
});
afterAll(() => prisma.$disconnect());

const receiptOf = (productId: string, quantity: number) =>
  create("receipt", { partnerName: "Vendor", destinationLocationId: f.store.id, lines: [{ productId, quantity }] }, f.user.id);

async function receive(productId: string, quantity: number) {
  const doc = await receiptOf(productId, quantity);
  await validateDocument(doc.id, f.user.id, { quiet: true });
  return doc;
}

async function ship(productId: string, quantity: number) {
  const doc = await create(
    "delivery",
    { partnerName: "Customer", sourceLocationId: f.store.id, lines: [{ productId, quantity }] },
    f.user.id,
  );
  await confirmDocument(doc.id);
  await pickDocument(doc.id);
  await packDocument(doc.id);
  return doc;
}

const lineOf = async (documentId: string) => prisma.documentLine.findFirstOrThrow({ where: { documentId } });

describe("partial processing and backorders", () => {
  it("receives part of a receipt and carries the rest into a backorder", async () => {
    const doc = await receiptOf(f.steel.id, 50);
    const line = await lineOf(doc.id);
    const result = await validateDocument(doc.id, f.user.id, { done: [{ id: line.id, doneQuantity: 30 }], backorder: true });

    expect(await stockAt(f.steel.id, f.store.id)).toBe(30);
    expect((await lineOf(doc.id)).doneQuantity?.toNumber()).toBe(30);
    expect(result.backorder).not.toBeNull();
    const bo = await prisma.document.findUniqueOrThrow({ where: { id: result.backorder!.id }, include: { lines: true } });
    expect(bo.backorderOfId).toBe(doc.id);
    expect(bo.status).toBe("ready");
    expect(bo.reference).toBe("WH/IN/0002");
    expect(bo.lines[0]!.quantity.toNumber()).toBe(20);

    await validateDocument(bo.id, f.user.id);
    expect(await stockAt(f.steel.id, f.store.id)).toBe(50);
  });

  it("can drop the remainder instead of creating a backorder", async () => {
    const doc = await receiptOf(f.steel.id, 50);
    const line = await lineOf(doc.id);
    const result = await validateDocument(doc.id, f.user.id, { done: [{ id: line.id, doneQuantity: 45 }], backorder: false });
    expect(result.backorder).toBeNull();
    expect(await prisma.document.count({ where: { backorderOfId: doc.id } })).toBe(0);
    expect(await stockAt(f.steel.id, f.store.id)).toBe(45);
  });

  it("refuses to validate when nothing was processed", async () => {
    const doc = await receiptOf(f.steel.id, 50);
    const line = await lineOf(doc.id);
    await expect(validateDocument(doc.id, f.user.id, { done: [{ id: line.id, doneQuantity: 0 }] })).rejects.toMatchObject({ status: 400 });
    expect((await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).status).toBe("draft");
  });

  it("ships part of a delivery; the backorder waits for stock", async () => {
    await receive(f.chair.id, 6);
    const doc = await ship(f.chair.id, 6);
    const line = await lineOf(doc.id);
    const result = await validateDocument(doc.id, f.user.id, { done: [{ id: line.id, doneQuantity: 4 }], backorder: true });
    expect(await stockAt(f.chair.id, f.store.id)).toBe(2);
    const bo = await prisma.document.findUniqueOrThrow({ where: { id: result.backorder!.id } });
    expect(bo.status).toBe("ready"); // 2 on hand covers the remaining 2
    expect(bo.pickedAt).toBeNull();
  });
});

describe("returns", () => {
  it("returns a delivery back into its source location, once", async () => {
    await receive(f.chair.id, 10);
    const delivery = await ship(f.chair.id, 10);
    await validateDocument(delivery.id, f.user.id, { quiet: true });
    expect(await stockAt(f.chair.id, f.store.id)).toBe(0);

    const ret = await createReturn(delivery.id, f.user.id);
    const full = await prisma.document.findUniqueOrThrow({ where: { id: ret.id }, include: { lines: true } });
    expect(full.type).toBe("receipt");
    expect(full.returnOfId).toBe(delivery.id);
    expect(full.destinationLocationId).toBe(f.store.id);
    expect(full.lines[0]!.quantity.toNumber()).toBe(10);

    await validateDocument(ret.id, f.user.id, { quiet: true });
    expect(await stockAt(f.chair.id, f.store.id)).toBe(10);
    await expect(createReturn(delivery.id, f.user.id)).rejects.toMatchObject({ status: 409 });
  });

  it("only returns documents that were validated", async () => {
    const doc = await receiptOf(f.steel.id, 5);
    await expect(createReturn(doc.id, f.user.id)).rejects.toMatchObject({ status: 409 });
  });
});

describe("auto-reorder and notifications", () => {
  it("drafts a receipt and notifies managers when stock crosses the reorder point", async () => {
    await prisma.product.update({ where: { id: f.chair.id }, data: { minQty: 10, maxQty: 50 } });
    await receive(f.chair.id, 12);
    const delivery = await ship(f.chair.id, 5);
    await validateDocument(delivery.id, f.user.id);

    const draft = await prisma.document.findFirstOrThrow({ where: { origin: "Auto-reorder" }, include: { lines: true } });
    expect(draft.status).toBe("draft");
    expect(draft.lines[0]!.quantity.toNumber()).toBe(43); // back up to max 50 from 7
    const notes = await prisma.notification.findMany({ where: { userId: f.user.id } });
    expect(notes.map((n) => n.kind).sort()).toEqual(["auto_reorder", "low_stock"]);

    // Already below the point and a draft is open: no duplicates.
    const again = await ship(f.chair.id, 1);
    await validateDocument(again.id, f.user.id);
    expect(await prisma.document.count({ where: { origin: "Auto-reorder" } })).toBe(1);
  });

  it("respects the auto-reorder setting", async () => {
    await updateSettings({ autoReorder: false });
    await prisma.product.update({ where: { id: f.chair.id }, data: { minQty: 10, maxQty: 50 } });
    await receive(f.chair.id, 12);
    const delivery = await ship(f.chair.id, 5);
    await validateDocument(delivery.id, f.user.id);
    expect(await prisma.document.count({ where: { origin: "Auto-reorder" } })).toBe(0);
    expect(await prisma.notification.count({ where: { kind: "low_stock" } })).toBe(1);
  });
});
