import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireRole } from "../lib/auth";
import { broadcast } from "../lib/events";
import { ZERO } from "../services/stock";

export const warehousesRouter = Router();
export const locationsRouter = Router();

const uuid = z.string().uuid();
const warehouseSchema = z.object({
  name: z.string().trim().min(2, "Enter a warehouse name").max(80),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,6}$/, "Code must be 2–6 letters or numbers, e.g. WH"),
  address: z.string().trim().max(200).nullable().optional(),
});
const locationSchema = z.object({ name: z.string().trim().min(1, "Enter a location name").max(60) });

warehousesRouter.get("/", async (_req, res) => {
  const warehouses = await prisma.warehouse.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      locations: {
        orderBy: { createdAt: "asc" },
        include: { stockLevels: { where: { quantity: { gt: 0 } }, select: { quantity: true } } },
      },
    },
  });
  res.json({
    items: warehouses.map((w) => ({
      ...w,
      locations: w.locations.map(({ stockLevels, ...l }) => ({
        ...l,
        productCount: stockLevels.length,
        totalQuantity: stockLevels.reduce((sum, s) => sum.plus(s.quantity), ZERO),
      })),
    })),
  });
});

warehousesRouter.post("/", requireRole("manager"), async (req, res) => {
  const data = warehouseSchema.parse(req.body);
  // Every warehouse starts with a default "Stock" location so it's usable immediately.
  const warehouse = await prisma.warehouse.create({ data: { ...data, locations: { create: [{ name: "Stock" }] } } });
  broadcast("settings");
  res.status(201).json({ warehouse });
});

warehousesRouter.put("/:id", requireRole("manager"), async (req, res) => {
  const id = uuid.parse(req.params.id);
  const warehouse = await prisma.warehouse.update({ where: { id }, data: warehouseSchema.parse(req.body) });
  broadcast("settings");
  res.json({ warehouse });
});

warehousesRouter.post("/:id/locations", requireRole("manager"), async (req, res) => {
  const warehouseId = uuid.parse(req.params.id);
  const location = await prisma.location.create({ data: { warehouseId, ...locationSchema.parse(req.body) } });
  broadcast("settings");
  res.status(201).json({ location });
});

locationsRouter.get("/", async (_req, res) => {
  const locations = await prisma.location.findMany({
    include: { warehouse: { select: { id: true, name: true, code: true } } },
    orderBy: [{ warehouse: { createdAt: "asc" } }, { createdAt: "asc" }],
  });
  res.json({ items: locations.map((l) => ({ ...l, fullName: `${l.warehouse.code} / ${l.name}` })) });
});

/** On-hand quantity per product at one location (used while drafting deliveries and counts). */
locationsRouter.get("/:id/stock", async (req, res) => {
  const locationId = uuid.parse(req.params.id);
  const levels = await prisma.stockLevel.findMany({ where: { locationId }, select: { productId: true, quantity: true } });
  res.json({ items: levels });
});

locationsRouter.put("/:id", requireRole("manager"), async (req, res) => {
  const id = uuid.parse(req.params.id);
  const location = await prisma.location.update({ where: { id }, data: locationSchema.parse(req.body) });
  broadcast("settings");
  res.json({ location });
});
