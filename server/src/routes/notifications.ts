import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { broadcast } from "../lib/events";

/** The signed-in user's notifications (bell menu). */
export const notificationsRouter = Router();

notificationsRouter.get("/", async (req, res) => {
  const userId = req.user!.id;
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  res.json({ items, unread });
});

notificationsRouter.post("/read-all", async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.user!.id, readAt: null }, data: { readAt: new Date() } });
  broadcast("notifications");
  res.json({ ok: true });
});

notificationsRouter.post("/:id/read", async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  await prisma.notification.updateMany({ where: { id, userId: req.user!.id, readAt: null }, data: { readAt: new Date() } });
  broadcast("notifications");
  res.json({ ok: true });
});
