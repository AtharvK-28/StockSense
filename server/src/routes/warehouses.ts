import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireRole } from "../lib/auth";
import { broadcast } from "../lib/events";
import { audit, diff } from "../services/audit";
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
  latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
  longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
}).refine((w) => (w.latitude == null) === (w.longitude == null), { path: ["latitude"], message: "Set both latitude and longitude, or neither" });
const locationSchema = z.object({
  name: z.string().trim().min(1, "Enter a location name").max(60),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{1,8}$/, "Short code must be 1–8 letters or numbers")
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
});
const newLocationSchema = locationSchema.extend({ warehouseId: uuid });

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
  await audit(prisma, { userId: req.user!.id, action: "warehouse.create", entityType: "warehouse", entityId: warehouse.id, summary: `Created warehouse ${warehouse.code} ${warehouse.name}` });
  broadcast("settings");
  res.status(201).json({ warehouse });
});

warehousesRouter.put("/:id", requireRole("manager"), async (req, res) => {
  const id = uuid.parse(req.params.id);
  const before = await prisma.warehouse.findUnique({ where: { id } });
  const warehouse = await prisma.warehouse.update({ where: { id }, data: warehouseSchema.parse(req.body) });
  await audit(prisma, {
    userId: req.user!.id,
    action: "warehouse.update",
    entityType: "warehouse",
    entityId: id,
    summary: `Updated warehouse ${warehouse.code} ${warehouse.name}`,
    changes: before ? diff(before, warehouse, ["name", "code", "address", "latitude", "longitude"]) : null,
  });
  broadcast("settings");
  res.json({ warehouse });
});

warehousesRouter.post("/:id/locations", requireRole("manager"), async (req, res) => {
  const warehouseId = uuid.parse(req.params.id);
  const location = await prisma.location.create({ data: { warehouseId, ...locationSchema.parse(req.body) } });
  await audit(prisma, { userId: req.user!.id, action: "location.create", entityType: "location", entityId: location.id, summary: `Created location ${location.name}` });
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

locationsRouter.post("/", requireRole("manager"), async (req, res) => {
  const location = await prisma.location.create({ data: newLocationSchema.parse(req.body) });
  await audit(prisma, { userId: req.user!.id, action: "location.create", entityType: "location", entityId: location.id, summary: `Created location ${location.name}` });
  broadcast("settings");
  res.status(201).json({ location });
});

/** On-hand quantity per product at one location (used while drafting deliveries and counts). */
locationsRouter.get("/:id/stock", async (req, res) => {
  const locationId = uuid.parse(req.params.id);
  const levels = await prisma.stockLevel.findMany({ where: { locationId }, select: { productId: true, quantity: true } });
  res.json({ items: levels });
});

locationsRouter.put("/:id", requireRole("manager"), async (req, res) => {
  const id = uuid.parse(req.params.id);
  const before = await prisma.location.findUnique({ where: { id } });
  const location = await prisma.location.update({ where: { id }, data: newLocationSchema.partial().parse(req.body) });
  await audit(prisma, {
    userId: req.user!.id,
    action: "location.update",
    entityType: "location",
    entityId: id,
    summary: `Updated location ${location.name}`,
    changes: before ? diff(before, location, ["name", "code", "warehouseId"]) : null,
  });
  broadcast("settings");
  res.json({ location });
});
