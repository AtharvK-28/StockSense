import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { managerOnly, publicUser } from "../lib/auth";
import { broadcast } from "../lib/events";
import { conflict } from "../lib/http";

/** Team management: managers see everyone and decide who is a manager. */
export const usersRouter = Router();
usersRouter.use(managerOnly);

usersRouter.get("/", async (_req, res) => {
  const users = await prisma.user.findMany({
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    include: { _count: { select: { createdDocs: true, validatedDocs: true } } },
  });
  res.json({
    items: users.map((u) => ({ ...publicUser(u), created: u._count.createdDocs, validated: u._count.validatedDocs })),
  });
});

usersRouter.put("/:id/role", async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const { role } = z.object({ role: z.enum(["manager", "staff"]) }).parse(req.body);
  const user = await prisma.$transaction(async (tx) => {
    if (role === "staff") {
      const managers = await tx.user.count({ where: { role: "manager", id: { not: id } } });
      if (managers === 0) throw conflict("StockSense needs at least one inventory manager");
    }
    return tx.user.update({ where: { id }, data: { role } });
  });
  broadcast("settings");
  res.json({ user: publicUser(user) });
});
