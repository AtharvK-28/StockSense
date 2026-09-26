import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { ZERO, onHandByProduct } from "../services/stock";

export const searchRouter = Router();

searchRouter.get("/", async (req, res) => {
  const { q } = z.object({ q: z.string().trim().min(1).max(100) }).parse(req.query);
  const contains = { contains: q, mode: "insensitive" as const };
  const [products, documents, onHand] = await Promise.all([
    prisma.product.findMany({
      where: { OR: [{ sku: contains }, { name: contains }] },
      orderBy: { name: "asc" },
      take: 6,
      include: { category: { select: { name: true } } },
    }),
    prisma.document.findMany({
      where: { OR: [{ reference: contains }, { partnerName: contains }, { origin: contains }] },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, reference: true, type: true, status: true, partnerName: true },
    }),
    onHandByProduct(),
  ]);
  res.json({
    products: products.map((p) => ({ ...p, onHand: onHand.get(p.id) ?? ZERO })),
    documents,
  });
});
