# StockSense

A modular, real-time inventory management system. Every receipt, delivery, internal transfer and stock adjustment is written to one append-only **stock ledger**, so you always know what you have, where it is, and why it changed.

- **Stack:** React 19 + Vite + TypeScript + Tailwind CSS · Node.js + Express 5 + Prisma · **local PostgreSQL**
- **No hosted services:** no Firebase/Supabase, no third-party APIs. OTP emails go over plain SMTP (optional); live updates use Server-Sent Events.

## Quick start

Prerequisites: Node.js 20+, PostgreSQL 14+ running locally.

```bash
npm install
cp server/.env.example server/.env      # set DATABASE_URL and JWT_SECRET
createdb stocksense                     # or create it in pgAdmin
npm run setup                           # apply migrations + load demo data
npm run dev                             # API on :4000, web on http://localhost:5173
```

Demo logins (password `Demo@1234`; the account email also works in the Login ID field):

| Role | Login ID | Email |
| --- | --- | --- |
| Inventory manager | `manager` | `manager@stocksense.app` |
| Warehouse staff | `meena.staff` | `staff@stocksense.app` |

Single-process mode: `npm run build && npm start` serves the app and API together on http://localhost:4000.

### Useful scripts

| Command | What it does |
| --- | --- |
| `npm test` | Ledger engine + auth tests against a real `stocksense_test` database (create it first) |
| `npm run typecheck` | Type-check server and client |
| `npm run db:reset -w server` | Drop and re-create the schema (then `npm run db:seed -w server`) |
| `npm run db:studio -w server` | Browse the database in Prisma Studio |

## Features

- **Auth:** sign up with a unique Login ID (6–12 chars), email and a strong password (upper + lower case, special character, more than 8 characters); log in with the Login ID (httpOnly JWT cookie), OTP password reset (6-digit, hashed, single-use, 10-minute expiry, rate-limited). Set `OTP_DEV_ECHO=true` to show the code on screen for demos; configure `SMTP_*` to email it.
- **Dashboard:** live KPIs (products in stock, low/out of stock, pending receipts, pending deliveries, scheduled transfers), filterable by document type, status, warehouse and category; low-stock alerts with one-click reorder; recent ledger activity.
- **Products:** create/update with SKU, category, unit of measure and optional opening stock; stock per location; incoming/outgoing forecast; categories; reordering rules (min/max) that raise alerts and draft replenishment receipts.
- **Operations:** receipts, delivery orders (pick → pack → validate), internal transfers, stock adjustments, all following Draft → Waiting → Ready → Done / Canceled.
- **Stock:** per-unit cost, on hand, reserved and free-to-use quantities with stock valuation; update a count in place (logged as an adjustment).
- **List / Kanban:** receipts, deliveries, transfers, adjustments and move history switch between a list and a status (or move-type) Kanban board.
- **Printable documents:** receipts and delivery orders print as a clean sheet with signature lines.
- **Move history:** the full ledger with search, filters, date range and CSV export.
- **Settings:** multiple warehouses (name, short code, address) and their locations (name, short code), each managed on its own page.
- **Roles:** warehouse staff run operations (receive, pick, pack, transfer, validate) and submit stock counts; inventory managers approve counts, cancel operations, own the catalog, costs and reordering rules, configure warehouses and manage the team. Enforced on the server. The first account is the manager; later sign-ups join as staff until promoted on Settings → Team.
- **Global search:** press <kbd>/</kbd> anywhere to find a SKU, product or document reference.

## How stock changes

Nothing changes stock except validating a document. Validation runs in a single database transaction:

1. The document is claimed atomically (`status → done`), so two people validating at once can't both apply it.
2. Each line locks its `stock_levels` row, checks availability, updates the quantity, and appends a `stock_ledger_entries` row with the signed delta and the balance after.
3. Any failure (e.g. not enough stock on one line) rolls back everything.

The database enforces the rules too: a trigger rejects `UPDATE`/`DELETE` on ledger entries, and a check constraint keeps stock non-negative. Waiting deliveries/transfers re-check availability after every validation and become Ready automatically when stock arrives.

## Project layout

```
server/            Express API
  prisma/          schema, migrations, demo seed
  src/services/    documents.ts (stock ledger engine), stock.ts
  src/routes/      REST endpoints
  tests/           vitest suites (ledger engine, auth/OTP)
client/            React app
  src/pages/       dashboard, products, operations, move history, settings, auth
  src/components/  layout, UI kit, tables, pickers
docs/              problem statement, ideation, PRD, TRD
```
