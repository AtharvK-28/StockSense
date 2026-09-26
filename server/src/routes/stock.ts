import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { broadcast } from "../lib/events";
import { audit } from "../services/audit";
import { applyDocument, createDocument } from "../services/documents";
import { notify } from "../services/notify";

export const stockRouter = Router();

/**
 * "Update stock" from the Stock page: sets a product's quantity at a location, recorded as an
 * inventory adjustment. A manager's update is applied immediately; a staff member's count is
 * submitted (status Ready) for a manager to approve.
 */
stockRouter.post("/adjust", async (req, res) => {
  const body = z
    .object({
      productId: z.string().uuid(),
      locationId: z.string().uuid("Choose a location"),
      quantity: z.coerce.number().min(0, "Quantity can't be negative").max(1_000_000_000),
      reason: z.string().trim().max(300).nullable().optional(),
    })
    .parse(req.body);
  const userId = req.user!.id;
  const applied = req.user!.role === "manager";
  const document = await prisma.$transaction(async (tx) => {
    const doc = await createDocument(
      tx,
      "adjustment",
      {
        sourceLocationId: body.locationId,
        notes: "Updated from the Stock page",
        lines: [{ productId: body.productId, countedQuantity: body.quantity, notes: body.reason || "Stock update" }],
      },
      userId,
    );
    if (applied) await applyDocument(tx, doc.id, userId);
    else await tx.document.update({ where: { id: doc.id }, data: { status: "ready" } });
    return doc;
  });
  const product = await prisma.product.findUnique({ where: { id: body.productId }, select: { name: true, uom: true } });
  await audit(prisma, {
    userId,
    action: applied ? "stock.update" : "stock.count",
    entityType: "document",
    entityId: document.id,
    summary: `${applied ? "Set" : "Submitted count for"} ${product?.name} to ${body.quantity} ${product?.uom} (${document.reference})`,
  });
  if (!applied) {
    await notify(
      { role: "manager" },
      {
        kind: "approval",
        title: `${req.user!.name} submitted count ${document.reference}`,
        body: `${product?.name}: ${body.quantity} ${product?.uom}. Review and approve it to update stock.`,
        link: `/operations/adjustments/${document.id}`,
      },
    );
  }
  broadcast(applied ? "stock" : "documents");
  res.status(201).json({ document, applied });
});
