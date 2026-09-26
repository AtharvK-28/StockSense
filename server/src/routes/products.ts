import { Prisma, type Category, type Product } from "@prisma/client";
import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { managerOnly } from "../lib/auth";
import { broadcast } from "../lib/events";
import { audit, diff } from "../services/audit";
import { HttpError, badRequest, notFound } from "../lib/http";
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
    imageUrl: productImageUrl(p),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/** Versioned URL of a product's photo, or null. The version lets browsers cache it forever. */
export function productImageUrl(p: { id: string; imageUpdatedAt: Date | null }) {
  return p.imageUpdatedAt ? `/api/products/${p.id}/image?v=${p.imageUpdatedAt.getTime()}` : null;
}

/** Recognises the image formats we accept from their first bytes (never trust the declared type). */
function sniffImage(buf: Buffer): string | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length > 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
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

productsRouter.get("/:id/image", async (req, res) => {
  const id = uuid.parse(req.params.id);
  const image = await prisma.productImage.findUnique({ where: { productId: id } });
  if (!image) throw notFound("No photo for this product");
  res.set({
    "Content-Type": image.contentType,
    "X-Content-Type-Options": "nosniff",
    // The URL carries a version, so a new photo gets a new URL.
    "Cache-Control": req.query.v ? "private, max-age=31536000, immutable" : "private, no-cache",
  });
  res.send(Buffer.from(image.data));
});

/** Upload or replace the photo: the raw image bytes (JPEG, PNG or WebP, up to 2 MB) as the body. */
productsRouter.put(
  "/:id/image",
  managerOnly,
  express.raw({ type: () => true, limit: "2mb" }),
  async (req, res) => {
    const id = uuid.parse(req.params.id);
    const body = req.body as unknown;
    if (!Buffer.isBuffer(body) || body.length === 0) throw badRequest("Choose an image to upload");
    const contentType = sniffImage(body);
    if (!contentType) throw new HttpError(415, "Use a JPEG, PNG or WebP image");
    if (!(await prisma.product.findUnique({ where: { id }, select: { id: true } }))) throw notFound("Product not found");
    const data = new Uint8Array(body);
    const product = await prisma.$transaction(async (tx) => {
      await tx.productImage.upsert({
        where: { productId: id },
        create: { productId: id, contentType, data },
        update: { contentType, data },
      });
      const product = await tx.product.update({ where: { id }, data: { imageUpdatedAt: new Date() } });
      await audit(tx, { userId: req.user!.id, action: "product.update", entityType: "product", entityId: id, summary: `Changed the photo of ${product.sku} ${product.name}` });
      return product;
    });
    broadcast("products");
    res.json({ imageUrl: productImageUrl(product) });
  },
);

productsRouter.delete("/:id/image", managerOnly, async (req, res) => {
  const id = uuid.parse(req.params.id);
  const product = await prisma.$transaction(async (tx) => {
    await tx.productImage.deleteMany({ where: { productId: id } });
    const product = await tx.product.update({ where: { id }, data: { imageUpdatedAt: null } });
    await audit(tx, { userId: req.user!.id, action: "product.update", entityType: "product", entityId: id, summary: `Removed the photo of ${product.sku} ${product.name}` });
    return product;
  });
  broadcast("products");
  res.json({ imageUrl: null });
});
