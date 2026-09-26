import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { env } from "../env";
import { clearSession, publicUser, requireAuth, setSession } from "../lib/auth";
import { HttpError, badRequest, unauthorized } from "../lib/http";
import { sendOtpEmail } from "../lib/mailer";

export const authRouter = Router();

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_PER_HOUR = 5;
const OTP_MAX_ATTEMPTS = 5;

const email = z.string().trim().toLowerCase().email("Enter a valid email address");
export const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128)
  .regex(/[A-Za-z]/, "Password must contain a letter")
  .regex(/\d/, "Password must contain a number");

const signupSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(80),
  email,
  password,
  role: z.enum(["manager", "staff"]).default("manager"),
});

authRouter.post("/signup", async (req, res) => {
  const body = signupSchema.parse(req.body);
  const existing = await prisma.user.findUnique({ where: { email: body.email } });
  if (existing) throw new HttpError(409, "An account with this email already exists");
  const user = await prisma.user.create({
    data: { name: body.name, email: body.email, role: body.role, passwordHash: await bcrypt.hash(body.password, 12) },
  });
  setSession(res, user.id);
  res.status(201).json({ user: publicUser(user) });
});

authRouter.post("/login", async (req, res) => {
  const body = z.object({ email, password: z.string().min(1, "Enter your password") }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
    throw unauthorized("Incorrect email or password");
  }
  setSession(res, user.id);
  res.json({ user: publicUser(user) });
});

authRouter.post("/logout", (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user!) });
});

authRouter.post("/forgot-password", async (req, res) => {
  const body = z.object({ email }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  let devOtp: string | undefined;

  if (user) {
    const recent = await prisma.otpCode.count({
      where: { userId: user.id, createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
    });
    if (recent >= OTP_MAX_PER_HOUR) throw new HttpError(429, "Too many reset requests. Try again in an hour.");

    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    await prisma.$transaction([
      prisma.otpCode.updateMany({ where: { userId: user.id, used: false }, data: { used: true } }),
      prisma.otpCode.create({
        data: { userId: user.id, codeHash: await bcrypt.hash(code, 10), expiresAt: new Date(Date.now() + OTP_TTL_MS) },
      }),
    ]);
    await sendOtpEmail(user.email, user.name, code);
    if (env.otpDevEcho) devOtp = code;
  }

  // Same response whether or not the account exists, so emails can't be enumerated.
  res.json({ ok: true, message: "If an account exists for that email, we've sent a 6-digit code.", devOtp });
});

authRouter.post("/reset-password", async (req, res) => {
  const body = z
    .object({ email, code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"), password })
    .parse(req.body);
  const invalid = badRequest("That code is invalid or has expired");

  const user = await prisma.user.findUnique({ where: { email: body.email } });
  if (!user) throw invalid;
  const otp = await prisma.otpCode.findFirst({
    where: { userId: user.id, used: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!otp) throw invalid;
  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    await prisma.otpCode.update({ where: { id: otp.id }, data: { used: true } });
    throw badRequest("Too many wrong attempts. Request a new code.");
  }
  if (!(await bcrypt.compare(body.code, otp.codeHash))) {
    await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    throw invalid;
  }

  await prisma.$transaction([
    prisma.otpCode.update({ where: { id: otp.id }, data: { used: true } }),
    prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(body.password, 12) } }),
  ]);
  res.json({ ok: true });
});
