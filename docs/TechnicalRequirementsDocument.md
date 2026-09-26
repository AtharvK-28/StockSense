StockSense — Technical Requirements Document (TRD)
Version: 1.0 Status: Draft (Hackathon Build)

1. Purpose
This document defines the technical architecture, data model, APIs, and infrastructure required to implement StockSense as described in the PRD, optimized for a hackathon build-and-demo timeline while remaining extensible.

2. Architecture Overview
StockSense follows a classic 3-tier architecture:

┌─────────────────────┐
│   Frontend (SPA)     │  React + Tailwind
│  Dashboard / Forms    │
└──────────┬───────────┘
           │ REST/JSON (HTTPS)
┌──────────▼───────────┐
│   Backend API Layer   │  Node.js (Express/NestJS) or FastAPI
│  Auth, Business Logic │
│  Stock Ledger Engine  │
└──────────┬───────────┘
           │ SQL
┌──────────▼───────────┐
│     Database          │  PostgreSQL
│  Products, Ledger,    │
│  Warehouses, Docs     │
└───────────────────────┘
Key architectural principle: All stock quantity changes flow through a single Stock Ledger Engine — no module writes directly to a "current stock" field. Current stock is always derived (or maintained as a cached aggregate, updated transactionally) from ledger entries.

3. Tech Stack
Layer	Choice	Rationale
Frontend	React (Vite) + TypeScript	Fast dev loop, strong typing reduces bugs under time pressure
Styling	Tailwind CSS + shadcn/ui	Rapid, consistent, professional-looking UI without custom CSS overhead
State Management	React Query (server state) + Zustand/Context (UI state)	Simplifies data fetching/caching for dashboard KPIs
Backend	Node.js + Express (or NestJS for structure)	JS end-to-end, fast iteration, large ecosystem
Database	PostgreSQL	Relational integrity crucial for ledger-style accounting of stock
ORM	Prisma	Type-safe queries, fast schema iteration, good DX for hackathon speed
Auth	JWT (access + refresh tokens)	Stateless, standard, easy to secure routes
OTP Delivery	Resend/SendGrid (email) or mocked static OTP for demo	Avoids dependency on paid SMS gateway during hackathon
Real-time updates	Socket.IO (or polling fallback every 5–10s)	Live dashboard KPI updates without full page refresh
Hosting (Frontend)	Vercel	Zero-config React deploys
Hosting (Backend + DB)	Railway / Render	Fast Postgres provisioning + API hosting
Version Control	GitHub	Standard for hackathon judging/repo review
4. Data Model
4.1 Entity-Relationship Overview
User ──< AuditLog
User ──< Session

Warehouse ──< Location (racks/zones within a warehouse)

Product ──< StockLevel (per Location)
Product }──< ProductCategory

Document (Receipt/Delivery/Transfer/Adjustment)
   ├──< DocumentLine (product, quantity, source/destination location)
   └──< StockLedgerEntry (created on validation)

StockLedgerEntry >── Product
StockLedgerEntry >── Location
StockLedgerEntry >── Document
StockLedgerEntry >── User (who validated)
4.2 Core Tables (Simplified Schema)
users

Column	Type	Notes
id	UUID (PK)	
name	varchar	
email	varchar (unique)	
password_hash	varchar	bcrypt/argon2
role	enum('manager','staff')	
created_at	timestamp	
otp_codes

Column	Type	Notes
id	UUID (PK)	
user_id	UUID (FK → users)	
code_hash	varchar	never store plaintext OTP
expires_at	timestamp	
used	boolean	default false
warehouses

Column	Type	Notes
id	UUID (PK)	
name	varchar	
address	varchar	nullable
locations

Column	Type	Notes
id	UUID (PK)	
warehouse_id	UUID (FK)	
name	varchar	e.g. "Rack A", "Production Floor"
product_categories

Column	Type	Notes
id	UUID (PK)	
name	varchar	
products

