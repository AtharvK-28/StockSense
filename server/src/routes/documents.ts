import { DocStatus, DocType, Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { broadcast } from "../lib/events";
import { forbidden, notFound } from "../lib/http";
import {
  OPEN_STATUSES,
  cancelDocument,
  confirmDocument,
  createDocument,
  packDocument,
  pickDocument,
  refreshAvailability,
  updateDraft,
  validateDocument,
} from "../services/documents";
import { ZERO } from "../services/stock";
import { moveInclude } from "./ledger";

export const documentsRouter = Router();

const uuid = z.string().uuid();
const locationSummary = { include: { warehouse: { select: { id: true, name: true, code: true } } } };

const lineSchema = z.object({
  productId: uuid,
  quantity: z.number().min(0).max(1_000_000_000).nullable().optional(),
  countedQuantity: z.number().min(0).max(1_000_000_000).nullable().optional(),
  notes: z.string().trim().max(300).nullable().optional(),
});

const documentSchema = z.object({
  partnerName: z.string().trim().max(120).nullable().optional(),
  deliveryAddress: z.string().trim().max(300).nullable().optional(),
  origin: z.string().trim().max(60).nullable().optional(),
  sourceLocationId: uuid.nullable().optional(),
  destinationLocationId: uuid.nullable().optional(),
  scheduledDate: z.coerce.date().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  lines: z.array(lineSchema).max(200),
});

const statusList = z
  .string()
  .optional()
  .transform((s) => (s ? s.split(",").filter(Boolean) : undefined))
  .pipe(z.array(z.nativeEnum(DocStatus)).optional());

export const filterSchema = z.object({
  type: z.nativeEnum(DocType).optional(),
  status: statusList,
  warehouseId: uuid.optional(),
  locationId: uuid.optional(),
  categoryId: uuid.optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

/** Where-clauses shared by the document list and dashboard KPIs. */
export function documentScope(f: {
  warehouseId?: string;
  locationId?: string;
  categoryId?: string;
  q?: string;
}): Prisma.DocumentWhereInput[] {
  const scope: Prisma.DocumentWhereInput[] = [];
  if (f.locationId) {
    scope.push({ OR: [{ sourceLocationId: f.locationId }, { destinationLocationId: f.locationId }] });
  }
  if (f.warehouseId) {
    scope.push({
      OR: [{ sourceLocation: { warehouseId: f.warehouseId } }, { destinationLocation: { warehouseId: f.warehouseId } }],
    });
  }
  if (f.categoryId) scope.push({ lines: { some: { product: { categoryId: f.categoryId } } } });
  if (f.q) {
    scope.push({
      OR: [
        { reference: { contains: f.q, mode: "insensitive" } },
        { partnerName: { contains: f.q, mode: "insensitive" } },
        { origin: { contains: f.q, mode: "insensitive" } },
        { lines: { some: { product: { sku: { contains: f.q, mode: "insensitive" } } } } },
        { lines: { some: { product: { name: { contains: f.q, mode: "insensitive" } } } } },
      ],
    });
  }
  return scope;
}

documentsRouter.get("/", async (req, res) => {
  const f = filterSchema.parse(req.query);
  const docs = await prisma.document.findMany({
    where: { type: f.type, status: f.status ? { in: f.status } : undefined, AND: documentScope(f) },
    include: {
      sourceLocation: locationSummary,
      destinationLocation: locationSummary,
      lines: { include: { product: { select: { id: true, name: true, sku: true, uom: true } } } },
    },
    orderBy: [{ scheduledDate: "desc" }, { createdAt: "desc" }],
    take: f.limit,
  });
  res.json({
    items: docs.map(({ lines, ...d }) => ({
      ...d,
      lineCount: lines.length,
      totalQuantity: lines.reduce((sum, l) => sum.plus(d.type === "adjustment" ? (l.countedQuantity ?? ZERO) : l.quantity), ZERO),
      products: lines.slice(0, 3).map((l) => l.product),
    })),
  });
});

async function documentDetail(id: string) {
  const doc = await prisma.document.findUnique({
    where: { id },
    include: {
      sourceLocation: locationSummary,
      destinationLocation: locationSummary,
      createdBy: { select: { id: true, name: true, loginId: true } },
      validatedBy: { select: { id: true, name: true } },
      lines: { include: { product: { include: { category: true } } }, orderBy: { id: "asc" } },
      moves: { include: moveInclude, orderBy: { createdAt: "asc" } },
    },
  });
  if (!doc) throw notFound("Document not found");

  // For open documents, show what's currently on hand at the relevant location.
  const stockLocationId = doc.sourceLocationId;
  const open = OPEN_STATUSES.includes(doc.status);
  const levels =
    open && stockLocationId
      ? await prisma.stockLevel.findMany({
          where: { locationId: stockLocationId, productId: { in: doc.lines.map((l) => l.productId) } },
        })
      : [];
  const onHand = new Map(levels.map((l) => [l.productId, l.quantity]));

  return {
    ...doc,
    lines: doc.lines.map((l) => ({
      ...l,
      available: open && stockLocationId ? (onHand.get(l.productId) ?? ZERO) : null,
    })),
  };
}

documentsRouter.post("/", async (req, res) => {
  const body = documentSchema.extend({ type: z.nativeEnum(DocType) }).parse(req.body);
  const { type, ...input } = body;
  const document = await prisma.$transaction((tx) => createDocument(tx, type, input, req.user!.id));
  broadcast("documents");
  res.status(201).json({ document: await documentDetail(document.id) });
});

documentsRouter.get("/:id", async (req, res) => {
  res.json({ document: await documentDetail(uuid.parse(req.params.id)) });
});

documentsRouter.put("/:id", async (req, res) => {
  const id = uuid.parse(req.params.id);
  await updateDraft(id, documentSchema.parse(req.body));
  broadcast("documents");
  res.json({ document: await documentDetail(id) });
});

const actions = {
  confirm: (id: string) => confirmDocument(id),
  check: () => refreshAvailability(),
  pick: (id: string) => pickDocument(id),
  pack: (id: string) => packDocument(id),
  validate: (id: string, userId: string) => validateDocument(id, userId),
  cancel: (id: string) => cancelDocument(id),
} satisfies Record<string, (id: string, userId: string) => Promise<void>>;

documentsRouter.post("/:id/:action", async (req, res) => {
  const id = uuid.parse(req.params.id);
  const action = z.enum(Object.keys(actions) as [keyof typeof actions]).parse(req.params.action);
  if (req.user!.role !== "manager") {
    if (action === "cancel") throw forbidden("Only inventory managers can cancel operations");
    if (action === "validate") {
      const doc = await prisma.document.findUnique({ where: { id }, select: { type: true } });
      if (doc?.type === "adjustment") throw forbidden("Only inventory managers can approve stock adjustments");
    }
  }
  await actions[action](id, req.user!.id);
  broadcast(action === "validate" ? "stock" : "documents");
  res.json({ document: await documentDetail(id) });
});
