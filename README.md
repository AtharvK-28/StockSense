# StockSense

A modular, real-time inventory management system. Every receipt, delivery, internal transfer and stock adjustment is written to one append-only **stock ledger**, so you always know what you have, where it is, and why it changed.

- **Stack:** React 19 + Vite + TypeScript + Tailwind CSS · Node.js + Express 5 + Prisma · **local PostgreSQL**
- **No hosted services:** no Firebase/Supabase, no third-party APIs. OTP emails go over plain SMTP (optional), live updates use Server-Sent Events, barcodes and photos are generated, read and stored locally. The only outside calls are optional warehouse maps (OpenStreetMap) and directions links.

[![CI](https://github.com/AtharvK-28/StockSense/actions/workflows/ci.yml/badge.svg)](https://github.com/AtharvK-28/StockSense/actions/workflows/ci.yml)

## Quick start

**With Docker** (nothing else to install): `docker compose up --build`, then open http://localhost:4000.

**Without Docker** — prerequisites: Node.js 20+, PostgreSQL 14+ running locally.

```bash
npm install
cp server/.env.example server/.env      # set DATABASE_URL and JWT_SECRET
createdb stocksense                     # or create it in pgAdmin
npm run setup                           # apply migrations + load 45 days of demo history
npm run dev                             # API on :4000, web on http://localhost:5173
```

Demo logins (password `Demo@1234`; the account email also works in the Login ID field):

| Role | Login ID | Email |
| --- | --- | --- |
| Inventory manager | `manager` | `manager@stocksense.app` |
| Warehouse staff | `meena.staff` | `staff@stocksense.app` |

Single-process mode: `npm run build && npm start` serves the app and API together on http://localhost:4000 (installable as an app from the browser).

### Useful scripts

| Command | What it does |
| --- | --- |
| `npm test` | Ledger engine, auth, roles, backorders, returns, auto-reorder, photos, map pins and export tests against a real `stocksense_test` database (create it first) |
| `npm run e2e` | Browser tests (desktop + phone, including a real camera scan from a simulated webcam) against a production build and a separate `stocksense_e2e` database. Uses installed Edge locally; `PW_CHANNEL= npm run e2e` uses Playwright's Chromium |
| `npm run typecheck` | Type-check server and client |
| `npm run db:clear -w server && npm run db:seed -w server` | Reset to the demo data |
| `npm run db:clear -w server && npm run db:seed:empty -w server` | Start from zero products (users, warehouses and categories only) |
| `npm run db:studio -w server` | Browse the database in Prisma Studio |

## Features

- **Auth:** sign up with a unique Login ID (6–12 chars), email and a strong password (upper + lower case, special character, more than 8 characters); log in with the Login ID (httpOnly JWT cookie); 5 failed logins lock the account for 15 minutes; OTP password reset (6-digit, hashed, single-use, 10-minute expiry, rate-limited). Set `OTP_DEV_ECHO=true` to show the code on screen for demos; configure `SMTP_*` to email it.
- **Dashboard:** live KPIs (Receipt/Delivery cards with to-process, late and waiting counts; products in stock; low/out of stock; scheduled transfers), filterable by document type, status, warehouse, location and category; low-stock alerts with one-click reorder; counts awaiting approval; recent ledger activity.
- **Analytics:** stock value over time, received vs shipped per day, value by category, top movers with days of cover, dead stock, turnover — all replayed from the ledger. **Valuation report** by product, location or category with CSV export and print/PDF.
- **Products:** create/update with SKU, category, unit of measure, per-unit cost, a photo (upload, drag-drop or phone camera; resized in the browser, stored in PostgreSQL) and optional opening stock; stock per location; incoming/outgoing forecast; categories that open to show their products; reordering rules (min/max).
- **Warehouses on the map:** pin a site by address search, "I'm here now" or a pasted Google Maps / OpenStreetMap link; every warehouse card shows the map with one-tap directions.
- **Operations:** receipts, delivery orders (pick → pack → validate), internal transfers and stock adjustments following Draft → Waiting → Ready → Done / Canceled. Enter the quantity actually received/shipped; anything short can become a **backorder**. Validated documents can be **returned** (goods go back the way they came).
- **Automatic reorders:** when a validation drops a product to its reorder point, managers are notified and a draft receipt back up to the max is created (toggle in Settings → General).
- **Barcodes:** print Code 128 labels for SKUs; scan with a USB/Bluetooth scanner or any camera — phone or laptop webcam (the browser's detector where available, otherwise a bundled decoder) — to add lines, count received/shipped units, or jump straight to a product or document. Printed documents carry their reference as a barcode.
- **Stock:** per-unit cost, on hand, reserved and free-to-use quantities with valuation; update a count in place (logged as an adjustment).
- **Notifications:** bell menu for counts awaiting approval, approvals, low stock, auto-reorders, deliveries that became ready and cancellations.
- **Roles:** warehouse staff run operations and submit stock counts; inventory managers approve counts, cancel operations, own the catalog, costs and reordering rules, configure warehouses and manage the team. Enforced on the server. The first account is the manager; later sign-ups join as staff until promoted on Settings → Team.
- **Audit log:** who changed products, costs, rules, categories, warehouses, locations, roles, settings and document lifecycle (field-level diffs). Stock movements live in Move history.
- **Move history:** the full ledger with search, filters (type, warehouse, location, product, category, dates), list/Kanban and CSV export.
- **Works on the warehouse floor:** phone layouts use cards with big touch targets; installable as an app (PWA); light, dark or system theme.
- **Global search:** press <kbd>/</kbd> anywhere to find a SKU, product or document reference.
- **Your data, any time:** every list (products, stock, operations, move history, categories, warehouses, team, audit log) has an Export button (CSV for Excel/Sheets or JSON) that respects the current filters; Settings → Data export downloads everything as one ZIP, optionally for a date range. Downloads are recorded in the audit log.

## How stock changes

Nothing changes stock except validating a document. Validation runs in a single database transaction:

1. The document is claimed atomically (`status → done`), so two people validating at once can't both apply it.
2. Each line locks its `stock_levels` row, checks availability, updates the quantity, and appends a `stock_ledger_entries` row with the signed delta and the balance after. Lines use the quantity actually processed; the remainder can be carried into a backorder in the same transaction.
3. Any failure (e.g. not enough stock on one line) rolls back everything.

The database enforces the rules too: a trigger rejects `UPDATE`/`DELETE` on ledger entries, and a check constraint keeps stock non-negative. Waiting deliveries/transfers re-check availability after every validation and become Ready automatically when stock arrives.

## Project layout

```
server/                Express API
  prisma/              schema, migrations, demo seed (45 days of history), clear script
  src/services/        documents.ts (stock ledger engine, backorders, returns, auto-reorder),
                       stock.ts, audit.ts, notify.ts, settings.ts
  src/routes/          REST endpoints
  tests/               vitest suites (ledger, auth, roles, phase-2 features)
client/                React app
  src/pages/           dashboard, analytics, products, operations, move history, settings, auth
  src/components/      layout, UI kit, charts, barcode, scanner, notifications, tables, pickers
e2e/                   Playwright browser tests (desktop + phone)
.github/workflows/     CI: typecheck, unit/integration and e2e tests on every push
docs/                  problem statement, mockups, ideation, PRD, TRD
Dockerfile, docker-compose.yml   one-command local run
```
