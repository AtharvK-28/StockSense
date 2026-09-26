import { DocStatus, DocType, MoveType, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { HttpError, badRequest, conflict, notFound } from "../lib/http";
import { ZERO } from "./stock";

type Tx = Prisma.TransactionClient;
type Client = Tx | typeof prisma;
type Decimal = Prisma.Decimal;

export const OPEN_STATUSES: DocStatus[] = ["draft", "waiting", "ready"];

const REFERENCE_CODE: Record<DocType, string> = {
  receipt: "IN",
  delivery: "OUT",
  transfer: "INT",
  adjustment: "ADJ",
};

/** Statuses from which each document type may be validated. */
const VALIDATABLE: Record<DocType, DocStatus[]> = {
  receipt: ["draft", "ready"],
  delivery: ["ready"],
  transfer: ["ready"],
  adjustment: ["draft", "ready"],
};

export interface DocumentLineInput {
  productId: string;
  quantity?: number | null;
  countedQuantity?: number | null;
  notes?: string | null;
}

export interface DocumentInput {
  partnerName?: string | null;
  origin?: string | null;
  sourceLocationId?: string | null;
  destinationLocationId?: string | null;
  scheduledDate?: Date;
  notes?: string | null;
  lines: DocumentLineInput[];
}

/** Which location fields a document type uses. */
export function usesLocations(type: DocType) {
  return { source: type !== "receipt", destination: type === "receipt" || type === "transfer" };
}

function normalize(type: DocType, input: DocumentInput) {
  const uses = usesLocations(type);
  const sourceLocationId = uses.source ? (input.sourceLocationId ?? null) : null;
  const destinationLocationId = uses.destination ? (input.destinationLocationId ?? null) : null;

  if (uses.source && !sourceLocationId) {
    throw badRequest(type === "adjustment" ? "Choose the location that was counted" : "Choose a source location");
  }
  if (uses.destination && !destinationLocationId) throw badRequest("Choose a destination location");
  if (type === "transfer" && sourceLocationId === destinationLocationId) {
    throw badRequest("Source and destination must be different locations");
  }
  if (input.lines.length === 0) throw badRequest("Add at least one product");

  const lines = input.lines.map((line) => {
    if (type === "adjustment") {
      if (line.countedQuantity == null || line.countedQuantity < 0) {
        throw badRequest("Enter a counted quantity (0 or more) for every product");
      }
      return { productId: line.productId, quantity: 0, countedQuantity: line.countedQuantity, notes: line.notes || null };
    }
    if (line.quantity == null || line.quantity <= 0) throw badRequest("Every quantity must be greater than zero");
    return { productId: line.productId, quantity: line.quantity, countedQuantity: null, notes: line.notes || null };
  });

  if (type === "adjustment" && new Set(lines.map((l) => l.productId)).size !== lines.length) {
    throw badRequest("Each product can only be counted once per adjustment");
  }

  return {
    partnerName: input.partnerName?.trim() || null,
    origin: input.origin?.trim() || null,
    sourceLocationId,
    destinationLocationId,
    scheduledDate: input.scheduledDate ?? new Date(),
    notes: input.notes?.trim() || null,
    lines,
  };
}

async function nextReference(tx: Tx, type: DocType, locationId: string) {
  const location = await tx.location.findUnique({ where: { id: locationId }, include: { warehouse: true } });
  if (!location) throw badRequest("That location no longer exists");
  const prefix = `${location.warehouse.code}/${REFERENCE_CODE[type]}/`;
  const seq = await tx.sequence.upsert({
    where: { prefix },
    create: { prefix, value: 1 },
    update: { value: { increment: 1 } },
  });
  return prefix + String(seq.value).padStart(4, "0");
}

export async function createDocument(tx: Tx, type: DocType, input: DocumentInput, userId: string) {
  const { lines, ...data } = normalize(type, input);
  const reference = await nextReference(tx, type, (data.sourceLocationId ?? data.destinationLocationId)!);
  return tx.document.create({
    data: { ...data, type, reference, createdById: userId, lines: { create: lines } },
  });
}

export async function updateDraft(id: string, input: DocumentInput) {
  return prisma.$transaction(async (tx) => {
    const doc = await tx.document.findUnique({ where: { id } });
    if (!doc) throw notFound("Document not found");
    if (doc.status !== "draft") throw conflict("Only draft documents can be edited");
    const { lines, ...data } = normalize(doc.type, input);
    await tx.documentLine.deleteMany({ where: { documentId: id } });
    return tx.document.update({ where: { id }, data: { ...data, lines: { create: lines } } });
  });
}

async function loadDocument(client: Client, id: string) {
  const doc = await client.document.findUnique({
    where: { id },
    include: {
      lines: { include: { product: true } },
      sourceLocation: { include: { warehouse: true } },
      destinationLocation: { include: { warehouse: true } },
    },
  });
  if (!doc) throw notFound("Document not found");
  return doc;
}

/** Atomically moves a document between statuses; fails if someone else moved it first. */
async function transition(
  client: Client,
  id: string,
  where: Omit<Prisma.DocumentWhereInput, "id">,
  data: Prisma.DocumentUncheckedUpdateManyInput,
) {
  const result = await client.document.updateMany({ where: { id, ...where }, data });
  if (result.count === 0) throw conflict("This document was changed by someone else — refresh and try again");
}

export interface Shortage {
  productId: string;
  needed: Decimal;
  available: Decimal;
}

/** Products on a delivery/transfer that the source location can't currently cover. */
export async function findShortages(
  client: Client,
  doc: { sourceLocationId: string | null; lines: { productId: string; quantity: Decimal }[] },
): Promise<Shortage[]> {
  if (!doc.sourceLocationId) return [];
  const needed = new Map<string, Decimal>();
  for (const line of doc.lines) needed.set(line.productId, (needed.get(line.productId) ?? ZERO).plus(line.quantity));
  const levels = await client.stockLevel.findMany({
    where: { locationId: doc.sourceLocationId, productId: { in: [...needed.keys()] } },
  });
  const available = new Map(levels.map((l) => [l.productId, l.quantity]));
  return [...needed]
    .map(([productId, qty]) => ({ productId, needed: qty, available: available.get(productId) ?? ZERO }))
    .filter((s) => s.available.lt(s.needed));
}

function requiresPartner(doc: { type: DocType; partnerName: string | null }) {
  if (doc.type === "receipt" && !doc.partnerName) throw badRequest("Add a supplier first");
  if (doc.type === "delivery" && !doc.partnerName) throw badRequest("Add a customer first");
}

/** Draft → Ready (or Waiting, when a delivery/transfer lacks stock at its source). */
export async function confirmDocument(id: string) {
  const doc = await loadDocument(prisma, id);
  if (doc.status !== "draft") throw conflict("Only draft documents can be confirmed");
  requiresPartner(doc);
  const needsStock = doc.type === "delivery" || doc.type === "transfer";
  const shortages = needsStock ? await findShortages(prisma, doc) : [];
  await transition(prisma, id, { status: "draft" }, { status: shortages.length ? "waiting" : "ready" });
}

/**
 * Re-evaluates open deliveries/transfers against current stock: Waiting → Ready when stock
 * arrived, Ready → Waiting when it was consumed elsewhere. Runs after every validation.
 */
export async function refreshAvailability() {
  const docs = await prisma.document.findMany({
    where: { type: { in: ["delivery", "transfer"] }, status: { in: ["waiting", "ready"] } },
    include: { lines: true },
  });
  for (const doc of docs) {
    const next: DocStatus = (await findShortages(prisma, doc)).length ? "waiting" : "ready";
    if (next !== doc.status) {
      await prisma.document.updateMany({ where: { id: doc.id, status: doc.status }, data: { status: next } });
    }
  }
}

export async function pickDocument(id: string) {
  const doc = await loadDocument(prisma, id);
  if (doc.type !== "delivery") throw badRequest("Only delivery orders are picked");
  if (doc.status !== "ready") throw conflict("A delivery must be Ready before items are picked");
  await transition(prisma, id, { status: "ready", pickedAt: null }, { pickedAt: new Date() });
}

export async function packDocument(id: string) {
  const doc = await loadDocument(prisma, id);
  if (doc.type !== "delivery") throw badRequest("Only delivery orders are packed");
  if (!doc.pickedAt) throw conflict("Pick the items before packing them");
  await transition(prisma, id, { status: "ready", pickedAt: { not: null }, packedAt: null }, { packedAt: new Date() });
}

export async function cancelDocument(id: string) {
  const doc = await loadDocument(prisma, id);
  if (!OPEN_STATUSES.includes(doc.status)) throw conflict(`A ${doc.status} document can't be canceled`);
  await transition(prisma, id, { status: { in: OPEN_STATUSES } }, { status: "canceled" });
}

/** Locks a product's stock row at a location (creating it at 0) and returns its quantity. */
async function lockStock(tx: Tx, productId: string, locationId: string) {
  const level = await tx.stockLevel.upsert({
    where: { productId_locationId: { productId, locationId } },
    create: { productId, locationId, quantity: 0 },
    update: { quantity: { increment: 0 } },
  });
  return level.quantity;
}

interface MoveArgs {
  documentId: string;
  userId: string;
  product: { id: string; name: string; uom: string };
  location: { id: string; name: string };
  delta: Decimal;
  operationType: MoveType;
}

/** The only code path that changes stock: writes a ledger entry and updates the cache. */
async function recordMove(tx: Tx, m: MoveArgs) {
  const current = await lockStock(tx, m.product.id, m.location.id);
  const balance = current.plus(m.delta);
  if (balance.isNegative()) {
    throw new HttpError(409, `Not enough ${m.product.name} at ${m.location.name}: ${current} ${m.product.uom} on hand, ${m.delta.neg()} needed`, {
      productId: m.product.id,
      locationId: m.location.id,
    });
  }
  await tx.stockLevel.update({
    where: { productId_locationId: { productId: m.product.id, locationId: m.location.id } },
    data: { quantity: balance },
  });
  await tx.stockMove.create({
    data: {
      documentId: m.documentId,
      productId: m.product.id,
      locationId: m.location.id,
      quantityDelta: m.delta,
      balanceAfter: balance,
      operationType: m.operationType,
      performedById: m.userId,
    },
  });
}

/**
 * Stock Ledger Engine. Applies a document's stock impact inside the caller's transaction:
 * either every ledger entry and stock update lands, or none do.
 */
export async function applyDocument(tx: Tx, id: string, userId: string) {
  const doc = await loadDocument(tx, id);
  if (!VALIDATABLE[doc.type].includes(doc.status)) {
    if (doc.status === "waiting") throw conflict("Not enough stock at the source location yet");
    if (doc.status === "draft") throw conflict("Confirm this document before validating it");
    throw conflict(`A ${doc.status} document can't be validated`);
  }
  requiresPartner(doc);
  if (doc.type === "delivery" && !doc.packedAt) throw conflict("Pick and pack the items before validating");

  // Claim the document first so two people validating at once can't both apply it.
  await transition(tx, id, { status: doc.status }, { status: "done", validatedAt: new Date(), validatedById: userId });

  const source = doc.sourceLocation;
  const destination = doc.destinationLocation;
  for (const line of doc.lines) {
    const base = { documentId: id, userId, product: line.product };
    switch (doc.type) {
      case "receipt":
        await recordMove(tx, { ...base, location: destination!, delta: line.quantity, operationType: "receipt" });
        break;
      case "delivery":
        await recordMove(tx, { ...base, location: source!, delta: line.quantity.neg(), operationType: "delivery" });
        break;
      case "transfer":
        await recordMove(tx, { ...base, location: source!, delta: line.quantity.neg(), operationType: "transfer_out" });
        await recordMove(tx, { ...base, location: destination!, delta: line.quantity, operationType: "transfer_in" });
        break;
      case "adjustment": {
        const recorded = await lockStock(tx, line.productId, source!.id);
        const delta = line.countedQuantity!.minus(recorded);
        await tx.documentLine.update({ where: { id: line.id }, data: { recordedQuantity: recorded, quantity: delta } });
        if (!delta.isZero()) await recordMove(tx, { ...base, location: source!, delta, operationType: "adjustment" });
        break;
      }
    }
  }
}

export async function validateDocument(id: string, userId: string) {
  await prisma.$transaction((tx) => applyDocument(tx, id, userId), { timeout: 15_000 });
  await refreshAvailability();
}
