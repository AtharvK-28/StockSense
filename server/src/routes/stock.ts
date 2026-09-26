import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { broadcast } from "../lib/events";
import { applyDocument, createDocument } from "../services/documents";

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
  broadcast(applied ? "stock" : "documents");
  res.status(201).json({ document, applied });
});