Column	Type	Notes
id	UUID (PK)	
name	varchar	
sku	varchar (unique)	
category_id	UUID (FK)	
unit_of_measure	varchar	kg, pcs, m, etc.
reorder_threshold	numeric	nullable, for low-stock alerts
created_at	timestamp	
stock_levels (cached aggregate, derived from ledger, updated in same transaction)

Column	Type	Notes
id	UUID (PK)	
product_id	UUID (FK)	
location_id	UUID (FK)	
quantity	numeric	current on-hand quantity
updated_at	timestamp	
Unique constraint on (product_id, location_id)		
documents (Receipts / Deliveries / Transfers / Adjustments)

Column	Type	Notes
id	UUID (PK)	
type	enum('receipt','delivery','transfer','adjustment')	
status	enum('draft','waiting','ready','done','canceled')	
reference_no	varchar	auto-generated, e.g. RCPT-0001
partner_name	varchar	supplier/customer name, nullable for transfers/adjustments
source_location_id	UUID (FK, nullable)	used for transfers/deliveries
destination_location_id	UUID (FK, nullable)	used for transfers/receipts
created_by	UUID (FK → users)	
validated_by	UUID (FK → users, nullable)	
validated_at	timestamp (nullable)	
created_at	timestamp	
document_lines

Column	Type	Notes
id	UUID (PK)	
document_id	UUID (FK)	
product_id	UUID (FK)	
quantity	numeric	
counted_quantity	numeric (nullable)	used for adjustments
notes	text (nullable)	reason for adjustment
stock_ledger_entries (append-only, immutable)

Column	Type	Notes
id	UUID (PK)	
document_id	UUID (FK)	
product_id	UUID (FK)	
location_id	UUID (FK)	
quantity_delta	numeric	signed (+/-)
balance_after	numeric	snapshot for audit
operation_type	enum('receipt','delivery','transfer_in','transfer_out','adjustment')	
performed_by	UUID (FK → users)	
created_at	timestamp	
5. API Design (REST)
5.1 Authentication
Method	Endpoint	Description
POST	/api/auth/signup	Create user account
POST	/api/auth/login	Authenticate, return JWT access + refresh token
POST	/api/auth/forgot-password	Trigger OTP send
POST	/api/auth/reset-password	Validate OTP + set new password
POST	/api/auth/refresh	Refresh access token
5.2 Dashboard
Method	Endpoint	Description
GET	/api/dashboard/kpis	Returns KPI counts (supports query params: warehouse_id, category_id)
GET	/api/dashboard/documents?type=&status=&warehouse_id=&category_id=	Filtered document list
5.3 Products
Method	Endpoint	Description
GET	/api/products	List/search products (supports ?q= for SKU search)
POST	/api/products	Create product
GET	/api/products/:id	Product detail incl. stock per location
PUT	/api/products/:id	Update product
GET	/api/products/:id/stock	Stock breakdown by location
5.4 Documents (Receipts / Deliveries / Transfers / Adjustments)
Method	Endpoint	Description
POST	/api/documents	Create a document (type in body)
GET	/api/documents/:id	Get document + lines
PUT	/api/documents/:id	Update draft document
POST	/api/documents/:id/validate	Validate → triggers Stock Ledger Engine
POST	/api/documents/:id/cancel	Cancel document
5.5 Stock Ledger
Method	Endpoint	Description
GET	/api/ledger?product_id=&location_id=&from=&to=&type=	Filtered ledger history
5.6 Warehouses & Locations
Method	Endpoint	Description
GET/POST	/api/warehouses	List/create warehouses
GET/POST	/api/warehouses/:id/locations	List/create locations within a warehouse
5.7 Profile
Method	Endpoint	Description
GET	/api/profile	Get current user profile
PUT	/api/profile	Update profile
POST	/api/auth/logout	Invalidate session/refresh token
6. Stock Ledger Engine — Core Logic
This is the most important technical component. On document validation:

