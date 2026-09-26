import { DocStatus, DocType, MoveType, Prisma } from "@prisma/client";
import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { type Cell, fmtDate, toCsv, toJsonRecords } from "../lib/csv";
import { forbidden, notFound } from "../lib/http";
import { createZip } from "../lib/zip";
import { audit } from "../services/audit";
import { ZERO, onHandByProduct, reservedByProduct, stockStatus, warehouseLocationIds } from "../services/stock";
import { documentScope, filterSchema } from "./documents";

/**
 * Downloads. Every dataset is available as CSV (opens in Excel/Sheets) or JSON, honours the same
 * filters as the page it comes from, and `/all` bundles everything the user may see into one ZIP.
 */
export const exportRouter = Router();

interface Table {
  header: string[];
  rows: Cell[][];
}

interface Dataset {
  label: string;
  description: string;
  managerOnly?: boolean;
  build: (query: Request["query"]) => Promise<Table>;
}

const uuid = z.string().uuid();
const dateRange = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() });
/** Inclusive end date: "to=2026-09-26" covers the whole day. */
const endOfDay = (d?: Date) => (d ? new Date(d.getTime() + 24 * 60 * 60 * 1000 - 1) : undefined);
const between = (from?: Date, to?: Date) => (from || to ? { gte: from, lte: endOfDay(to) } : undefined);

const STATUS_LABEL: Record<DocStatus, string> = { draft: "Draft", waiting: "Waiting", ready: "Ready", done: "Done", canceled: "Canceled" };
const TYPE_LABEL: Record<DocType, string> = { receipt: "Receipt", delivery: "Delivery", transfer: "Internal transfer", adjustment: "Adjustment" };
const MOVE_LABEL: Record<MoveType, string> = {
  receipt: "Receipt",
  delivery: "Delivery",
  transfer_in: "Transfer in",
  transfer_out: "Transfer out",
  adjustment: "Adjustment",
};
const STOCK_LABEL = { in: "In stock", low: "Low stock", out: "Out of stock" } as const;

type LocationWithWarehouse = { name: string; warehouse: { code: string } } | null;
const locName = (l: LocationWithWarehouse) => (l ? `${l.warehouse.code} / ${l.name}` : null);
const locationInclude = { include: { warehouse: { select: { code: true, name: true } } } };

const documentFilters = filterSchema.omit({ limit: true }).merge(dateRange);

function documentWhere(query: Request["query"]): Prisma.DocumentWhereInput {
  const f = documentFilters.parse(query);
  return {
    type: f.type,
    status: f.status ? { in: f.status } : undefined,
    scheduledDate: between(f.from, f.to),
    AND: documentScope(f),
  };
}

