# StockSense — project context

Hackathon submission (Odoo-organized) for the "StockSense" problem statement: a modular inventory management system. Keep this file current whenever architecture, decisions or status change — it's how a new chat gets up to speed.

## Sources of truth

- `docs/StockSense.md` / `.pdf` — organizer brief (hard requirements).
- `docs/excalidrawMockup/*.png` — organizer mockups. Every page shown there must exist; extra pages are a bonus, missing ones hurt.
- `docs/ProductRequirementsDocument.md`, `docs/TechnicalRequirementsDocument.md`, `docs/Ideation.md` — the team's own docs. TRD §13 "Build Decisions" records every deviation and why.
- Organizers prefer: **local database, minimal third-party APIs, no Firebase/Supabase.**
- UI direction: **Airbnb-inspired** (white canvas, coral `#FF385C` gradient CTAs, pill filters/search, rounded cards, soft shadows, DM Sans).

## Stack & layout

npm workspaces monorepo:

- `server/` — Node + Express 5 + TypeScript (CommonJS via `tsx`), Prisma 6, PostgreSQL, Zod 3, bcryptjs, jsonwebtoken, nodemailer.
- `client/` — React 19 + Vite 7 + TypeScript, Tailwind CSS 4 (tokens in `client/src/index.css` `@theme`), React Router 7, TanStack Query 5, lucide-react.
- Versions are intentionally pinned to these majors (newer Prisma 8 / TS 7 / Vite 8 exist but weren't adopted).

Key files:

- `server/src/services/documents.ts` — **Stock Ledger Engine** (`applyDocument`, `validateDocument`), document lifecycle (`confirmDocument`, pick/pack, `refreshAvailability`, references like `WH/IN/0001`).
- `server/src/services/stock.ts` — on-hand, reserved (free-to-use), stock status, reorder suggestion.
- `server/src/routes/*` — REST API under `/api` (auth, dashboard, products, categories, documents, ledger, warehouses/locations, stock, search, profile, users).
- `server/prisma/schema.prisma` + `migrations/` (incl. hand-written trigger migration) + `seed.ts`.
- `client/src/pages/*` — Dashboard, products (list/detail/stock/categories/reordering), operations (DocumentList, DocumentPage), MoveHistory, settings (Warehouses, Locations, Team), Profile, auth.
- `client/src/components/ui.tsx` — design-system primitives (Button, Field, Chip, SelectPill, CategoryBar, Modal, StatusBadge…). Reuse these.

## Core invariants (don't break)

1. Nothing changes stock except validating a document. All stock changes go through `recordMove` in `documents.ts`, which writes a `stock_ledger_entries` row and updates `stock_levels` in the same transaction.
2. Validation claims the document with a conditional update first (double-validate safe), locks stock rows, and rolls back entirely on any failure.
3. DB trigger makes `stock_ledger_entries` append-only; CHECK keeps `stock_levels.quantity >= 0`. Negative stock is hard-blocked.
4. Opening stock and Stock-page updates are recorded as adjustments (so they appear in the ledger).
5. Reordering rules (min/max on product) are company-wide — low/out status uses total stock even when a view is filtered by warehouse/location.
6. Roles are enforced on the server (`managerOnly` / checks in routes), UI only mirrors them via `useIsManager()`.

## Domain rules

- Document types: receipt, delivery, transfer, adjustment. Statuses: draft → waiting/ready → done, or canceled.
- "Mark as To Do" (`confirm`): receipts → Ready; deliveries/transfers → Ready if source has stock, else Waiting. Waiting/Ready re-evaluated after every validation.
- Deliveries: Ready → pick → pack → validate. Transfers must be confirmed before validating.
- Adjustments: counted qty → delta computed at validation vs recorded stock.
- **Roles:** staff = run operations (create/confirm/pick/pack/validate receipts, deliveries, transfers) and *submit* counts (adjustments go to Ready = "Awaiting approval"). Manager = approve/apply adjustments, cancel documents, products/categories/costs/reordering rules/reorder, warehouses/locations, Team page. First signup becomes manager; later signups are staff; last manager can't be demoted.
- Auth: Login ID (6–12 chars, `[a-z0-9._]`, stored lowercase) or email + password (>8 chars, upper, lower, special). Error text exactly "Invalid Login Id or Password". OTP reset: 6-digit, bcrypt-hashed, single-use, 10 min, 5/hour, 5 attempts. `OTP_DEV_ECHO=true` returns the code to the UI for demos.
- Live updates: Server-Sent Events at `/api/events`; client invalidates React Query caches on `change`.

## Running

- Local PostgreSQL 18 (Windows service) at 127.0.0.1:5432; `pg_hba` trusts 127.0.0.1, user `postgres`, no password. psql: `"/c/Program Files/PostgreSQL/18/bin/psql.exe"`. DBs: `stocksense` (dev), `stocksense_test` (tests).
- `npm run dev` (root) → API :4000 + web :5173 (Vite proxies `/api`). `npm run build && npm start` → single process on :4000.
- `npm test` (vitest, real Postgres test DB), `npm run typecheck`.
- Reset demo data: `psql … -d stocksense -c "TRUNCATE stock_ledger_entries, document_lines, documents, stock_levels, products, product_categories, locations, warehouses, otp_codes, users, sequences CASCADE"` then `cd server && npx tsx prisma/seed.ts`.
- Demo logins (password `Demo@1234`): `manager` (Rakesh, manager), `meena.staff` (Meena, staff). Seed includes one staff count awaiting approval.

## Gotchas

- `prisma migrate dev` refuses to run non-interactively when it would warn; write the migration SQL by hand in a new `prisma/migrations/<timestamp>_<name>/migration.sql`, then `npx prisma migrate deploy` and `npx prisma generate`.
- Stop the dev server before `prisma generate` on Windows (it locks the query-engine DLL). Stopping the background task can leave orphan node processes on ports 4000/5173 — kill them.
- Prisma Decimals are serialized as numbers by `jsonReplacer` in `server/src/lib/http.ts`.
- Express 5 handles async errors; throw `HttpError`/`badRequest`/`forbidden` etc. from `lib/http.ts`.
- UI verification has been done with `playwright-core` driving installed Microsoft Edge (`chromium.launch({ channel: "msedge" })`) from a scratch folder — not part of the repo.
- The project is **not a git repository yet** — initialize before submitting.

## Status (2026-09-26)

Done: everything in the brief, all mockup pages, PRD FR-1…FR-37 (FR-24 decided as hard block), TRD with documented deviations, roles & approvals, location filters (dashboard + move history), print sheets, list/kanban views, CSV export of moves, 19 passing tests.

Not done (see suggestions discussed with the user): barcode/QR scanning, automatic reorder drafts, backorders/partial receipts, stock valuation export, analytics (fast movers, dead stock), notification center, dark mode/PWA, CI, deployment, git history.
