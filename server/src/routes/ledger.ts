import { MoveType, Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";

export const ledgerRouter = Router();

const locationSummary = { select: { id: true, name: true, warehouse: { select: { id: true, name: true, code: true } } } };

export const moveInclude = {
  product: { select: { id: true, name: true, sku: true, uom: true } },
  location: locationSummary,
  performedBy: { select: { id: true, name: true } },
  document: {
    select: {
      id: true,
      reference: true,
      type: true,
      partnerName: true,
      sourceLocation: locationSummary,
      destinationLocation: locationSummary,
    },
  },
} satisfies Prisma.StockMoveInclude;

const query = z.object({
  productId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  type: z.nativeEnum(MoveType).optional(),
  q: z.string().trim().max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});

ledgerRouter.get("/", async (req, res) => {
  const f = query.parse(req.query);
  const to = f.to ? new Date(f.to.getTime() + 24 * 60 * 60 * 1000 - 1) : undefined; // inclusive end date
  const where: Prisma.StockMoveWhereInput = {
    productId: f.productId,
    locationId: f.locationId,
    operationType: f.type,
    location: f.warehouseId ? { warehouseId: f.warehouseId } : undefined,
    product: f.categoryId ? { categoryId: f.categoryId } : undefined,
    createdAt: f.from || to ? { gte: f.from, lte: to } : undefined,
    OR: f.q
      ? [
          { product: { sku: { contains: f.q, mode: "insensitive" } } },
          { product: { name: { contains: f.q, mode: "insensitive" } } },
          { document: { reference: { contains: f.q, mode: "insensitive" } } },
          { document: { partnerName: { contains: f.q, mode: "insensitive" } } },
        ]
      : undefined,
  };
  const [items, total] = await Promise.all([
    prisma.stockMove.findMany({
      where,
      include: moveInclude,
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
    }),
    prisma.stockMove.count({ where }),
  ]);
  res.json({ items, total, page: f.page, pageSize: f.pageSize });
});
