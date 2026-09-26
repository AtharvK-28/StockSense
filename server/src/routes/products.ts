import { Prisma, type Category, type Product } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { managerOnly } from "../lib/auth";
import { broadcast } from "../lib/events";
import { audit, diff } from "../services/audit";
import { badRequest, notFound } from "../lib/http";
import { OPEN_STATUSES, applyDocument, createDocument } from "../services/documents";
import { ZERO, onHandByProduct, reservedByProduct, stockStatus, suggestedReorderQty, warehouseLocationIds } from "../services/stock";
import { moveInclude } from "./ledger";

export const productsRouter = Router();

const uuid = z.string().uuid();
const qty = z.coerce.number().min(0, "Quantities can't be negative").max(1_000_000_000);

const productFields = z.object({
  name: z.string().trim().min(2, "Enter a product name").max(120),
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, "Enter a SKU")
    .max(40)
    .regex(/^[A-Z0-9._/-]+$/, "SKU can only use letters, numbers and . _ / -"),
  categoryId: uuid.nullable().optional(),
  uom: z.string().trim().min(1, "Choose a unit of measure").max(20),
  unitCost: z.coerce.number().min(0, "Cost can't be negative").max(1_000_000_000).nullable().optional(),
  minQty: qty.nullable().optional(),
  maxQty: qty.nullable().optional(),
});

const maxAboveMin = (d: { minQty?: number | null; maxQty?: number | null }, ctx: z.RefinementCtx) => {
  if (d.minQty != null && d.maxQty != null && d.maxQty < d.minQty) {
    ctx.addIssue({ code: "custom", path: ["maxQty"], message: "Max quantity must be at least the min quantity" });
  }
};

const createSchema = productFields
  .extend({
    initialStock: z.object({ locationId: uuid, quantity: z.coerce.number().positive().max(1_000_000_000) }).nullable().optional(),
  })
  .superRefine(maxAboveMin);
const updateSchema = productFields.superRefine(maxAboveMin);
const ruleSchema = z.object({ minQty: qty.nullable(), maxQty: qty.nullable() }).superRefine(maxAboveMin);

