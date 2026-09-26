import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { publicUser } from "../lib/auth";
import { badRequest } from "../lib/http";
import { password } from "./auth";

export const profileRouter = Router();

profileRouter.get("/", async (req, res) => {
  const user = req.user!;
  const [created, validated] = await Promise.all([
    prisma.document.count({ where: { createdById: user.id } }),
    prisma.document.count({ where: { validatedById: user.id } }),
  ]);
  res.json({ user: publicUser(user), stats: { created, validated } });
});

profileRouter.put("/", async (req, res) => {
  const body = z
    .object({
      name: z.string().trim().min(2, "Enter your name").max(80),
      email: z.string().trim().toLowerCase().email("Enter a valid email address"),
    })
    .parse(req.body);
  const user = await prisma.user.update({ where: { id: req.user!.id }, data: body });
  res.json({ user: publicUser(user) });
});

profileRouter.put("/password", async (req, res) => {
  const body = z.object({ currentPassword: z.string().min(1, "Enter your current password"), newPassword: password }).parse(req.body);
  if (!(await bcrypt.compare(body.currentPassword, req.user!.passwordHash))) {
    throw badRequest("Your current password is incorrect");
  }
  await prisma.user.update({
    where: { id: req.user!.id },
    data: { passwordHash: await bcrypt.hash(body.newPassword, 12) },
  });
  res.json({ ok: true });
});