function validateDocument(documentId):
    doc = fetchDocument(documentId)
    assert doc.status in ['ready', 'draft']  # per business rule

    BEGIN TRANSACTION
        for line in doc.lines:
            switch doc.type:
                case 'receipt':
                    delta = +line.quantity
                    location = doc.destination_location_id
                case 'delivery':
                    delta = -line.quantity
                    location = doc.source_location_id
                    if currentStock(line.product_id, location) < line.quantity:
                        raise InsufficientStockError
                case 'transfer':
                    # two ledger entries: one out, one in
                    createLedgerEntry(product, doc.source_location_id, -line.quantity, 'transfer_out')
                    createLedgerEntry(product, doc.destination_location_id, +line.quantity, 'transfer_in')
                    continue
                case 'adjustment':
                    delta = line.counted_quantity - currentStock(line.product_id, location)

            createLedgerEntry(product, location, delta, doc.type)
            updateStockLevel(product, location, delta)  # atomic increment

        doc.status = 'done'
        doc.validated_at = now()
        doc.validated_by = current_user
    COMMIT TRANSACTION
Design notes:

Entire validation must be a single DB transaction — either all ledger entries + stock updates succeed, or none do.
stock_levels table is a materialized cache for read performance; stock_ledger_entries is the source of truth. If they ever diverge, stock_levels can be rebuilt by replaying the ledger.
Insufficient-stock checks are configurable (hard block vs. allow-with-warning) per PRD FR-24.
7. Real-Time Dashboard Updates
Two viable approaches, in order of implementation cost:

Polling (fastest to build): Frontend re-fetches /api/dashboard/kpis every 5–10 seconds, or immediately after any local action (optimistic + refetch).
WebSocket push (better UX, more setup): Backend emits a stock:updated event via Socket.IO after each successful validation; frontend subscribes and invalidates React Query cache for dashboard KPIs.
Recommendation for hackathon: Start with immediate refetch-after-action (covers the demo perfectly), add Socket.IO only if time permits — it's a nice-to-have polish item, not core to functionality.

8. Security
Passwords hashed with bcrypt (cost factor 10–12) or argon2.
JWT access tokens short-lived (15 min), refresh tokens longer-lived (7 days), stored as httpOnly cookies where possible.
OTP codes: 6-digit, hashed before storage, single-use, 10-minute expiry, rate-limited (max 5 requests per hour per user).
All API routes (except auth) require valid JWT; role-based checks (manager vs staff) enforced via middleware for sensitive actions (e.g., only managers can create reordering rules or manage warehouses).
Input validation on all endpoints (e.g., Zod/Joi schemas) to prevent malformed data reaching the Stock Ledger Engine.
CORS restricted to known frontend origin(s).
9. Non-Functional / Infrastructure Requirements
Aspect	Requirement
Environments	Local dev, and one deployed demo environment (staging = prod for hackathon)
Logging	Structured request logs + error logs (console/Winston/Pino)
Database migrations	Managed via Prisma Migrate, version-controlled
Seed data	Seed script for demo: sample products, warehouses, a few pre-validated documents
Backups	Not required for hackathon; note as a production consideration
CI	Optional: GitHub Actions to lint/build on push
Environment variables	DB connection string, JWT secret, OTP provider API key — via .env, never committed
10. Testing Strategy
Level	Approach
Unit	Test Stock Ledger Engine logic in isolation (receipt/delivery/transfer/adjustment math) — highest priority given it's the core business logic
Integration	Test API endpoints end-to-end against a test DB (e.g., using Supertest + a Dockerized Postgres or SQLite fallback)
Manual/Demo QA	Walk through the full demo script (Ideation Doc, Section 8) before presenting to catch UX/state bugs
Given hackathon time constraints, prioritize unit tests on the ledger engine (correctness is the credibility of the whole product) over exhaustive UI test coverage.

