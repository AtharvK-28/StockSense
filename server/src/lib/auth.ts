import type { Role, User } from "@prisma/client";
import type { RequestHandler, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../db";
import { env } from "../env";
import { forbidden, unauthorized } from "./http";

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

const COOKIE = "ss_session";
const SESSION_DAYS = 7;

export function setSession(res: Response, userId: string) {
  const token = jwt.sign({ sub: userId }, env.jwtSecret, { expiresIn: `${SESSION_DAYS}d` });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProd,
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearSession(res: Response) {
  res.clearCookie(COOKIE, { path: "/" });
}

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token = req.cookies?.[COOKIE];
  if (!token) throw unauthorized();
  let userId: string;
  try {
    userId = (jwt.verify(token, env.jwtSecret) as jwt.JwtPayload).sub as string;
  } catch {
    throw unauthorized("Your session has expired, please log in again");
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw unauthorized();
  req.user = user;
  next();
};

export const requireRole =
  (role: Role): RequestHandler =>
  (req, _res, next) => {
    if (req.user?.role !== role) throw forbidden("Only inventory managers can do that");
    next();
  };

/** Shorthand for manager-only routes. */
export const managerOnly = requireRole("manager");

export function publicUser(user: User) {
  return { id: user.id, loginId: user.loginId, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt };
}
