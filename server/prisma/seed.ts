/**
 * Demo data. Every stock quantity is created through real documents validated by the Stock
 * Ledger Engine, so the ledger and stock levels are consistent from the first login.
 *
 *   npm run db:seed                 30 days of realistic history + open work (skips if data exists)
 *   npm run db:seed -- --empty      users, warehouses and categories only — for a demo that
 *                                   starts from zero products
 *   npm run db:reset && npm run db:seed   start over
 */
import bcrypt from "bcryptjs";
import type { DocType } from "@prisma/client";
import { prisma } from "../src/db";
import {
  type DocumentInput,
  confirmDocument,
  createDocument,
  packDocument,
  pickDocument,
  validateDocument,
} from "../src/services/documents";

const DEMO_PASSWORD = "Demo@1234";
const EMPTY = process.argv.includes("--empty");
/** Opening stock lands before the default 30-day analytics window so charts show steady trading. */
const HISTORY_DAYS = 45;

/** A date `offset` days from today at the given hour. */
const day = (offset: number, hour = 10) => {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
};

/** Deterministic PRNG so every seed produces the same history. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  if ((await prisma.user.count()) > 0) {
    console.log("Database already has data — skipping seed. Run `npm run db:reset -w server` first to start over.");
    return;
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const rakesh = await prisma.user.create({
    data: { loginId: "manager", name: "Rakesh Mehta", email: "manager@stocksense.app", passwordHash, role: "manager" },
  });
  const meena = await prisma.user.create({
    data: { loginId: "meena.staff", name: "Meena Iyer", email: "staff@stocksense.app", passwordHash, role: "staff" },
  });

  const main = await prisma.warehouse.create({
    data: {
      name: "Main Warehouse",
      code: "WH",
      address: "Plot 14, MIDC Bhosari, Pune",
      locations: {
        create: [
          { name: "Stock", code: "STK1" },
          { name: "Rack A", code: "RACKA" },
          { name: "Rack B", code: "RACKB" },
          { name: "Production Floor", code: "PROD" },
        ],
      },
    },
    include: { locations: true },
  });
  const depot = await prisma.warehouse.create({
    data: { name: "Mumbai Depot", code: "MUM", address: "Bhiwandi Logistics Park, Thane", locations: { create: [{ name: "Stock", code: "STK1" }] } },
    include: { locations: true },
  });
  const loc = (w: typeof main, name: string) => w.locations.find((l) => l.name === name)!.id;
  const WH = { stock: loc(main, "Stock"), rackA: loc(main, "Rack A"), production: loc(main, "Production Floor") };
  const MUM = { stock: loc(depot, "Stock") };

  const categories = Object.fromEntries(
    await Promise.all(
      ["Raw Materials", "Furniture", "Packaging", "Hardware"].map(async (name) => [name, (await prisma.category.create({ data: { name } })).id]),
    ),
  ) as Record<string, string>;

  if (EMPTY) {
    console.log(`Seeded an empty company (no products). Log in as "manager" / ${DEMO_PASSWORD}.`);
    return;
  }

  const product = (name: string, sku: string, category: string, uom: string, unitCost: number, minQty?: number, maxQty?: number) =>
    prisma.product.create({ data: { name, sku, uom, unitCost, categoryId: categories[category], minQty, maxQty } });

  const steel = await product("Steel Rods", "STL-001", "Raw Materials", "kg", 68, 50, 500);
  const aluminium = await product("Aluminium Sheets", "ALU-002", "Raw Materials", "kg", 245, 40, 300);
  const copper = await product("Copper Wire", "CU-003", "Raw Materials", "m", 32, 100, 1000);
  const chair = await product("Ergonomic Office Chair", "FUR-101", "Furniture", "Units", 7499, 10, 60);
  const desk = await product("Oak Work Desk", "FUR-102", "Furniture", "Units", 3000, 5, 30);
  const box = await product("Corrugated Box (L)", "PKG-201", "Packaging", "Units", 18, 100, 1000);
  const wrap = await product("Bubble Wrap Roll", "PKG-202", "Packaging", "Rolls", 420, 20, 100);
  const bolts = await product("Hex Bolts M8", "HW-301", "Hardware", "Box", 350, 25, 200);
  const screws = await product("Wood Screws 40mm", "HW-302", "Hardware", "Box", 190, 25, 150);

  const make = (type: DocType, input: DocumentInput, userId = rakesh.id) =>
    prisma.$transaction((tx) => createDocument(tx, type, input, userId));

  /** Validates as if it happened at `at`, and backdates the document's own timestamps to match. */
  const complete = async (id: string, at: Date, userId = rakesh.id) => {
    const doc = await prisma.document.findUniqueOrThrow({ where: { id } });
    if (doc.type === "delivery") {
      await confirmDocument(id);
      await pickDocument(id);
      await packDocument(id);
    } else if (doc.type === "transfer") {
      await confirmDocument(id);
    }
    await validateDocument(id, userId, { at, quiet: true });
    const earlier = (h: number) => new Date(at.getTime() - h * 60 * 60 * 1000);
    await prisma.document.update({
      where: { id },
      data: {
        createdAt: earlier(20),
        pickedAt: doc.type === "delivery" ? earlier(3) : undefined,
        packedAt: doc.type === "delivery" ? earlier(2) : undefined,
      },
    });
  };
  const onHand = async (productId: string, locationId: string) =>
    (await prisma.stockLevel.findUnique({ where: { productId_locationId: { productId, locationId } } }))?.quantity.toNumber() ?? 0;

  // ---------------------------------------------------------------- Opening stock (day −30)
  const opening: [string, DocumentInput, number][] = [
    ["receipt", { partnerName: "Tata Steel Ltd", origin: "PO-2001", destinationLocationId: WH.stock, lines: [
      { productId: steel.id, quantity: 420 }, { productId: aluminium.id, quantity: 160 }, { productId: bolts.id, quantity: 90 } ] }, -HISTORY_DAYS],
    ["receipt", { partnerName: "Godrej Interio", origin: "PO-2002", destinationLocationId: WH.stock, lines: [
      { productId: chair.id, quantity: 55 }, { productId: desk.id, quantity: 26 } ] }, -HISTORY_DAYS],
    ["receipt", { partnerName: "PackRight Industries", origin: "PO-2003", destinationLocationId: MUM.stock, lines: [
      { productId: box.id, quantity: 900 }, { productId: wrap.id, quantity: 30 }, { productId: screws.id, quantity: 60 } ] }, -HISTORY_DAYS + 1],
  ];
  for (const [type, input, offset] of opening) {
    const doc = await make(type as DocType, { ...input, scheduledDate: day(offset) });
    await complete(doc.id, day(offset, 11));
  }

  // ---------------------------------------------------------------- 30 days of trading
  const random = rng(20260926);
  const pick = <T,>(xs: T[]) => xs[Math.floor(random() * xs.length)]!;
  const customers = ["Sharma Furniture House", "Urban Retail Co.", "Metro Offices Pvt Ltd", "Kalyani Fabricators", "BlueDart Kits", "Apex Interiors"];
  const addresses: Record<string, string> = {
    "Sharma Furniture House": "22 FC Road, Shivajinagar, Pune 411005",
    "Urban Retail Co.": "Linking Road, Bandra West, Mumbai 400050",
    "Metro Offices Pvt Ltd": "Tower B, Hinjewadi Phase 2, Pune 411057",
    "Kalyani Fabricators": "Chakan MIDC, Pune 410501",
    "BlueDart Kits": "Andheri East, Mumbai 400069",
    "Apex Interiors": "Koregaon Park, Pune 411001",
  };
  // What sells from where, and typical order sizes. Hex bolts, bubble wrap and copper never sell (dead stock).
  const catalogue = [
    { product: chair, from: WH.stock, min: 1, max: 4, weight: 3 },
    { product: desk, from: WH.stock, min: 1, max: 2, weight: 2 },
    { product: steel, from: WH.production, min: 5, max: 18, weight: 3 },
    { product: aluminium, from: WH.stock, min: 3, max: 8, weight: 1 },
    { product: box, from: MUM.stock, min: 10, max: 30, weight: 2 },
    { product: screws, from: MUM.stock, min: 1, max: 3, weight: 1 },
  ];
  const weighted = catalogue.flatMap((c) => Array(c.weight).fill(c));

  for (let offset = -HISTORY_DAYS + 2; offset <= -1; offset++) {
    // Keep the production floor fed with steel.
    if (offset % 6 === 0 || offset === -HISTORY_DAYS + 2) {
      const qty = Math.min(90, await onHand(steel.id, WH.stock));
      if (qty > 0) {
        const t = await make("transfer", { sourceLocationId: WH.stock, destinationLocationId: WH.production, scheduledDate: day(offset), notes: "Steel for the production run", lines: [{ productId: steel.id, quantity: qty }] });
        await complete(t.id, day(offset, 8));
      }
    }
    // Weekly replenishment.
    if (offset % 7 === 0) {
      const r = await make("receipt", {
        partnerName: pick(["Godrej Interio", "Tata Steel Ltd"]),
        origin: `PO-${2100 + offset + HISTORY_DAYS}`,
        destinationLocationId: WH.stock,
        scheduledDate: day(offset),
        lines: [
          { productId: chair.id, quantity: 10 },
          { productId: desk.id, quantity: 3 },
          { productId: steel.id, quantity: 80 },
        ],
      });
      await complete(r.id, day(offset, 9));
    }
    // 1–3 customer orders a day.
    const orders = 1 + Math.floor(random() * 3);
    for (let o = 0; o < orders; o++) {
      const item = pick(weighted);
      const qty = item.min + Math.floor(random() * (item.max - item.min + 1));
      if ((await onHand(item.product.id, item.from)) < qty + 2) continue;
      const customer = pick(customers);
      const d = await make("delivery", {
        partnerName: customer,
        deliveryAddress: addresses[customer],
        origin: `SO-${1100 + (offset + HISTORY_DAYS) * 3 + o}`,
        sourceLocationId: item.from,
        scheduledDate: day(offset),
        lines: [{ productId: item.product.id, quantity: qty }],
      });
      await complete(d.id, day(offset, 12 + o * 2));
    }
    // A cycle count finds some damage now and then.
    if (offset === -9) {
      const counted = Math.max(0, (await onHand(steel.id, WH.production)) - 3);
      const a = await make("adjustment", { sourceLocationId: WH.production, scheduledDate: day(offset), notes: "Weekly cycle count", lines: [{ productId: steel.id, countedQuantity: counted, notes: "3 kg damaged in handling" }] });
      await complete(a.id, day(offset, 17));
    }
  }

  // Bring a couple of products to interesting levels for the dashboard: screws low, desks short.
  const screwsLeft = await onHand(screws.id, MUM.stock);
  if (screwsLeft > 20) {
    const a = await make("adjustment", { sourceLocationId: MUM.stock, scheduledDate: day(-1), notes: "Shelf count", lines: [{ productId: screws.id, countedQuantity: 20, notes: "Boxes found damp" }] });
    await complete(a.id, day(-1, 16));
  }
  const desksLeft = await onHand(desk.id, WH.stock);
  if (desksLeft > 8) {
    const d = await make("delivery", { partnerName: "Apex Interiors", deliveryAddress: addresses["Apex Interiors"], origin: "SO-1290", sourceLocationId: WH.stock, scheduledDate: day(-1), lines: [{ productId: desk.id, quantity: desksLeft - 8 }] });
    await complete(d.id, day(-1, 15));
  }

  // ---------------------------------------------------------------- Open work for today
  await confirmDocument(
    (await make("receipt", { partnerName: "Hindalco Industries", origin: "PO-2151", destinationLocationId: WH.stock, scheduledDate: day(1), lines: [{ productId: aluminium.id, quantity: 200 }] })).id,
  );
  await make("receipt", { partnerName: "Sterlite Copper", origin: "PO-2152", destinationLocationId: WH.stock, scheduledDate: day(-1), lines: [{ productId: copper.id, quantity: 500 }] });
  await confirmDocument(
    (await make("delivery", { partnerName: "Metro Offices Pvt Ltd", deliveryAddress: addresses["Metro Offices Pvt Ltd"], origin: "SO-1292", sourceLocationId: WH.stock, scheduledDate: day(0), lines: [{ productId: desk.id, quantity: 20 }] })).id,
  );
  const urban = await make("delivery", { partnerName: "Urban Retail Co.", deliveryAddress: addresses["Urban Retail Co."], origin: "SO-1295", sourceLocationId: MUM.stock, scheduledDate: day(1), lines: [{ productId: box.id, quantity: 150 }] });
  await confirmDocument(urban.id);
  await pickDocument(urban.id);
  await confirmDocument(
    (await make("transfer", { sourceLocationId: MUM.stock, destinationLocationId: WH.stock, scheduledDate: day(2), notes: "Rebalance packaging stock to Pune", lines: [{ productId: box.id, quantity: 200 }] })).id,
  );

  // Meena (staff) counted bubble wrap and found 2 rolls damaged; it waits for Rakesh to approve.
  const count = await make("adjustment", { sourceLocationId: MUM.stock, notes: "Shelf count", lines: [{ productId: wrap.id, countedQuantity: 28, notes: "2 rolls water-damaged" }] }, meena.id);
  await confirmDocument(count.id);
  await prisma.notification.create({
    data: { userId: rakesh.id, kind: "approval", title: `Meena Iyer submitted count ${count.reference}`, body: "Review and approve it to update stock.", link: `/operations/adjustments/${count.id}` },
  });

  const moves = await prisma.stockMove.count();
  const docs = await prisma.document.count();
  console.log(`Seeded ${docs} documents and ${moves} ledger entries over ${HISTORY_DAYS} days.`);
  console.log(`Log in as "manager" / ${DEMO_PASSWORD} (or "meena.staff").`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
