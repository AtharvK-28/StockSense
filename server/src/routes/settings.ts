import { Router } from "express";
import { prisma } from "../db";
import { managerOnly } from "../lib/auth";
import { broadcast } from "../lib/events";
import { audit, diff } from "../services/audit";
import { getSettings, settingsSchema, updateSettings } from "../services/settings";

export const settingsRouter = Router();

settingsRouter.get("/", async (_req, res) => {
  res.json({ settings: await getSettings() });
});

settingsRouter.put("/", managerOnly, async (req, res) => {
  const patch = settingsSchema.partial().parse(req.body);
  const before = await getSettings();
  const settings = await updateSettings(patch);
  await audit(prisma, {
    userId: req.user!.id,
    action: "settings.update",
    entityType: "settings",
    summary: "Updated company settings",
    changes: diff(before, settings, Object.keys(patch)),
  });
  broadcast("settings");
  res.json({ settings });
});
