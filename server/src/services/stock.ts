import { Prisma } from "@prisma/client";
import { prisma } from "../db";

export type StockStatus = "in" | "low" | "out";

export const ZERO = new Prisma.Decimal(0);

export function stockStatus(onHand: Prisma.Decimal, minQty: Prisma.Decimal | null): StockStatus {
  if (onHand.lte(0)) return "out";
  if (minQty && onHand.lte(minQty)) return "low";
  return "in";
}

/** Location ids belonging to a warehouse, or undefined when not filtering. */
export async function warehouseLocationIds(warehouseId?: string) {
  if (!warehouseId) return undefined;
  const locations = await prisma.location.findMany({ where: { warehouseId }, select: { id: true } });
  return locations.map((l) => l.id);
}

/** Total on-hand per product, optionally restricted to a set of locations. */
export async function onHandByProduct(locationIds?: string[]) {
  const rows = await prisma.stockLevel.groupBy({
    by: ["productId"],
    where: locationIds ? { locationId: { in: locationIds } } : undefined,
    _sum: { quantity: true },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.productId, r._sum.quantity ?? ZERO]));
}

/** Quantity to order so a product climbs back to its max (or 2× min) level. */
export function suggestedReorderQty(onHand: Prisma.Decimal, minQty: Prisma.Decimal | null, maxQty: Prisma.Decimal | null) {
  const target = maxQty ?? (minQty ? minQty.mul(2) : null);
  if (!target) return null;
  const qty = target.minus(onHand);
  return qty.gt(0) ? qty : null;
}
