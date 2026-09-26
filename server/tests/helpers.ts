import type { DocType } from "@prisma/client";
import { prisma } from "../src/db";
import { type DocumentInput, createDocument } from "../src/services/documents";

export async function resetDatabase() {
  // TRUNCATE bypasses the ledger's append-only row trigger, which is what we want in tests.
  await prisma.$executeRawUnsafe(`
    TRUNCATE stock_ledger_entries, document_lines, documents, stock_levels, products,
             product_categories, locations, warehouses, otp_codes, users, sequences CASCADE`);
}

export async function fixture() {
  const user = await prisma.user.create({
    data: { name: "Rakesh", email: "rakesh@test.dev", passwordHash: "x", role: "manager" },
  });
  const warehouse = await prisma.warehouse.create({ data: { name: "Main Warehouse", code: "WH" } });
  const [store, rack] = await Promise.all([
    prisma.location.create({ data: { warehouseId: warehouse.id, name: "Main Store" } }),
    prisma.location.create({ data: { warehouseId: warehouse.id, name: "Production Rack" } }),
  ]);
  const steel = await prisma.product.create({ data: { name: "Steel", sku: "STL-001", uom: "kg", minQty: 10 } });
  const chair = await prisma.product.create({ data: { name: "Chair", sku: "FUR-001", uom: "Units" } });
  return { user, warehouse, store, rack, steel, chair };
}

export function create(type: DocType, input: DocumentInput, userId: string) {
  return prisma.$transaction((tx) => createDocument(tx, type, input, userId));
}

export async function stockAt(productId: string, locationId: string) {
  const level = await prisma.stockLevel.findUnique({ where: { productId_locationId: { productId, locationId } } });
  return level ? level.quantity.toNumber() : 0;
}
