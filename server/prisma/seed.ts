/**
 * Demo data. Every stock quantity below is created through real documents validated by the
 * Stock Ledger Engine, so the ledger and stock levels are consistent from the first login.
 *
 *   npm run db:seed            seeds an empty database (skips if data exists)
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
const day = (offset: number) => {
  const d = new Date();
  d.setHours(10, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
};

async function main() {
  if ((await prisma.user.count()) > 0) {
    console.log("Database already has data — skipping seed. Run `npm run db:reset -w server` first to start over.");
    return;
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const rakesh = await prisma.user.create({
    data: { name: "Rakesh Mehta", email: "manager@stocksense.app", passwordHash, role: "manager" },
  });
  await prisma.user.create({
    data: { name: "Meena Iyer", email: "staff@stocksense.app", passwordHash, role: "staff" },
  });

  const main = await prisma.warehouse.create({
    data: {
      name: "Main Warehouse",
      code: "WH",
      address: "Plot 14, MIDC Bhosari, Pune",
      locations: { create: [{ name: "Stock" }, { name: "Rack A" }, { name: "Rack B" }, { name: "Production Floor" }] },
    },
    include: { locations: true },
  });
  const depot = await prisma.warehouse.create({
    data: { name: "Mumbai Depot", code: "MUM", address: "Bhiwandi Logistics Park, Thane", locations: { create: [{ name: "Stock" }] } },
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

  const product = (name: string, sku: string, category: string, uom: string, minQty?: number, maxQty?: number) =>
    prisma.product.create({ data: { name, sku, uom, categoryId: categories[category], minQty, maxQty } });

  const steel = await product("Steel Rods", "STL-001", "Raw Materials", "kg", 50, 500);
  const aluminium = await product("Aluminium Sheets", "ALU-002", "Raw Materials", "kg", 40, 300);
  const copper = await product("Copper Wire", "CU-003", "Raw Materials", "m", 100, 1000);
  const chair = await product("Ergonomic Office Chair", "FUR-101", "Furniture", "Units", 10, 60);
  const desk = await product("Oak Work Desk", "FUR-102", "Furniture", "Units", 5, 30);
  const box = await product("Corrugated Box (L)", "PKG-201", "Packaging", "Units", 100, 1000);
  const wrap = await product("Bubble Wrap Roll", "PKG-202", "Packaging", "Rolls", 20, 100);
  const bolts = await product("Hex Bolts M8", "HW-301", "Hardware", "Box", 25, 200);
  const screws = await product("Wood Screws 40mm", "HW-302", "Hardware", "Box", 25, 150);

  const make = (type: DocType, input: DocumentInput) =>
    prisma.$transaction((tx) => createDocument(tx, type, input, rakesh.id));
  const validate = (id: string) => validateDocument(id, rakesh.id);
  const ship = async (id: string) => {
    await confirmDocument(id);
    await pickDocument(id);
    await packDocument(id);
    await validate(id);
  };

  // Completed history.
  await validate(
    (
      await make("receipt", {
        partnerName: "Tata Steel Ltd",
        origin: "PO-2041",
        destinationLocationId: WH.stock,
        scheduledDate: day(-6),
        lines: [
          { productId: steel.id, quantity: 300 },
          { productId: aluminium.id, quantity: 120 },
          { productId: bolts.id, quantity: 80 },
        ],
      })
    ).id,
  );
  await validate(
    (
      await make("receipt", {
        partnerName: "Godrej Interio",
        origin: "PO-2042",
        destinationLocationId: WH.stock,
        scheduledDate: day(-5),
        lines: [
          { productId: chair.id, quantity: 40 },
          { productId: desk.id, quantity: 12 },
        ],
      })
    ).id,
  );
  await validate(
    (
      await make("receipt", {
        partnerName: "PackRight Industries",
        origin: "PO-2043",
        destinationLocationId: MUM.stock,
        scheduledDate: day(-4),
        lines: [
          { productId: box.id, quantity: 600 },
          { productId: wrap.id, quantity: 30 },
          { productId: screws.id, quantity: 20 },
        ],
      })
    ).id,
  );

  const toProduction = await make("transfer", {
    sourceLocationId: WH.stock,
    destinationLocationId: WH.production,
    scheduledDate: day(-3),
    notes: "Steel for frame production run",
    lines: [{ productId: steel.id, quantity: 120 }],
  });
  await confirmDocument(toProduction.id);
  await validate(toProduction.id);

  const toRack = await make("transfer", {
    sourceLocationId: WH.stock,
    destinationLocationId: WH.rackA,
    scheduledDate: day(-3),
    lines: [{ productId: chair.id, quantity: 20 }],
  });
  await confirmDocument(toRack.id);
  await validate(toRack.id);

  await ship(
    (
      await make("delivery", {
        partnerName: "Sharma Furniture House",
        origin: "SO-1187",
        sourceLocationId: WH.stock,
        scheduledDate: day(-2),
        lines: [
          { productId: chair.id, quantity: 12 },
          { productId: desk.id, quantity: 4 },
        ],
      })
    ).id,
  );

  await validate(
    (
      await make("adjustment", {
        sourceLocationId: WH.production,
        scheduledDate: day(-1),
        notes: "Weekly cycle count",
        lines: [{ productId: steel.id, countedQuantity: 117, notes: "3 kg damaged in handling" }],
      })
    ).id,
  );

  // Open work for the dashboard.
  await confirmDocument(
    (
      await make("receipt", {
        partnerName: "Hindalco Industries",
        origin: "PO-2051",
        destinationLocationId: WH.stock,
        scheduledDate: day(1),
        lines: [{ productId: aluminium.id, quantity: 200 }],
      })
    ).id,
  );
  await make("receipt", {
    partnerName: "Sterlite Copper",
    origin: "PO-2052",
    destinationLocationId: WH.stock,
    scheduledDate: day(-1),
    lines: [{ productId: copper.id, quantity: 500 }],
  });
  await confirmDocument(
    (
      await make("delivery", {
        partnerName: "Metro Offices Pvt Ltd",
        origin: "SO-1192",
        sourceLocationId: WH.stock,
        scheduledDate: day(0),
        lines: [{ productId: desk.id, quantity: 20 }],
      })
    ).id,
  );
  const urban = await make("delivery", {
    partnerName: "Urban Retail Co.",
    origin: "SO-1195",
    sourceLocationId: MUM.stock,
    scheduledDate: day(1),
    lines: [{ productId: box.id, quantity: 150 }],
  });
  await confirmDocument(urban.id);
  await pickDocument(urban.id);
  await confirmDocument(
    (
      await make("transfer", {
        sourceLocationId: MUM.stock,
        destinationLocationId: WH.stock,
        scheduledDate: day(2),
        notes: "Rebalance packaging stock to Pune",
        lines: [{ productId: box.id, quantity: 200 }],
      })
    ).id,
  );

  console.log(`Seeded demo data. Log in as manager@stocksense.app / ${DEMO_PASSWORD} (or staff@stocksense.app).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