const DATASETS: Record<string, Dataset> = {
  products: {
    label: "Products",
    description: "Catalog with stock, value and reordering rules",
    async build(query) {
      const f = z
        .object({
          q: z.string().trim().max(100).optional(),
          categoryId: uuid.optional(),
          warehouseId: uuid.optional(),
          stock: z.enum(["in", "low", "out", "alert"]).optional(),
        })
        .parse(query);
      const locationIds = await warehouseLocationIds(f.warehouseId);
      const [products, onHand, reserved] = await Promise.all([
        prisma.product.findMany({
          where: {
            categoryId: f.categoryId,
            OR: f.q ? [{ sku: { contains: f.q, mode: "insensitive" } }, { name: { contains: f.q, mode: "insensitive" } }] : undefined,
          },
          include: { category: true },
          orderBy: { name: "asc" },
        }),
        onHandByProduct(locationIds),
        reservedByProduct(locationIds),
      ]);
      const rows: Cell[][] = [];
      for (const p of products) {
        const qty = onHand.get(p.id) ?? ZERO;
        const held = reserved.get(p.id) ?? ZERO;
        const status = stockStatus(qty, p.minQty);
        if (f.stock && (f.stock === "alert" ? status === "in" : status !== f.stock)) continue;
        const free = qty.minus(held);
        rows.push([
          p.sku,
          p.name,
          p.category?.name,
          p.uom,
          p.unitCost,
          qty,
          held,
          free.isNegative() ? ZERO : free,
          p.unitCost ? p.unitCost.mul(qty).toDecimalPlaces(2) : null,
          p.minQty,
          p.maxQty,
          STOCK_LABEL[status],
        ]);
      }
      return {
        header: ["SKU", "Product", "Category", "Unit", "Unit cost", "On hand", "Reserved", "Free to use", "Stock value", "Reorder at (min)", "Replenish up to (max)", "Status"],
        rows,
      };
    },
  },

  stock: {
    label: "Stock by location",
    description: "On-hand quantity of every product at every location",
    async build(query) {
      const f = z.object({ q: z.string().trim().max(100).optional(), categoryId: uuid.optional(), warehouseId: uuid.optional() }).parse(query);
      const levels = await prisma.stockLevel.findMany({
        where: {
          quantity: { not: 0 },
          location: f.warehouseId ? { warehouseId: f.warehouseId } : undefined,
          product: {
            categoryId: f.categoryId,
            OR: f.q ? [{ sku: { contains: f.q, mode: "insensitive" } }, { name: { contains: f.q, mode: "insensitive" } }] : undefined,
          },
        },
        include: { product: { include: { category: true } }, location: { include: { warehouse: true } } },
        orderBy: [{ location: { warehouse: { createdAt: "asc" } } }, { location: { createdAt: "asc" } }, { product: { name: "asc" } }],
      });
      return {
        header: ["Warehouse", "Location", "SKU", "Product", "Category", "Unit", "Quantity", "Unit cost", "Value", "Last changed"],
        rows: levels.map((l) => [
          l.location.warehouse.name,
          locName(l.location),
          l.product.sku,
          l.product.name,
          l.product.category?.name,
          l.product.uom,
          l.quantity,
          l.product.unitCost,
          l.product.unitCost ? l.product.unitCost.mul(l.quantity).toDecimalPlaces(2) : null,
          l.updatedAt,
        ]),
      };
    },
  },

  documents: {
    label: "Operations",
    description: "Receipts, deliveries, transfers and adjustments (one row per document)",
    async build(query) {
      const docs = await prisma.document.findMany({
        where: documentWhere(query),
        include: {
          sourceLocation: locationInclude,
          destinationLocation: locationInclude,
          createdBy: { select: { name: true } },
          validatedBy: { select: { name: true } },
          backorderOf: { select: { reference: true } },
          returnOf: { select: { reference: true } },
          lines: { select: { quantity: true, doneQuantity: true, countedQuantity: true } },
        },
        orderBy: [{ scheduledDate: "desc" }, { createdAt: "desc" }],
      });
      return {
        header: [
          "Reference", "Type", "Status", "Partner", "Source document", "From", "To", "Scheduled", "Lines", "Total quantity",
          "Created by", "Created", "Validated by", "Validated", "Backorder of", "Return of", "Delivery address", "Notes",
        ],
        rows: docs.map((d) => [
          d.reference,
          TYPE_LABEL[d.type],
          d.type === "adjustment" && d.status === "ready" ? "Awaiting approval" : STATUS_LABEL[d.status],
          d.partnerName,
          d.origin,
          locName(d.sourceLocation),
          locName(d.destinationLocation),
          fmtDate(d.scheduledDate),
          d.lines.length,
          d.lines.reduce((sum, l) => sum.plus(d.type === "adjustment" ? (l.countedQuantity ?? ZERO) : (l.doneQuantity ?? l.quantity)), ZERO),
          d.createdBy.name,
          d.createdAt,
          d.validatedBy?.name,
          d.validatedAt,
          d.backorderOf?.reference,
          d.returnOf?.reference,
          d.deliveryAddress,
          d.notes,
        ]),
      };
    },
  },

  "document-lines": {
    label: "Operation lines",
    description: "Every product line on every operation, with demand and done quantities",
    async build(query) {
      const lines = await prisma.documentLine.findMany({
        where: { document: documentWhere(query) },
        include: {
          document: { select: { reference: true, type: true, status: true, scheduledDate: true, partnerName: true } },
          product: { select: { sku: true, name: true, uom: true } },
        },
        orderBy: [{ document: { scheduledDate: "desc" } }, { document: { reference: "asc" } }, { id: "asc" }],
      });
      return {
        header: ["Reference", "Type", "Status", "Scheduled", "Partner", "SKU", "Product", "Unit", "Demand", "Done", "Counted", "Recorded before count", "Line notes"],
        rows: lines.map((l) => [
          l.document.reference,
          TYPE_LABEL[l.document.type],
          STATUS_LABEL[l.document.status],
          fmtDate(l.document.scheduledDate),
          l.document.partnerName,
          l.product.sku,
          l.product.name,
          l.product.uom,
          l.document.type === "adjustment" ? null : l.quantity,
          l.document.type === "adjustment" ? l.quantity : l.doneQuantity,
          l.countedQuantity,
          l.recordedQuantity,
          l.notes,
        ]),
      };
    },
  },

  moves: {
    label: "Stock ledger",
    description: "Every stock movement with the balance after it (move history)",
    async build(query) {
      const f = z
        .object({
          productId: uuid.optional(),
          locationId: uuid.optional(),
          warehouseId: uuid.optional(),
          categoryId: uuid.optional(),
          type: z.nativeEnum(MoveType).optional(),
          q: z.string().trim().max(100).optional(),
        })
        .merge(dateRange)
        .parse(query);
      const moves = await prisma.stockMove.findMany({
        where: {
          productId: f.productId,
          locationId: f.locationId,
          operationType: f.type,
          location: f.warehouseId ? { warehouseId: f.warehouseId } : undefined,
          product: f.categoryId ? { categoryId: f.categoryId } : undefined,
          createdAt: between(f.from, f.to),
          OR: f.q
            ? [
                { product: { sku: { contains: f.q, mode: "insensitive" } } },
                { product: { name: { contains: f.q, mode: "insensitive" } } },
                { document: { reference: { contains: f.q, mode: "insensitive" } } },
                { document: { partnerName: { contains: f.q, mode: "insensitive" } } },
              ]
            : undefined,
        },
        include: {
          product: { select: { sku: true, name: true, uom: true } },
          location: locationInclude,
          document: { select: { reference: true, partnerName: true } },
          performedBy: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
      });
      return {
        header: ["Date", "Reference", "Operation", "Partner", "SKU", "Product", "Unit", "Warehouse", "Location", "Change", "Balance after", "By"],
        rows: moves.map((m) => [
          m.createdAt,
          m.document.reference,
          MOVE_LABEL[m.operationType],
          m.document.partnerName,
          m.product.sku,
          m.product.name,
          m.product.uom,
          m.location.warehouse.name,
          locName(m.location),
          m.quantityDelta,
          m.balanceAfter,
          m.performedBy.name,
        ]),
      };
    },
  },

  categories: {
    label: "Categories",
    description: "Product categories and how many products each holds",
    async build() {
      const categories = await prisma.category.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { products: true } } } });
      return { header: ["Category", "Products", "Created"], rows: categories.map((c) => [c.name, c._count.products, c.createdAt]) };
    },
  },

  locations: {
    label: "Warehouses & locations",
    description: "Sites with address and map pin, and the locations inside them",
    async build() {
      const warehouses = await prisma.warehouse.findMany({
        orderBy: { createdAt: "asc" },
        include: { locations: { orderBy: { createdAt: "asc" }, include: { stockLevels: { where: { quantity: { gt: 0 } }, select: { quantity: true } } } } },
      });
      return {
        header: ["Warehouse code", "Warehouse", "Address", "Latitude", "Longitude", "Location", "Location code", "Products stocked", "Units on hand"],
        rows: warehouses.flatMap((w) =>
          w.locations.map((l) => [
            w.code,
            w.name,
            w.address,
            w.latitude,
            w.longitude,
            l.name,
            l.code,
            l.stockLevels.length,
            l.stockLevels.reduce((sum, s) => sum.plus(s.quantity), ZERO),
          ]),
        ),
      };
    },
  },

  team: {
    label: "Team",
    description: "Users and their roles",
    managerOnly: true,
    async build() {
      const users = await prisma.user.findMany({ orderBy: [{ role: "asc" }, { createdAt: "asc" }] });
      return {
        header: ["Login ID", "Name", "Email", "Role", "Joined"],
        rows: users.map((u) => [u.loginId, u.name, u.email, u.role === "manager" ? "Inventory manager" : "Warehouse staff", u.createdAt]),
      };
    },
  },

  audit: {
    label: "Audit log",
    description: "Who changed products, costs, rules, settings and roles",
    managerOnly: true,
    async build(query) {
      const f = dateRange.parse(query);
      const logs = await prisma.auditLog.findMany({
        where: { createdAt: between(f.from, f.to) },
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      });
      return {
        header: ["When", "User", "Action", "Record type", "Summary", "Changes"],
        rows: logs.map((l) => [l.createdAt, l.user?.name ?? "System", l.action, l.entityType, l.summary, l.changes ? JSON.stringify(l.changes) : null]),
      };
    },
  },
};

