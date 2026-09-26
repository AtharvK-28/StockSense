import type { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { managerOnly } from "../lib/auth";

/** Audit log of non-stock changes (manager only). Stock changes live in the ledger. */
export const auditRouter = Router();
auditRouter.use(managerOnly);

auditRouter.get("/", async (req, res) => {
  const f = z
    .object({
      q: z.string().trim().max(100).optional(),
      entityType: z.string().max(40).optional(),
      userId: z.string().uuid().optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(200).default(50),
    })
    .parse(req.query);
  const where: Prisma.AuditLogWhereInput = {
    entityType: f.entityType,
    userId: f.userId,
    summary: f.q ? { contains: f.q, mode: "insensitive" } : undefined,
  };
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { user: { select: { id: true, name: true, loginId: true } } },
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);
  res.json({ items, total, page: f.page, pageSize: f.pageSize });
});
