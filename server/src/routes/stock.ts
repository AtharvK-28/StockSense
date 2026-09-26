import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { broadcast } from "../lib/events";
import { applyDocument, createDocument } from "../services/documents";

export const stockRouter = Router();

/**
 * "Update stock" from the Stock page: sets a product's quantity at a location. It is recorded as a
 * validated inventory adjustment, so the change appears in the ledger like any other.
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
    await applyDocument(tx, doc.id, userId);
    return doc;
  });
  broadcast("stock");
  res.status(201).json({ document });
});
