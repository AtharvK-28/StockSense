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

- `server/src/services/documents.ts` — **Stock Ledger Engine** (`applyDocument`, `validateDocument` with done quantities + backorders), document lifecycle (`confirmDocument`, pick/pack, `refreshAvailability`, references like `WH/IN/0001`), `createReturn`, post-validation hooks (`afterValidation`: approval notices, low-stock crossings, `autoReorder`).
- `server/src/services/{audit,notify,settings}.ts` — audit log writer (`audit`, `diff`), in-app notifications (`notify` by role/users, skips the actor), company settings (`autoReorder`).
- `server/src/routes/analytics.ts` — analytics reconstructed by replaying the ledger backwards from current stock; `/valuation` report.
- `server/src/services/stock.ts` — on-hand, reserved (free-to-use), stock status, reorder suggestion.
- `server/src/routes/*` — REST API under `/api` (auth, dashboard, products, categories, documents, ledger, warehouses/locations, stock, search, profile, users).
- `server/prisma/schema.prisma` + `migrations/` (incl. hand-written trigger migration) + `seed.ts`.
- `client/src/pages/*` — Dashboard, products (list/detail/stock/categories/reordering), operations (DocumentList, DocumentPage), MoveHistory, settings (Warehouses, Locations, Team), Profile, auth.
- `client/src/components/ui.tsx` — design-system primitives (Button, Field, Chip, SelectPill, CategoryBar, Modal, StatusBadge…). Reuse these.
- `client/src/components/charts.tsx` — hand-rolled SVG charts (AreaChart, MirrorColumns, HBars, ChartTable) following the dataviz method; series colours are `--color-series-1/2` (validated blue/orange, with dark steps).
- `client/src/lib/code128.ts` + `components/Barcode.tsx` — Code 128B encoder (verified against JsBarcode) and SVG renderer; `components/Scanner.tsx` — scan dialog (keyboard-wedge scanners + camera via `BarcodeDetector`; camera repeats de-duplicated, hand scans are not).
- `client/src/lib/theme.ts` + inline script in `client/index.html` — light/dark/system theme (`data-theme`, `data-os-dark` on the html element); dark tokens in `index.css` (screen only, so print stays light). `--color-white` is the surface token; brand/toast text uses `text-on-brand`.

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
- Processing: Ready receipts/deliveries/transfers accept a done quantity per line; validating with less than demand asks whether to create a backorder (new doc, status Ready, `backorderOfId`). Validated receipts/deliveries/transfers can be returned (`returnOfId`; only un-returned quantities proposed).
- Auto-reorder: on a validation that makes total stock cross a product's `minQty`, managers get a notification and (if the setting is on and no receipt for it is open) a draft receipt up to `maxQty` is created, owned by the first manager.
- Login lockout: 5 failures per Login ID + IP → 15 min (in-memory, single process).

## Running

- Local PostgreSQL 18 (Windows service) at 127.0.0.1:5432; `pg_hba` trusts 127.0.0.1, user `postgres`, no password. psql: `"/c/Program Files/PostgreSQL/18/bin/psql.exe"`. DBs: `stocksense` (dev), `stocksense_test` (tests).
- `npm run dev` (root) → API :4000 + web :5173 (Vite proxies `/api`). `npm run build && npm start` → single process on :4000.
- `npm test` (vitest, real Postgres test DB `stocksense_test`), `npm run e2e` (Playwright, production build on :4100 + DB `stocksense_e2e`, reseeded each run; installed Edge locally), `npm run typecheck`.
- CI: `.github/workflows/ci.yml` (Postgres service, typecheck, vitest, Playwright Chromium). Docker: `docker compose up --build` → :4000 (`COOKIE_SECURE=false` for plain HTTP).
- Reset demo data: `npm run db:clear -w server && npm run db:seed -w server` (45 days of history via the real engine, backdated with `validateDocument(..., { at, quiet: true })`). `db:seed:empty` for a zero-products demo.
- Demo logins (password `Demo@1234`): `manager` (Rakesh, manager), `meena.staff` (Meena, staff). Seed includes one staff count awaiting approval.

## Gotchas

- `prisma migrate dev` refuses to run non-interactively when it would warn; write the migration SQL by hand in a new `prisma/migrations/<timestamp>_<name>/migration.sql`, then `npx prisma migrate deploy` and `npx prisma generate`.
- Stop the dev server before `prisma generate` on Windows (it locks the query-engine DLL). Stopping the background task can leave orphan node processes on ports 4000/5173 — kill them.
- Prisma Decimals are serialized as numbers by `jsonReplacer` in `server/src/lib/http.ts`.
- Express 5 handles async errors; throw `HttpError`/`badRequest`/`forbidden` etc. from `lib/http.ts`.
- Phone layouts render a card list (`sm:hidden`) *and* a table (`hidden sm:block`) — e2e selectors must target `:visible` inputs.
- Grid children holding wide tables need `min-w-0` or the whole column (and page) overflows on phones; `e2e/mobile.spec.ts` checks for sideways scroll.
- Charts: run the dataviz validator before changing chart colours; one axis only.
- Git: repo is on GitHub (`AtharvK-28/StockSense`); the user commits — don't commit unless asked.

## Status (2026-09-26)

Done: everything in the brief, all mockup pages, PRD FR-1…FR-37 (FR-24 decided as hard block), TRD with documented deviations, roles & approvals, location filters, print sheets, list/kanban views, CSV exports. Phase 2: backorders/partial processing, returns, barcode labels + scanning, analytics + valuation report, auto-reorder, notifications, audit log, phone floor mode, PWA, dark mode, login lockout, empty-start seed, e2e suite (13), CI workflow, Docker. 28 vitest + 13 Playwright tests passing.

Not verified: the Docker image build (Docker Desktop wasn't running) and the CI workflow's first run on GitHub.
Ideas not built: lots/serial numbers, unit-of-measure conversions, enforced stock reservations (free-to-use is informational), offline data sync.