function productRow(p: Product & { category: Category | null }, onHand: Prisma.Decimal, reserved: Prisma.Decimal = ZERO) {
  const free = onHand.minus(reserved);
  return {
    id: p.id,
    name: p.name,
    sku: p.sku,
    uom: p.uom,
    unitCost: p.unitCost,
    reserved,
    freeQty: free.isNegative() ? ZERO : free,
    category: p.category ? { id: p.category.id, name: p.category.name } : null,
    minQty: p.minQty,
    maxQty: p.maxQty,
    onHand,
    status: stockStatus(onHand, p.minQty),
    suggestedQty: suggestedReorderQty(onHand, p.minQty, p.maxQty),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

productsRouter.get("/", async (req, res) => {
  const f = z
    .object({
      q: z.string().trim().max(100).optional(),
      categoryId: uuid.optional(),
      warehouseId: uuid.optional(),
      stock: z.enum(["in", "low", "out", "alert"]).optional(),
      withRules: z.enum(["true", "false"]).optional(),
    })
    .parse(req.query);

  const locationIds = await warehouseLocationIds(f.warehouseId);
  const [products, onHand, reserved] = await Promise.all([
    prisma.product.findMany({
      where: {
        categoryId: f.categoryId,
        minQty: f.withRules === "true" ? { not: null } : undefined,
        OR: f.q
          ? [{ sku: { contains: f.q, mode: "insensitive" } }, { name: { contains: f.q, mode: "insensitive" } }]
          : undefined,
      },
      include: { category: true },
      orderBy: { name: "asc" },
    }),
    onHandByProduct(locationIds),
    reservedByProduct(locationIds),
  ]);

  const rows = products
    .map((p) => productRow(p, onHand.get(p.id) ?? ZERO, reserved.get(p.id) ?? ZERO))
    .filter((p) => !f.stock || (f.stock === "alert" ? p.status !== "in" : p.status === f.stock));
  res.json({ items: rows });
});

productsRouter.post("/", managerOnly, async (req, res) => {
  const { initialStock, ...data } = createSchema.parse(req.body);
  const userId = req.user!.id;
  const product = await prisma.$transaction(async (tx) => {
    const product = await tx.product.create({ data });
    if (initialStock) {
      // Opening stock goes through the ledger like everything else.
      const doc = await createDocument(
        tx,
        "adjustment",
        {
          sourceLocationId: initialStock.locationId,
          notes: "Opening stock",
          lines: [{ productId: product.id, countedQuantity: initialStock.quantity, notes: "Opening stock" }],
        },
        userId,
      );
      await applyDocument(tx, doc.id, userId);
    }
    await audit(tx, { userId, action: "product.create", entityType: "product", entityId: product.id, summary: `Created product ${product.sku} ${product.name}` });
    return product;
  });
  broadcast("products");
  res.status(201).json({ product });
});

productsRouter.get("/:id", async (req, res) => {
  const id = uuid.parse(req.params.id);
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      category: true,
      stockLevels: {
        include: { location: { include: { warehouse: true } } },
        orderBy: { quantity: "desc" },
      },
    },
  });
  if (!product) throw notFound("Product not found");

  const [moves, openLines] = await Promise.all([
    prisma.stockMove.findMany({ where: { productId: id }, include: moveInclude, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.documentLine.findMany({
      where: { productId: id, document: { status: { in: OPEN_STATUSES }, type: { in: ["receipt", "delivery"] } } },
      include: { document: { select: { type: true } } },
    }),
  ]);

  const onHand = product.stockLevels.reduce((sum, l) => sum.plus(l.quantity), ZERO);
  const reserved = (await reservedByProduct()).get(id) ?? ZERO;
  const sumOf = (type: string) =>
    openLines.filter((l) => l.document.type === type).reduce((sum, l) => sum.plus(l.quantity), ZERO);

  res.json({
    product: {
      ...productRow(product, onHand, reserved),
      incoming: sumOf("receipt"),
      outgoing: sumOf("delivery"),
      stock: product.stockLevels
        .filter((l) => !l.quantity.isZero())
        .map((l) => ({
          locationId: l.locationId,
          location: l.location.name,
          warehouse: { id: l.location.warehouse.id, name: l.location.warehouse.name, code: l.location.warehouse.code },
          quantity: l.quantity,
          updatedAt: l.updatedAt,
        })),
    },
    moves,
  });
});

productsRouter.put("/:id", managerOnly, async (req, res) => {
  const id = uuid.parse(req.params.id);
  const data = updateSchema.parse(req.body);
  const before = await prisma.product.findUnique({ where: { id } });
  if (!before) throw notFound("Product not found");
  const product = await prisma.product.update({ where: { id }, data });
  await audit(prisma, {
    userId: req.user!.id,
    action: "product.update",
    entityType: "product",
    entityId: id,
    summary: `Updated product ${product.sku} ${product.name}`,
    changes: diff(before, product, ["name", "sku", "categoryId", "uom", "unitCost", "minQty", "maxQty"]),
  });
  broadcast("products");
  res.json({ product });
});

productsRouter.put("/:id/rule", managerOnly, async (req, res) => {
  const id = uuid.parse(req.params.id);
  const data = ruleSchema.parse(req.body);
  const before = await prisma.product.findUnique({ where: { id } });
  if (!before) throw notFound("Product not found");
  const product = await prisma.product.update({ where: { id }, data });
  await audit(prisma, {
    userId: req.user!.id,
    action: "product.update",
    entityType: "product",
    entityId: id,
    summary: `Changed reordering rule for ${product.sku} ${product.name}`,
    changes: diff(before, product, ["minQty", "maxQty"]),
  });
  broadcast("products");
  res.json({ product });
});

/** Turns a reordering rule into a draft receipt for the suggested quantity. */
productsRouter.post("/:id/replenish", managerOnly, async (req, res) => {
  const id = uuid.parse(req.params.id);
  const body = z.object({ locationId: uuid.optional(), quantity: z.coerce.number().positive().optional() }).parse(req.body ?? {});
  const product = await prisma.product.findUnique({ where: { id }, include: { stockLevels: { orderBy: { quantity: "desc" } } } });
  if (!product) throw notFound("Product not found");

  const onHand = product.stockLevels.reduce((sum, l) => sum.plus(l.quantity), ZERO);
  const quantity = body.quantity ?? suggestedReorderQty(onHand, product.minQty, product.maxQty)?.toNumber();
  if (!quantity) throw badRequest("Set a reordering rule (min/max) or enter a quantity to replenish");

  const locationId =
    body.locationId ??
    product.stockLevels[0]?.locationId ??
    (await prisma.location.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } }))?.id;
  if (!locationId) throw badRequest("Create a warehouse location first");

  const document = await prisma.$transaction((tx) =>
    createDocument(
      tx,
      "receipt",
      { destinationLocationId: locationId, origin: "Reorder rule", lines: [{ productId: id, quantity }] },
      req.user!.id,
    ),
  );
  broadcast("documents");
  res.status(201).json({ document });
});
