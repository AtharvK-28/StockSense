import type { DocType } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { OPEN_STATUSES } from "../services/documents";
import { ZERO, onHandByProduct, stockStatus, suggestedReorderQty, warehouseLocationIds } from "../services/stock";
import { documentScope } from "./documents";
import { moveInclude } from "./ledger";

export const dashboardRouter = Router();

dashboardRouter.get("/", async (req, res) => {
  const f = z
    .object({
      warehouseId: z.string().uuid().optional(),
      locationId: z.string().uuid().optional(),
      categoryId: z.string().uuid().optional(),
    })
    .parse(req.query);
  // A specific location narrows further than its warehouse.
  const locationIds = f.locationId ? [f.locationId] : await warehouseLocationIds(f.warehouseId);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [products, onHand, companyOnHand] = await Promise.all([
    prisma.product.findMany({ where: { categoryId: f.categoryId }, include: { category: true } }),
    onHandByProduct(locationIds),
    locationIds ? onHandByProduct() : null,
  ]);
  // `qty` follows the warehouse/location filter; reordering rules are company-wide, so low/out
  // status (and the alerts built from it) always uses total stock.
  const rows = products.map((p) => {
    const total = (companyOnHand ?? onHand).get(p.id) ?? ZERO;
    return { p, qty: onHand.get(p.id) ?? ZERO, total, status: stockStatus(total, p.minQty) };
  });

  const scope = documentScope(f);
  const count = (type: DocType, extra: object = {}) =>
    prisma.document.count({ where: { type, status: { in: OPEN_STATUSES }, AND: scope, ...extra } });
  const late = { scheduledDate: { lt: startOfToday } };

  const [receipts, receiptsLate, receiptsReady, deliveries, deliveriesLate, deliveriesWaiting, deliveriesReady, transfers, transfersLate, recentMoves] =
    await Promise.all([
      count("receipt"),
      count("receipt", late),
      count("receipt", { status: "ready" }),
      count("delivery"),
      count("delivery", late),
      count("delivery", { status: "waiting" }),
      count("delivery", { status: "ready" }),
      count("transfer"),
      count("transfer", late),
      prisma.stockMove.findMany({
        where: {
          locationId: locationIds ? { in: locationIds } : undefined,
          product: f.categoryId ? { categoryId: f.categoryId } : undefined,
        },
        include: moveInclude,
        orderBy: { createdAt: "desc" },
        take: 8,
      }),
    ]);

  const severity = { out: 0, low: 1, in: 2 } as const;
  const alerts = rows
    .filter((r) => r.status !== "in")
    .sort((a, b) => severity[a.status] - severity[b.status] || a.total.comparedTo(b.total))
    .slice(0, 8)
    .map(({ p, total, status }) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      uom: p.uom,
      category: p.category?.name ?? null,
      onHand: total,
      minQty: p.minQty,
      maxQty: p.maxQty,
      status,
      suggestedQty: suggestedReorderQty(total, p.minQty, p.maxQty),
    }));

  const awaitingApproval = await prisma.document.findMany({
    where: { type: "adjustment", status: "ready", AND: scope },
    include: {
      createdBy: { select: { name: true } },
      sourceLocation: { include: { warehouse: { select: { code: true } } } },
      lines: { include: { product: { select: { name: true, uom: true } } } },
    },
    orderBy: { createdAt: "asc" },
    take: 6,
  });

  res.json({
    awaitingApproval: awaitingApproval.map((d) => ({
      id: d.id,
      type: d.type,
      reference: d.reference,
      createdAt: d.createdAt,
      submittedBy: d.createdBy.name,
      location: d.sourceLocation ? `${d.sourceLocation.warehouse.code} / ${d.sourceLocation.name}` : null,
      summary: d.lines.map((l) => `${l.product.name}: ${l.countedQuantity} ${l.product.uom}`).join(", "),
    })),
    kpis: {
      totalProducts: products.length,
      inStock: rows.filter((r) => r.qty.gt(0)).length,
      lowStock: rows.filter((r) => r.status === "low").length,
      outOfStock: rows.filter((r) => r.status === "out").length,
      totalUnits: rows.reduce((sum, r) => sum.plus(r.qty), ZERO),
      pendingReceipts: { total: receipts, late: receiptsLate, ready: receiptsReady },
      pendingDeliveries: { total: deliveries, late: deliveriesLate, waiting: deliveriesWaiting, ready: deliveriesReady },
      scheduledTransfers: { total: transfers, late: transfersLate },
    },
    alerts,
    recentMoves,
  });
});
