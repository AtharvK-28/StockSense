import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { managerOnly, publicUser } from "../lib/auth";
import { broadcast } from "../lib/events";
import { conflict } from "../lib/http";
import { audit } from "../services/audit";
import { notify } from "../services/notify";

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
  const label = role === "manager" ? "Inventory manager" : "Warehouse staff";
  await audit(prisma, { userId: req.user!.id, action: "user.role", entityType: "user", entityId: id, summary: `Set ${user.name} (@${user.loginId}) to ${label}` });
  await notify({ userIds: [id], except: req.user!.id }, { kind: "role", title: `You're now ${label === "Inventory manager" ? "an" : "a"} ${label.toLowerCase()}`, body: `Changed by ${req.user!.name}. Log out and back in if menus look out of date.`, link: "/profile" });
  broadcast("settings");
  res.json({ user: publicUser(user) });
});
