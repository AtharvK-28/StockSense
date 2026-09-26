import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { publicUser } from "../lib/auth";
import { badRequest } from "../lib/http";
import { createTotpSecret, decryptTotpSecret, encryptTotpSecret, qrDataUrl, totpUri, verifyTotp } from "../lib/totp";
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

profileRouter.post("/2fa/setup", async (req, res) => {
  const body = z.object({ currentPassword: z.string().min(1, "Enter your current password") }).parse(req.body);
  const user = req.user!;
  if (user.totpEnabled) throw badRequest("Two-step verification is already enabled");
  if (!(await bcrypt.compare(body.currentPassword, user.passwordHash))) throw badRequest("Your current password is incorrect");
  const secret = createTotpSecret();
  await prisma.user.update({ where: { id: user.id }, data: { totpSecret: encryptTotpSecret(secret), totpEnabled: false } });
  const uri = totpUri(secret, user.email);
  res.json({ qrCode: await qrDataUrl(uri), secret, uri });
});

profileRouter.post("/2fa/confirm", async (req, res) => {
  const body = z.object({ code: z.string().regex(/^\d{6}$/, "Enter the 6-digit authenticator code") }).parse(req.body);
  const user = req.user!;
  if (!user.totpSecret || user.totpEnabled) throw badRequest("Two-step verification setup is not pending");
  if (!verifyTotp(decryptTotpSecret(user.totpSecret), body.code)) throw badRequest("Invalid authenticator code");
  const updated = await prisma.user.update({ where: { id: user.id }, data: { totpEnabled: true } });
  res.json({ user: publicUser(updated) });
});

profileRouter.delete("/2fa", async (req, res) => {
  const body = z.object({ currentPassword: z.string().min(1, "Enter your current password"), code: z.string().regex(/^\d{6}$/, "Enter the 6-digit authenticator code") }).parse(req.body);
  const user = req.user!;
  if (!user.totpEnabled || !user.totpSecret) throw badRequest("Two-step verification is not enabled");
  if (!(await bcrypt.compare(body.currentPassword, user.passwordHash))) throw badRequest("Your current password is incorrect");
  if (!verifyTotp(decryptTotpSecret(user.totpSecret), body.code)) throw badRequest("Invalid authenticator code");
  const updated = await prisma.user.update({ where: { id: user.id }, data: { totpSecret: null, totpEnabled: false } });
  res.json({ user: publicUser(updated) });
});
