import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import {
  confirmDocument,
  packDocument,
  pickDocument,
  refreshAvailability,
  validateDocument,
} from "../src/services/documents";
import { create, fixture, resetDatabase, stockAt } from "./helpers";

let f: Awaited<ReturnType<typeof fixture>>;

beforeEach(async () => {
  await resetDatabase();
  f = await fixture();
});

afterAll(() => prisma.$disconnect());

async function receive(productId: string, locationId: string, quantity: number) {
  const doc = await create(
    "receipt",
    { partnerName: "Tata Steel", destinationLocationId: locationId, lines: [{ productId, quantity }] },
    f.user.id,
  );
  await validateDocument(doc.id, f.user.id);
  return doc;
}

async function shipReady(docId: string) {
  await confirmDocument(docId);
  await pickDocument(docId);
  await packDocument(docId);
}

describe("receipts", () => {
  it("increases stock and writes a ledger entry on validation", async () => {
    const doc = await receive(f.steel.id, f.store.id, 50);

    expect(await stockAt(f.steel.id, f.store.id)).toBe(50);
    const moves = await prisma.stockMove.findMany({ where: { documentId: doc.id } });
    expect(moves).toHaveLength(1);
    expect(moves[0].quantityDelta.toNumber()).toBe(50);
    expect(moves[0].balanceAfter.toNumber()).toBe(50);
    expect(moves[0].operationType).toBe("receipt");

    const done = await prisma.document.findUniqueOrThrow({ where: { id: doc.id } });
    expect(done.status).toBe("done");
    expect(done.validatedById).toBe(f.user.id);
    expect(done.reference).toBe("WH/IN/0001");
  });

  it("cannot be validated twice", async () => {
    const doc = await receive(f.steel.id, f.store.id, 50);
    await expect(validateDocument(doc.id, f.user.id)).rejects.toMatchObject({ status: 409 });
    expect(await stockAt(f.steel.id, f.store.id)).toBe(50);
  });

  it("applies concurrent validations exactly once", async () => {
    const doc = await create(
      "receipt",
      { partnerName: "Tata Steel", destinationLocationId: f.store.id, lines: [{ productId: f.steel.id, quantity: 10 }] },
      f.user.id,
    );
    const results = await Promise.allSettled([validateDocument(doc.id, f.user.id), validateDocument(doc.id, f.user.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await stockAt(f.steel.id, f.store.id)).toBe(10);
    expect(await prisma.stockMove.count({ where: { documentId: doc.id } })).toBe(1);
  });
});

describe("delivery orders", () => {
  it("waits for stock, then requires pick and pack before decreasing stock", async () => {
    const doc = await create(
      "delivery",
      { partnerName: "Sharma Furniture", sourceLocationId: f.store.id, lines: [{ productId: f.chair.id, quantity: 10 }] },
      f.user.id,
    );
    await confirmDocument(doc.id);
    expect((await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).status).toBe("waiting");

    await receive(f.chair.id, f.store.id, 25); // validation re-checks waiting documents
    expect((await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).status).toBe("ready");

    await expect(validateDocument(doc.id, f.user.id)).rejects.toThrow(/pick and pack/i);
    await pickDocument(doc.id);
    await packDocument(doc.id);
    await validateDocument(doc.id, f.user.id);

    expect(await stockAt(f.chair.id, f.store.id)).toBe(15);
    const move = await prisma.stockMove.findFirstOrThrow({ where: { documentId: doc.id } });
    expect(move.quantityDelta.toNumber()).toBe(-10);
    expect(move.balanceAfter.toNumber()).toBe(15);
  });

  it("rolls back every line when one line lacks stock", async () => {
    await receive(f.steel.id, f.store.id, 100);
    await receive(f.chair.id, f.store.id, 5);
    const doc = await create(
      "delivery",
      {
        partnerName: "Metro Offices",
        sourceLocationId: f.store.id,
        lines: [
          { productId: f.steel.id, quantity: 30 },
          { productId: f.chair.id, quantity: 5 },
        ],
      },
      f.user.id,
    );
    await shipReady(doc.id);
    // Someone else ships the chairs first.
    await prisma.stockLevel.update({
      where: { productId_locationId: { productId: f.chair.id, locationId: f.store.id } },
      data: { quantity: 2 },
    });

    await expect(validateDocument(doc.id, f.user.id)).rejects.toThrow(/Not enough Chair/);
    expect(await stockAt(f.steel.id, f.store.id)).toBe(100);
    expect(await prisma.stockMove.count({ where: { documentId: doc.id } })).toBe(0);
    expect((await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).status).toBe("ready");
  });
});

describe("internal transfers", () => {
  it("moves stock between locations without changing the total", async () => {
    await receive(f.steel.id, f.store.id, 100);
    const doc = await create(
      "transfer",
      { sourceLocationId: f.store.id, destinationLocationId: f.rack.id, lines: [{ productId: f.steel.id, quantity: 60 }] },
      f.user.id,
    );
    await confirmDocument(doc.id);
    await validateDocument(doc.id, f.user.id);

    expect(await stockAt(f.steel.id, f.store.id)).toBe(40);
    expect(await stockAt(f.steel.id, f.rack.id)).toBe(60);
    const moves = await prisma.stockMove.findMany({ where: { documentId: doc.id }, orderBy: { operationType: "asc" } });
    expect(moves.map((m) => [m.operationType, m.quantityDelta.toNumber()])).toEqual([
      ["transfer_in", 60],
      ["transfer_out", -60],
    ]);
  });

  it("rejects a transfer to the same location", async () => {
    await expect(
      create(
        "transfer",
        { sourceLocationId: f.store.id, destinationLocationId: f.store.id, lines: [{ productId: f.steel.id, quantity: 1 }] },
        f.user.id,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("stock adjustments", () => {
  it("sets stock to the counted quantity and logs the delta", async () => {
    await receive(f.steel.id, f.store.id, 50);
    const doc = await create(
      "adjustment",
      { sourceLocationId: f.store.id, lines: [{ productId: f.steel.id, countedQuantity: 47, notes: "3 kg damaged" }] },
      f.user.id,
    );
    await validateDocument(doc.id, f.user.id);

    expect(await stockAt(f.steel.id, f.store.id)).toBe(47);
    const line = await prisma.documentLine.findFirstOrThrow({ where: { documentId: doc.id } });
    expect(line.recordedQuantity?.toNumber()).toBe(50);
    expect(line.quantity.toNumber()).toBe(-3);
    const move = await prisma.stockMove.findFirstOrThrow({ where: { documentId: doc.id } });
    expect(move.quantityDelta.toNumber()).toBe(-3);
    expect(move.operationType).toBe("adjustment");
  });
});

describe("ledger integrity", () => {
  it("rejects updates and deletes on ledger entries", async () => {
    await receive(f.steel.id, f.store.id, 10);
    const move = await prisma.stockMove.findFirstOrThrow();
    await expect(prisma.stockMove.update({ where: { id: move.id }, data: { quantityDelta: 999 } })).rejects.toThrow(/append-only/);
    await expect(prisma.stockMove.delete({ where: { id: move.id } })).rejects.toThrow(/append-only/);
  });

  it("stock levels always equal the sum of the ledger (brief's example flow)", async () => {
    // Receive 100 kg → move to production rack → deliver 20 → 3 kg damaged.
    await receive(f.steel.id, f.store.id, 100);

    const transfer = await create(
      "transfer",
      { sourceLocationId: f.store.id, destinationLocationId: f.rack.id, lines: [{ productId: f.steel.id, quantity: 100 }] },
      f.user.id,
    );
    await confirmDocument(transfer.id);
    await validateDocument(transfer.id, f.user.id);

    const delivery = await create(
      "delivery",
      { partnerName: "Customer", sourceLocationId: f.rack.id, lines: [{ productId: f.steel.id, quantity: 20 }] },
      f.user.id,
    );
    await shipReady(delivery.id);
    await validateDocument(delivery.id, f.user.id);

    const adjustment = await create(
      "adjustment",
      { sourceLocationId: f.rack.id, lines: [{ productId: f.steel.id, countedQuantity: 77, notes: "Damaged" }] },
      f.user.id,
    );
    await validateDocument(adjustment.id, f.user.id);

    expect(await stockAt(f.steel.id, f.store.id)).toBe(0);
    expect(await stockAt(f.steel.id, f.rack.id)).toBe(77);

    const levels = await prisma.stockLevel.findMany();
    for (const level of levels) {
      const sum = await prisma.stockMove.aggregate({
        where: { productId: level.productId, locationId: level.locationId },
        _sum: { quantityDelta: true },
      });
      expect(sum._sum.quantityDelta?.toNumber() ?? 0).toBe(level.quantity.toNumber());
    }
    expect(await prisma.stockMove.count()).toBe(5);
    await refreshAvailability();
  });
});