const canSee = (req: Request, d: Dataset) => !d.managerOnly || req.user!.role === "manager";
const stamp = () => fmtDate(new Date());

exportRouter.get("/", (req, res) => {
  res.json({
    items: Object.entries(DATASETS)
      .filter(([, d]) => canSee(req, d))
      .map(([key, d]) => ({ key, label: d.label, description: d.description })),
  });
});

/** Everything the user may see, as CSV files in one ZIP. `from`/`to` narrow operations, the ledger and the audit log. */
exportRouter.get("/all", async (req, res) => {
  const { from, to } = dateRange.parse(req.query);
  const range = { ...(from && { from: fmtDate(from) }), ...(to && { to: fmtDate(to) }) };
  const entries = Object.entries(DATASETS).filter(([, d]) => canSee(req, d));
  const files = await Promise.all(
    entries.map(async ([key, d]) => {
      const t = await d.build(["documents", "document-lines", "moves", "audit"].includes(key) ? range : {});
      return { name: `${key}.csv`, data: toCsv(t.header, t.rows) };
    }),
  );
  await audit(prisma, { userId: req.user!.id, action: "data.export", entityType: "export", summary: "Downloaded a full data export (ZIP)" });
  res.set({ "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="stocksense-export-${stamp()}.zip"` });
  res.send(createZip(files));
});

exportRouter.get("/:dataset", async (req, res) => {
  const key = String(req.params.dataset);
  const dataset = DATASETS[key];
  if (!dataset) throw notFound("No such export");
  if (!canSee(req, dataset)) throw forbidden("Only inventory managers can export this");
  const { format } = z.object({ format: z.enum(["csv", "json"]).default("csv") }).parse({ format: req.query.format });
  const table = await dataset.build(req.query);
  await audit(prisma, { userId: req.user!.id, action: "data.export", entityType: "export", summary: `Downloaded ${dataset.label} (${format.toUpperCase()}, ${table.rows.length} rows)` });
  const filename = `stocksense-${key}-${stamp()}.${format}`;
  res.set("Content-Disposition", `attachment; filename="${filename}"`);
  if (format === "json") res.type("application/json").send(JSON.stringify(toJsonRecords(table.header, table.rows), null, 2));
  else res.type("text/csv; charset=utf-8").send(toCsv(table.header, table.rows));
});
