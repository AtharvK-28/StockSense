import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { managerOnly } from "../lib/auth";
import { broadcast } from "../lib/events";
import { conflict } from "../lib/http";
import { audit } from "../services/audit";

export const categoriesRouter = Router();

const nameSchema = z.object({ name: z.string().trim().min(2, "Enter a category name").max(60) });

categoriesRouter.get("/", async (_req, res) => {
  const categories = await prisma.category.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { products: true } } },
  });
  res.json({ items: categories.map(({ _count, ...c }) => ({ ...c, productCount: _count.products })) });
});

categoriesRouter.post("/", managerOnly, async (req, res) => {
  const category = await prisma.category.create({ data: nameSchema.parse(req.body) });
  await audit(prisma, { userId: req.user!.id, action: "category.create", entityType: "category", entityId: category.id, summary: `Created category ${category.name}` });
  broadcast("settings");
  res.status(201).json({ category });
});

categoriesRouter.put("/:id", managerOnly, async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const before = await prisma.category.findUnique({ where: { id } });
  const category = await prisma.category.update({ where: { id }, data: nameSchema.parse(req.body) });
  await audit(prisma, {
    userId: req.user!.id,
    action: "category.update",
    entityType: "category",
    entityId: id,
    summary: `Renamed category ${before?.name} → ${category.name}`,
  });
  broadcast("settings");
  res.json({ category });
});

categoriesRouter.delete("/:id", managerOnly, async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const inUse = await prisma.product.count({ where: { categoryId: id } });
  if (inUse) throw conflict(`This category still has ${inUse} product${inUse === 1 ? "" : "s"} — move them first`);
  const deleted = await prisma.category.delete({ where: { id } });
  await audit(prisma, { userId: req.user!.id, action: "category.delete", entityType: "category", entityId: id, summary: `Deleted category ${deleted.name}` });
  broadcast("settings");
  res.json({ ok: true });
});
