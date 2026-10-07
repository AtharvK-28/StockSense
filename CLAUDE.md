# StockSense — project context

Hackathon submission (Odoo-organized) for the "StockSense" problem statement: a modular inventory management system. Keep this file current whenever architecture, decisions or status change — it's how a new chat gets up to speed.

## Sources of truth

- `docs/StockSense.md` / `.pdf` — organizer brief (hard requirements).
- `docs/excalidrawMockup/*.png` — organizer mockups. Every page shown there must exist; extra pages are a bonus, missing ones hurt.
- `docs/ProductRequirementsDocument.md`, `docs/TechnicalRequirementsDocument.md`, `docs/Ideation.md` — the team's own docs. TRD §13 "Build Decisions" records every deviation and why.
- Organizers prefer: **local database, minimal third-party APIs, no Firebase/Supabase.** The only outside services are optional and map-related: OpenStreetMap embed tiles, Nominatim address search (only on a manager's click), and Google Maps *links* for directions. Everything else works offline.
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
- `server/src/routes/export.ts` — `/api/export/:dataset?format=csv|json` (same filters as the list pages; `team`/`audit` manager-only) and `/api/export/all` (ZIP of every CSV). Helpers `lib/csv.ts` (BOM, CRLF, formula-injection guard) and `lib/zip.ts` (hand-rolled deflate ZIP writer). Every export writes a `data.export` audit row.
- Product photos: `product_images` table (bytea, one per product) + `products.image_updated_at` as the cache-buster; `GET/PUT/DELETE /api/products/:id/image` (PUT = raw bytes, ≤2 MB, JPEG/PNG/WebP sniffed from magic bytes, manager-only). Rows expose `imageUrl`.
- `server/src/services/stock.ts` — on-hand, reserved (free-to-use), stock status, reorder suggestion.
- `server/src/routes/*` — REST API under `/api` (auth, dashboard, products, categories, documents, ledger, warehouses/locations, stock, search, profile, users).
- `server/prisma/schema.prisma` + `migrations/` (incl. hand-written trigger migration) + `seed.ts`.
- `client/src/pages/*` — Dashboard, products (list/detail/stock/categories/reordering), operations (DocumentList, DocumentPage), MoveHistory, settings (Warehouses, Locations, Team), Profile, auth.
- `client/src/components/ui.tsx` — design-system primitives (Button, Field, Chip, SelectPill, CategoryBar, Modal, StatusBadge…). Reuse these.
- `client/src/components/charts.tsx` — hand-rolled SVG charts (AreaChart, MirrorColumns, HBars, ChartTable) following the dataviz method; series colours are `--color-series-1/2` (validated blue/orange, with dark steps).
- `client/src/lib/code128.ts` + `components/Barcode.tsx` — Code 128B encoder (verified against JsBarcode) and SVG renderer; `components/Scanner.tsx` — scan dialog (keyboard-wedge scanners + camera). Camera uses the built-in `BarcodeDetector` where it exists, else the bundled ZXing decoder (`@zxing/browser`, lazy-loaded chunk) — so laptops/Windows/Firefox scan too. Camera repeats de-duplicated, hand scans are not.
- `client/src/components/ProductImage.tsx` — `ProductImage` (photo or category tile fallback) and `PhotoPicker` (upload/replace/remove, drag-drop, resizes to 800px WebP/JPEG in the browser). `components/ExportMenu.tsx` — CSV/JSON export button, pass the page's filters. `pages/settings/DataExport.tsx` — full export page.
- `client/src/lib/maps.ts` — keyless maps: OSM embed URL, Google Maps directions link, `parsePin` (coords or pasted Google/OSM links), Nominatim `geocode`, geolocation. Warehouses have optional `latitude`/`longitude`.
- `client/src/lib/theme.ts` + inline script in `client/index.html` — light/dark/system theme (`data-theme`, `data-os-dark` on the html element), one shared store (`useTheme`, `useResolvedTheme`) so the header sun/moon toggle and the menu switches agree; dark tokens in `index.css` (screen only, so print stays light). `--color-white` is the surface token; brand/toast text uses `text-on-brand`; `.map-frame` iframes are colour-inverted in dark mode.

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
- Optional 2FA (authenticator app, TOTP via `speakeasy`, `server/src/lib/totp.ts`): Profile → `POST /api/profile/2fa/setup` (QR) → `/2fa/confirm` (code) enables it; `DELETE /api/profile/2fa` needs current password + code. Login with 2FA on returns a 5-min `challenge` JWT instead of a session; `POST /api/auth/login/2fa` exchanges challenge + code. 5 wrong codes per account → 15 min lock (in-memory). Secrets stored AES-256-GCM encrypted in `users.totp_secret`, key from `TOTP_KEY` (falls back to `JWT_SECRET`) — changing that key disables everyone's 2FA.
- `GET /api/health` (no auth) pings the DB: `200 {ok, database:"connected"}` or `503`.
- Photos, warehouses map pins and categories are catalog/settings: managers change them, everyone sees them. Any user can export what they can see; team and audit exports are manager-only.

## Running

- Local PostgreSQL: two Windows services, both `scram-sha-256` (password required, no `trust`). PG 18 on :5432 — password unknown, tests' default `postgres:postgres` is rejected. PG 17 on :5433 — the password the user gave works (ask them; never write it into the repo); it also hosts other projects' DBs (`transitops`, `odoo_cafe`), don't touch those. Run tests there via `TEST_DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:5433/stocksense_test?schema=public` and `E2E_DATABASE_URL=…:5433/stocksense_e2e…`.
- e2e on a fresh server: Playwright starts the web server before `globalSetup`, and the web server's readiness URL `/api/health` returns 503 until the DB exists, so the first run times out after 180 s. Create `stocksense_e2e` by hand first (CI already does). psql: `"/c/Program Files/PostgreSQL/18/bin/psql.exe"`. DBs: `stocksense` (dev), `stocksense_test` (tests).
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
- Grid children holding wide tables need `min-w-0` or the whole column (and page) overflows on phones; `e2e/mobile.spec.ts` checks for sideways scroll, and that the header fits at 640–1024px (it's tight: hide labels below `md` rather than adding buttons).
- The sidebar nav hides its scrollbar (`scrollbar-none`) and uses `scroll-fade-*` mask utilities to hint at hidden items; global scrollbars are thin and themed.
- Camera e2e: `e2e/extras.spec.ts` feeds Chromium a generated Y4M video of a Code 128 label (`--use-file-for-fake-video-capture`); `test.use({ launchOptions })` must be top-level in a spec file.
- Charts: run the dataviz validator before changing chart colours; one axis only.
- Git: repo is on GitHub (`AtharvK-28/StockSense`); the user commits — don't commit unless asked.

## Status (2026-10-07)

Since 09-27: authenticator-app 2FA (+ vitest coverage in `server/tests/auth.test.ts`), `/api/health`, tablet header overflow fix, enforced stock reservations, separate `TOTP_KEY`. Typecheck, 40 vitest and 35 Playwright tests all pass (2026-10-07, against PG 17 on :5433). Known 2FA limits: `speakeasy` is unmaintained (`otplib` is the swap), a code can be replayed within its ~90 s window, no recovery codes.

### Earlier status (2026-09-27)

Done: everything in the brief, all mockup pages, PRD FR-1…FR-37 (FR-24 decided as hard block), TRD with documented deviations, roles & approvals, location filters, print sheets, list/kanban views, CSV exports. Phase 2: backorders/partial processing, returns, barcode labels + scanning, analytics + valuation report, auto-reorder, notifications, audit log, phone floor mode, PWA, dark mode, login lockout, empty-start seed, e2e suite, CI workflow, Docker, enforced stock reservations. Phase 3: camera scanning on any device (ZXing fallback), product photos, category drill-down, warehouse maps + directions, CSV/JSON export on every list + full ZIP export, header theme toggle, hidden sidebar scrollbar. 40 vitest + 35 Playwright tests passing. `e2e/requirements.spec.ts` maps every section of the brief and the mockups to a UI test (incl. the brief's receive 100 → move → deliver 20 → adjust −3 flow) — extend it when requirements change.

Not verified: the Docker image build (Docker Desktop wasn't running) and the CI workflow's first run on GitHub.
Ideas not built: lots/serial numbers, unit-of-measure conversions, offline data sync.
