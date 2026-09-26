import { existsSync } from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { env } from "./env";
import { requireAuth } from "./lib/auth";
import { eventsHandler } from "./lib/events";
import { errorHandler, jsonReplacer, notFound, requestLogger } from "./lib/http";
import { authRouter } from "./routes/auth";
import { categoriesRouter } from "./routes/categories";
import { dashboardRouter } from "./routes/dashboard";
import { documentsRouter } from "./routes/documents";
import { ledgerRouter } from "./routes/ledger";
import { productsRouter } from "./routes/products";
import { profileRouter } from "./routes/profile";
import { searchRouter } from "./routes/search";
import { stockRouter } from "./routes/stock";
import { usersRouter } from "./routes/users";
import { locationsRouter, warehousesRouter } from "./routes/warehouses";

export function createApp() {
  const app = express();
  app.set("json replacer", jsonReplacer);
  app.disable("x-powered-by");
  app.use(cors({ origin: env.clientOrigin, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(requestLogger);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/api/auth", authRouter);

  const api = express.Router();
  api.use(requireAuth);
  api.get("/events", eventsHandler);
  api.use("/dashboard", dashboardRouter);
  api.use("/products", productsRouter);
  api.use("/categories", categoriesRouter);
  api.use("/documents", documentsRouter);
  api.use("/ledger", ledgerRouter);
  api.use("/warehouses", warehousesRouter);
  api.use("/locations", locationsRouter);
  api.use("/search", searchRouter);
  api.use("/stock", stockRouter);
  api.use("/profile", profileRouter);
  api.use("/users", usersRouter);
  app.use("/api", api);

  app.use("/api", () => {
    throw notFound("No such API endpoint");
  });

  // After `npm run build`, serve the web app from the same origin (single-process deploy).
  const clientDist = path.resolve(__dirname, "../../client/dist");
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
  }

  app.use(errorHandler);
  return app;
}
