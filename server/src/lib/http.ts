import { Prisma } from "@prisma/client";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details);
export const unauthorized = (message = "Please log in to continue") => new HttpError(401, message);
export const forbidden = (message = "You don't have permission to do that") => new HttpError(403, message);
export const notFound = (message = "Not found") => new HttpError(404, message);
export const conflict = (message: string, details?: unknown) => new HttpError(409, message, details);

/** Serialises Prisma Decimals as plain numbers instead of strings. */
export function jsonReplacer(this: Record<string, unknown>, key: string, value: unknown) {
  return Prisma.Decimal.isDecimal(this[key]) ? Number(value) : value;
}

export const requestLogger: RequestHandler = (req, res, next) => {
  const start = performance.now();
  res.on("finish", () => {
    if (req.originalUrl === "/api/events" || process.env.NODE_ENV === "test") return;
    console.log(
      JSON.stringify({
        at: new Date().toISOString(),
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        ms: Math.round(performance.now() - start),
      }),
    );
  });
  next();
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    res.status(400).json({ error: issues[0]?.message ?? "Invalid input", issues });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      const target = (err.meta?.target as string[] | undefined)?.join(", ") ?? "value";
      res.status(409).json({ error: `That ${target} is already in use` });
      return;
    }
    if (err.code === "P2003") {
      res.status(400).json({ error: "A referenced record does not exist" });
      return;
    }
    if (err.code === "P2025") {
      res.status(404).json({ error: "Not found" });
      return;
    }
  }
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: "Malformed JSON body" });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong" });
};
