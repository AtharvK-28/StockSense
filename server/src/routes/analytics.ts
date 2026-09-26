import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { warehouseLocationIds } from "../services/stock";

/**
 * Analytics built from the stock ledger. Historical stock is reconstructed by replaying ledger
 * entries backwards from today's stock levels, so no snapshot tables are needed.
 */
export const analyticsRouter = Router();

const DAY = 24 * 60 * 60 * 1000;
const dayKey = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
};
const num = (d: Prisma.Decimal | null | undefined) => (d ? d.toNumber() : 0);

const filters = z.object({
  days: z.coerce.number().int().min(7).max(365).default(30),
  warehouseId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
});

analyticsRouter.get("/", async (req, res) => {
  const f = filters.parse(req.query);
  const locationIds = await warehouseLocationIds(f.warehouseId);
  const today = dayKey(new Date());
  const start = new Date(today - (f.days - 1) * DAY);

  const [products, levels, moves] = await Promise.all([
    prisma.product.findMany({ where: { categoryId: f.categoryId }, include: { category: true } }),
    prisma.stockLevel.findMany({
      where: { locationId: locationIds ? { in: locationIds } : undefined, product: f.categoryId ? { categoryId: f.categoryId } : undefined },
    }),
    prisma.stockMove.findMany({
      where: {
        createdAt: { gte: start },
        locationId: locationIds ? { in: locationIds } : undefined,
        product: f.categoryId ? { categoryId: f.categoryId } : undefined,
      },
      select: { productId: true, quantityDelta: true, operationType: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const cost = new Map(products.map((p) => [p.id, num(p.unitCost)]));
  const units = new Map<string, number>();
  for (const l of levels) units.set(l.productId, (units.get(l.productId) ?? 0) + num(l.quantity));

  // Group moves per day.
  const byDay = new Map<number, typeof moves>();
  for (const m of moves) {
    const k = dayKey(m.createdAt);
    byDay.set(k, [...(byDay.get(k) ?? []), m]);
  }

  // Walk backwards: record end-of-day totals, then undo that day's moves.
  const running = new Map(units);
  const series: { date: string; value: number; units: number; inQty: number; outQty: number; inValue: number; outValue: number }[] = [];
  for (let k = today; k >= start.getTime(); k -= DAY) {
    let value = 0;
    let totalUnits = 0;
    for (const [pid, q] of running) {
      value += q * (cost.get(pid) ?? 0);
      totalUnits += q;
    }
    let inQty = 0,
      outQty = 0,
      inValue = 0,
      outValue = 0;
    for (const m of byDay.get(k) ?? []) {
      const q = num(m.quantityDelta);
      running.set(m.productId, (running.get(m.productId) ?? 0) - q);
      // Transfers are internal; count them only when they cross the filtered boundary.
      const external = m.operationType === "receipt" || m.operationType === "delivery" || m.operationType === "adjustment" || !!locationIds;
      if (!external) continue;
      if (q > 0) {
        inQty += q;
        inValue += q * (cost.get(m.productId) ?? 0);
      } else {
        outQty -= q;
        outValue -= q * (cost.get(m.productId) ?? 0);
      }
    }
    series.push({ date: new Date(k).toISOString(), value, units: totalUnits, inQty, outQty, inValue, outValue });
  }
  series.reverse();

  // Per-product movement in the window.
  const shipped = new Map<string, number>();
  const lastOut = new Map<string, Date>();
  for (const m of moves) {
    if (m.operationType !== "delivery" && m.operationType !== "transfer_out") continue;
    if (m.operationType === "delivery") shipped.set(m.productId, (shipped.get(m.productId) ?? 0) - num(m.quantityDelta));
    if (!lastOut.has(m.productId)) lastOut.set(m.productId, m.createdAt);
  }
  const lastEver = await prisma.stockMove.groupBy({
    by: ["productId"],
    where: { operationType: { in: ["delivery", "transfer_out"] }, productId: { in: products.map((p) => p.id) } },
    _max: { createdAt: true },
  });
  const lastEverOut = new Map(lastEver.map((r) => [r.productId, r._max.createdAt]));

  const rows = products.map((p) => {
    const onHand = units.get(p.id) ?? 0;
    const out = shipped.get(p.id) ?? 0;
    const avgDailyOut = out / f.days;
    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      uom: p.uom,
      category: p.category?.name ?? "Uncategorised",
      onHand,
      unitCost: num(p.unitCost),
      value: onHand * num(p.unitCost),
      shipped: out,
      shippedValue: out * num(p.unitCost),
      daysOfCover: avgDailyOut > 0 ? onHand / avgDailyOut : null,
      lastShippedAt: lastEverOut.get(p.id) ?? null,
    };
  });

  const topMovers = rows.filter((r) => r.shipped > 0).sort((a, b) => b.shippedValue - a.shippedValue).slice(0, 6);
  const deadStock = rows
    .filter((r) => r.onHand > 0 && !lastOut.has(r.id))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  const categories = new Map<string, { category: string; value: number; units: number }>();
  for (const r of rows) {
    const c = categories.get(r.category) ?? { category: r.category, value: 0, units: 0 };
    c.value += r.value;
    c.units += r.onHand;
    categories.set(r.category, c);
  }

  const avgValue = series.reduce((s, d) => s + d.value, 0) / series.length;
  const outValue = series.reduce((s, d) => s + d.outValue, 0);
  const first = series[0]!;
  const last = series[series.length - 1]!;
  res.json({
    days: f.days,
    kpis: {
      stockValue: last.value,
      valueChange: last.value - first.value,
      unitsShipped: series.reduce((s, d) => s + d.outQty, 0),
      unitsReceived: series.reduce((s, d) => s + d.inQty, 0),
      // Cost of goods shipped in the window ÷ average stock value in the window.
      turnover: avgValue > 0 ? outValue / avgValue : 0,
      deadStockValue: rows.filter((r) => r.onHand > 0 && !lastOut.has(r.id)).reduce((s, r) => s + r.value, 0),
    },
    series,
    topMovers,
    deadStock,
    byCategory: [...categories.values()].filter((c) => c.value > 0 || c.units > 0).sort((a, b) => b.value - a.value),
  });
});

/** Stock valuation grouped by product, location or category (feeds the Reports tab and CSV export). */
analyticsRouter.get("/valuation", async (req, res) => {
  const f = z
    .object({
      groupBy: z.enum(["product", "location", "category"]).default("product"),
      warehouseId: z.string().uuid().optional(),
    })
    .parse(req.query);
  const locationIds = await warehouseLocationIds(f.warehouseId);
  const levels = await prisma.stockLevel.findMany({
    where: { quantity: { gt: 0 }, locationId: locationIds ? { in: locationIds } : undefined },
    include: {
      product: { include: { category: true } },
      location: { include: { warehouse: { select: { code: true, name: true } } } },
    },
  });

  const groups = new Map<string, { key: string; label: string; sublabel: string | null; quantity: number; value: number; uom: string | null; unitCost: number | null; lines: number }>();
  for (const l of levels) {
    const qty = num(l.quantity);
    const value = qty * num(l.product.unitCost);
    const [key, label, sublabel] =
      f.groupBy === "product"
        ? [l.productId, l.product.name, l.product.sku]
        : f.groupBy === "location"
          ? [l.locationId, `${l.location.warehouse.code} / ${l.location.name}`, l.location.warehouse.name]
          : [l.product.categoryId ?? "none", l.product.category?.name ?? "Uncategorised", null];
    const g = groups.get(key) ?? { key, label, sublabel, quantity: 0, value: 0, uom: null, unitCost: null, lines: 0 };
    g.quantity += qty;
    g.value += value;
    g.lines += 1;
    if (f.groupBy === "product") {
      g.uom = l.product.uom;
      g.unitCost = num(l.product.unitCost);
    }
    groups.set(key, g);
  }
  const items = [...groups.values()].sort((a, b) => b.value - a.value);
  res.json({ groupBy: f.groupBy, items, total: items.reduce((s, g) => s + g.value, 0) });
});


