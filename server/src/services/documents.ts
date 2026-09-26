import { DocStatus, DocType, MoveType, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { HttpError, badRequest, conflict, notFound } from "../lib/http";
import { audit } from "./audit";
import { notify } from "./notify";
import { getSettings } from "./settings";
import { ZERO, suggestedReorderQty } from "./stock";

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
  deliveryAddress?: string | null;
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
    deliveryAddress: type === "delivery" ? input.deliveryAddress?.trim() || null : null,
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

export async function createDocument(
  tx: Tx,
  type: DocType,
  input: DocumentInput,
  userId: string,
  links: { returnOfId?: string } = {},
) {
  const { lines, ...data } = normalize(type, input);
  const reference = await nextReference(tx, type, (data.sourceLocationId ?? data.destinationLocationId)!);
  return tx.document.create({
    data: { ...data, ...links, type, reference, createdById: userId, lines: { create: lines } },
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
 * Returns the documents that just became Ready.
 */
export async function refreshAvailability() {
  const docs = await prisma.document.findMany({
    where: { type: { in: ["delivery", "transfer"] }, status: { in: ["waiting", "ready"] } },
    include: { lines: true },
  });
  const promoted: { id: string; type: DocType; reference: string; createdById: string }[] = [];
  for (const doc of docs) {
    const next: DocStatus = (await findShortages(prisma, doc)).length ? "waiting" : "ready";
    if (next !== doc.status) {
      const moved = await prisma.document.updateMany({ where: { id: doc.id, status: doc.status }, data: { status: next } });
      if (moved.count && next === "ready") promoted.push(doc);
    }
  }
  return promoted;
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
  return doc;
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
  at?: Date;
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
      createdAt: m.at,
    },
  });
}

export interface ValidateOptions {
  /** Quantities actually processed per line id (received / shipped / moved). Missing = full demand. */
  done?: { id: string; doneQuantity: number }[];
  /** When less than the demand was processed, carry the remainder into a new document. */
  backorder?: boolean;
  /** Backdate the validation (demo seed only). */
  at?: Date;
  /** Skip notifications and auto-reorder (demo seed only). */
  quiet?: boolean;
}

export interface ValidationResult {
  document: { id: string; type: DocType; reference: string; createdById: string };
  backorder: { id: string; reference: string } | null;
  /** Net stock change per product caused by this validation. */
  deltas: Map<string, Decimal>;
}

/**
 * Stock Ledger Engine. Applies a document's stock impact inside the caller's transaction:
 * either every ledger entry and stock update lands, or none do.
 */
export async function applyDocument(tx: Tx, id: string, userId: string, opts: ValidateOptions = {}): Promise<ValidationResult> {
  const doc = await loadDocument(tx, id);
  if (!VALIDATABLE[doc.type].includes(doc.status)) {
    if (doc.status === "waiting") throw conflict("Not enough stock at the source location yet");
    if (doc.status === "draft") throw conflict("Confirm this document before validating it");
    throw conflict(`A ${doc.status} document can't be validated`);
  }
  requiresPartner(doc);
  if (doc.type === "delivery" && !doc.packedAt) throw conflict("Pick and pack the items before validating");

  // Quantities actually processed; default to the full demand.
  const doneById = new Map((opts.done ?? []).map((d) => [d.id, d.doneQuantity]));
  for (const lineId of doneById.keys()) {
    if (!doc.lines.some((l) => l.id === lineId)) throw badRequest("That line isn't on this document");
  }
  const processed = new Map(
    doc.lines.map((l) => {
      const d = doneById.get(l.id);
      if (d != null && (!Number.isFinite(d) || d < 0)) throw badRequest("Processed quantities can't be negative");
      return [l.id, d == null ? l.quantity : new Prisma.Decimal(d)];
    }),
  );
  if (doc.type !== "adjustment" && [...processed.values()].every((q) => q.isZero())) {
    throw badRequest("Nothing to validate — enter at least one processed quantity");
  }

  const at = opts.at ?? new Date();
  // Claim the document first so two people validating at once can't both apply it.
  await transition(tx, id, { status: doc.status }, { status: "done", validatedAt: at, validatedById: userId });

  const deltas = new Map<string, Decimal>();
  const addDelta = (productId: string, d: Decimal) => deltas.set(productId, (deltas.get(productId) ?? ZERO).plus(d));
  const source = doc.sourceLocation;
  const destination = doc.destinationLocation;
  for (const line of doc.lines) {
    const base = { documentId: id, userId, product: line.product, at };
    const qty = processed.get(line.id)!;
    if (doc.type !== "adjustment") {
      await tx.documentLine.update({ where: { id: line.id }, data: { doneQuantity: qty } });
      if (qty.isZero()) continue;
    }
    switch (doc.type) {
      case "receipt":
        await recordMove(tx, { ...base, location: destination!, delta: qty, operationType: "receipt" });
        addDelta(line.productId, qty);
        break;
      case "delivery":
        await recordMove(tx, { ...base, location: source!, delta: qty.neg(), operationType: "delivery" });
        addDelta(line.productId, qty.neg());
        break;
      case "transfer":
        await recordMove(tx, { ...base, location: source!, delta: qty.neg(), operationType: "transfer_out" });
        await recordMove(tx, { ...base, location: destination!, delta: qty, operationType: "transfer_in" });
        break;
      case "adjustment": {
        const recorded = await lockStock(tx, line.productId, source!.id);
        const delta = line.countedQuantity!.minus(recorded);
        await tx.documentLine.update({ where: { id: line.id }, data: { recordedQuantity: recorded, quantity: delta } });
        if (!delta.isZero()) {
          await recordMove(tx, { ...base, location: source!, delta, operationType: "adjustment" });
          addDelta(line.productId, delta);
        }
        break;
      }
    }
  }

  // Backorder: carry whatever wasn't processed into a new document.
  let backorder: ValidationResult["backorder"] = null;
  const remaining = doc.lines
    .map((l) => ({ line: l, qty: l.quantity.minus(processed.get(l.id)!) }))
    .filter((r) => doc.type !== "adjustment" && r.qty.gt(0));
  if (opts.backorder && remaining.length) {
    const reference = await nextReference(tx, doc.type, (doc.sourceLocationId ?? doc.destinationLocationId)!);
    const created = await tx.document.create({
      data: {
        type: doc.type,
        status: "ready",
        reference,
        partnerName: doc.partnerName,
        deliveryAddress: doc.deliveryAddress,
        origin: doc.origin,
        sourceLocationId: doc.sourceLocationId,
        destinationLocationId: doc.destinationLocationId,
        scheduledDate: doc.scheduledDate,
        notes: doc.notes,
        createdById: doc.createdById,
        backorderOfId: doc.id,
        lines: { create: remaining.map((r) => ({ productId: r.line.productId, quantity: r.qty, notes: r.line.notes })) },
      },
    });
    backorder = { id: created.id, reference: created.reference };
  }

  return { document: doc, backorder, deltas };
}

export async function validateDocument(id: string, userId: string, opts: ValidateOptions = {}) {
  const result = await prisma.$transaction((tx) => applyDocument(tx, id, userId, opts), { timeout: 15_000 });
  const promoted = await refreshAvailability();
  if (!opts.quiet) await afterValidation(result, userId, promoted);
  return result;
}

/** Side effects of a validation: approval notices, low-stock alerts and automatic reorders. */
async function afterValidation(result: ValidationResult, userId: string, promoted: Awaited<ReturnType<typeof refreshAvailability>>) {
  const { document: doc } = result;
  try {
    if (doc.type === "adjustment" && doc.createdById !== userId) {
      await notify({ userIds: [doc.createdById] }, { kind: "approved", title: `Your count ${doc.reference} was approved`, link: docLink(doc) });
    }
    for (const p of promoted) {
      await notify({ userIds: [p.createdById], except: userId }, { kind: "ready", title: `${p.reference} is ready`, body: "The stock it was waiting for has arrived.", link: docLink(p) });
    }

    const settings = await getSettings();
    for (const [productId, delta] of result.deltas) {
      if (!delta.isNegative()) continue;
      const product = await prisma.product.findUnique({ where: { id: productId } });
      if (!product?.minQty) continue;
      const total = (await prisma.stockLevel.aggregate({ where: { productId }, _sum: { quantity: true } }))._sum.quantity ?? ZERO;
      const before = total.minus(delta);
      if (!(before.gt(product.minQty) && total.lte(product.minQty))) continue; // only on crossing the reorder point

      await notify(
        { role: "manager" },
        {
          kind: total.lte(0) ? "out_of_stock" : "low_stock",
          title: total.lte(0) ? `${product.name} is out of stock` : `${product.name} is low on stock`,
          body: `${total} ${product.uom} left · reorder point ${product.minQty}`,
          link: `/products/${product.id}`,
        },
      );
      if (settings.autoReorder) await autoReorder(product, total);
    }
  } catch (err) {
    console.error("[afterValidation]", err);
  }
}

const docLink = (d: { type: DocType; id: string }) =>
  `/operations/${{ receipt: "receipts", delivery: "deliveries", transfer: "transfers", adjustment: "adjustments" }[d.type]}/${d.id}`;

/** Drafts a replenishment receipt unless one is already open for the product. */
async function autoReorder(product: { id: string; name: string; uom: string; minQty: Decimal | null; maxQty: Decimal | null }, total: Decimal) {
  const alreadyOpen = await prisma.documentLine.count({
    where: { productId: product.id, document: { type: "receipt", status: { in: OPEN_STATUSES } } },
  });
  if (alreadyOpen) return;
  const quantity = suggestedReorderQty(total, product.minQty, product.maxQty);
  if (!quantity) return;
  const location =
    (await prisma.stockLevel.findFirst({ where: { productId: product.id }, orderBy: { quantity: "desc" } }))?.locationId ??
    (await prisma.location.findFirst({ orderBy: { createdAt: "asc" } }))?.id;
  const owner = await prisma.user.findFirst({ where: { role: "manager" }, orderBy: { createdAt: "asc" } });
  if (!location || !owner) return;

  const draft = await prisma.$transaction((tx) =>
    createDocument(
      tx,
      "receipt",
      {
        destinationLocationId: location,
        origin: "Auto-reorder",
        notes: `Created automatically when ${product.name} reached its reorder point.`,
        lines: [{ productId: product.id, quantity: quantity.toNumber() }],
      },
      owner.id,
    ),
  );
  await audit(prisma, {
    userId: null,
    action: "document.auto_reorder",
    entityType: "document",
    entityId: draft.id,
    summary: `Auto-reorder drafted ${draft.reference} for ${quantity} ${product.uom} ${product.name}`,
  });
  await notify(
    { role: "manager" },
    { kind: "auto_reorder", title: `Draft ${draft.reference} created`, body: `Reorder ${quantity} ${product.uom} of ${product.name} — add a supplier and confirm.`, link: docLink(draft) },
  );
}

/**
 * Starts a return for a validated document: the goods go back the way they came
 * (delivery → receipt from the customer, receipt → delivery to the vendor, transfer → reverse transfer).
 * Only what hasn't already been returned is proposed.
 */
export async function createReturn(id: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const doc = await loadDocument(tx, id);
    if (doc.status !== "done") throw conflict("Only validated documents can be returned");
    if (doc.type === "adjustment") throw badRequest("Adjustments can't be returned — count the stock again instead");

    const returnedLines = await tx.documentLine.findMany({
      where: { document: { returnOfId: id, status: { not: "canceled" } } },
    });
    const returned = new Map<string, Decimal>();
    for (const l of returnedLines) returned.set(l.productId, (returned.get(l.productId) ?? ZERO).plus(l.doneQuantity ?? l.quantity));

    const lines = doc.lines
      .map((l) => {
        const already = returned.get(l.productId) ?? ZERO;
        const qty = Prisma.Decimal.max(ZERO, (l.doneQuantity ?? l.quantity).minus(already));
        returned.set(l.productId, Prisma.Decimal.max(ZERO, already.minus(l.doneQuantity ?? l.quantity)));
        return { productId: l.productId, quantity: qty.toNumber() };
      })
      .filter((l) => l.quantity > 0);
    if (lines.length === 0) throw conflict("Everything on this document has already been returned");

    const type: DocType = doc.type === "receipt" ? "delivery" : doc.type === "delivery" ? "receipt" : "transfer";
    const input: DocumentInput = {
      partnerName: doc.partnerName,
      origin: `Return of ${doc.reference}`,
      sourceLocationId: doc.type === "receipt" ? doc.destinationLocationId : doc.type === "transfer" ? doc.destinationLocationId : null,
      destinationLocationId: doc.type === "delivery" ? doc.sourceLocationId : doc.type === "transfer" ? doc.sourceLocationId : null,
      notes: `Return of ${doc.reference}`,
      lines,
    };
    return createDocument(tx, type, input, userId, { returnOfId: doc.id });
  });
}