11. Deployment Plan
Push backend + frontend repos to GitHub.
Provision PostgreSQL on Railway/Render; run Prisma migrations + seed script.
Deploy backend API to Railway/Render; set environment variables.
Deploy frontend to Vercel; point VITE_API_URL to deployed backend.
Smoke-test the full demo script against the deployed environment before presenting.
12. Open Technical Questions / Decisions Needed
Should stock be allowed to go negative (with a warning) for delivery orders, or hard-blocked? (Affects FR-24 implementation.)
Is OTP delivery mocked entirely for the demo, or wired to a real email provider? (Time-boxing decision.)
Do we need role-based access control in v1, or is it a stretch goal? (Affects auth middleware scope.)
Single warehouse vs. multi-warehouse demo — schema supports both, but demo data should decide how many to seed.
13. Build Decisions (resolved during implementation)
Open questions from Section 12 and gaps found while reviewing against the problem statement:

Topic	Decision
Hosting & third parties	Local PostgreSQL only; no Vercel/Railway/Resend/SendGrid required. The organizers prefer local databases and minimal third-party APIs. `npm run build && npm start` serves the app and API from one process.
OTP delivery	Nodemailer over any SMTP server when SMTP_* is set; otherwise the code is logged on the server. OTP_DEV_ECHO=true also returns it to the UI for demos (disabled in production).
Negative stock (FR-24)	Hard block. Validation fails with a clear message and rolls back; a DB check constraint enforces stock_levels.quantity >= 0.
Status lifecycle	Confirm moves Draft → Ready, or → Waiting for deliveries/transfers whose source lacks stock. Waiting/Ready documents are re-evaluated after every validation. Receipts and adjustments may be validated from Draft.
Pick / pack	Added picked_at and packed_at to documents. Deliveries must be picked, then packed, before validation.
Scheduled date	Added scheduled_date to documents (needed for "Transfers Scheduled" and late indicators).
Adjustment location	Adjustments use source_location_id as the counted location. The delta (counted − recorded) is computed at validation time; the recorded quantity is stored on the line.
Concurrency	The document is claimed with a conditional update before any stock moves; stock rows are locked per line. Tested with concurrent validations.
Ledger immutability	A database trigger rejects UPDATE/DELETE on stock_ledger_entries.
Initial stock	Opening stock on product creation is written as a validated adjustment, so it appears in the ledger.
Reordering rules & low-stock alerts	In the MVP (the problem statement requires them), as min/max fields on products. One click creates a draft receipt up to the max.
Internal transfers	Added to the Operations menu (the problem statement's navigation omitted it).
Auth tokens	A single 7-day JWT in an httpOnly SameSite=Lax cookie instead of access + refresh tokens.
RBAC	Enforced server-side (403) and mirrored in the UI. Staff: view everything; create/confirm/pick/pack/validate receipts, deliveries and transfers; count stock (adjustments and Stock-page updates are submitted for approval). Managers additionally: approve/apply adjustments, cancel documents, manage products/categories/costs/reordering rules, warehouses/locations, and the Team page (promote/demote; the last manager can't be demoted). Roles are never self-selected: the first account becomes manager, later sign-ups join as staff.
Real-time	Server-Sent Events (/api/events, no library) push change notifications; the client refetches. Mutations also refetch immediately.
Excalidraw mockup alignment	Login by unique Login ID (6–12 chars) with the mockup's password rules and "Invalid Login Id or Password" message; sign-up has Re-Enter Password. Added a Stock page (per-unit cost, on hand, free to use = on hand − quantity reserved by Waiting/Ready deliveries and transfers, in-place updates logged as adjustments), a Settings → Locations page (with short codes), list/Kanban views, a To Do → Validate / Print / Cancel action bar with a Draft > Waiting > Ready > Done status bar, Responsible (auto-filled with the logged-in user), Delivery Address and Operation type fields, and green/red in/out rows in Move History. New columns: users.login_id, products.unit_cost, documents.delivery_address, locations.code.
