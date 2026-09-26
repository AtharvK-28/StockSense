import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { managerOnly } from "../lib/auth";
import { broadcast } from "../lib/events";
import { conflict } from "../lib/http";

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
  broadcast("settings");
  res.status(201).json({ category });
});

categoriesRouter.put("/:id", managerOnly, async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const category = await prisma.category.update({ where: { id }, data: nameSchema.parse(req.body) });
  broadcast("settings");
  res.json({ category });
});

categoriesRouter.delete("/:id", managerOnly, async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const inUse = await prisma.product.count({ where: { categoryId: id } });
  if (inUse) throw conflict(`This category still has ${inUse} product${inUse === 1 ? "" : "s"} — move them first`);
  await prisma.category.delete({ where: { id } });
  broadcast("settings");
  res.json({ ok: true });
});
