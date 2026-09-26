export type Role = "manager" | "staff";
export type DocType = "receipt" | "delivery" | "transfer" | "adjustment";
export type DocStatus = "draft" | "waiting" | "ready" | "done" | "canceled";
export type MoveType = "receipt" | "delivery" | "transfer_in" | "transfer_out" | "adjustment";
export type StockStatus = "in" | "low" | "out";

export interface User {
  id: string;
  loginId: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
}

export interface WarehouseRef {
  id: string;
  name: string;
  code: string;
}

export interface LocationRef {
  id: string;
  name: string;
  warehouse: WarehouseRef;
}

export interface LocationOption extends LocationRef {
  warehouseId: string;
  code: string | null;
  fullName: string;
}

export interface Warehouse extends WarehouseRef {
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  createdAt: string;
  locations: { id: string; name: string; code: string | null; warehouseId: string; productCount: number; totalQuantity: number }[];
}

export interface Category {
  id: string;
  name: string;
  productCount: number;
}

export interface ProductRow {
  id: string;
  name: string;
  sku: string;
  uom: string;
  unitCost: number | null;
  reserved: number;
  freeQty: number;
  category: { id: string; name: string } | null;
  minQty: number | null;
  maxQty: number | null;
  onHand: number;
  status: StockStatus;
  suggestedQty: number | null;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductDetail extends ProductRow {
  incoming: number;
  outgoing: number;
  stock: { locationId: string; location: string; warehouse: WarehouseRef; quantity: number; updatedAt: string }[];
}

export interface ProductSummary {
  id: string;
  name: string;
  sku: string;
  uom: string;
}

export interface LedgerEntry {
  id: string;
  createdAt: string;
  operationType: MoveType;
  quantityDelta: number;
  balanceAfter: number;
  product: ProductSummary;
  location: LocationRef;
  performedBy: { id: string; name: string };
  document: {
    id: string;
    reference: string;
    type: DocType;
    status: DocStatus;
    partnerName: string | null;
    sourceLocation: LocationRef | null;
    destinationLocation: LocationRef | null;
  };
}

interface DocumentBase {
  id: string;
  type: DocType;
  status: DocStatus;
  reference: string;
  partnerName: string | null;
  deliveryAddress: string | null;
  origin: string | null;
  sourceLocationId: string | null;
  destinationLocationId: string | null;
  sourceLocation: LocationRef | null;
  destinationLocation: LocationRef | null;
  scheduledDate: string;
  notes: string | null;
  pickedAt: string | null;
  packedAt: string | null;
  validatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentRow extends DocumentBase {
  lineCount: number;
  totalQuantity: number;
  products: ProductSummary[];
}

export interface DocumentLine {
  id: string;
  productId: string;
  quantity: number;
  countedQuantity: number | null;
  recordedQuantity: number | null;
  doneQuantity: number | null;
  notes: string | null;
  available: number | null;
  product: ProductSummary & { category: { id: string; name: string } | null };
}

export interface DocumentDetail extends DocumentBase {
  createdBy: { id: string; name: string; loginId: string };
  validatedBy: { id: string; name: string } | null;
  lines: DocumentLine[];
  moves: LedgerEntry[];
  backorderOf: DocumentLink | null;
  backorders: DocumentLink[];
  returnOf: DocumentLink | null;
  returns: DocumentLink[];
}

export interface DocumentLink {
  id: string;
  reference: string;
  status: DocStatus;
  type: DocType;
}

export interface Dashboard {
  awaitingApproval: { id: string; type: DocType; reference: string; createdAt: string; submittedBy: string; location: string | null; summary: string }[];
  kpis: {
    totalProducts: number;
    inStock: number;
    lowStock: number;
    outOfStock: number;
    totalUnits: number;
    pendingReceipts: { total: number; late: number; ready: number };
    pendingDeliveries: { total: number; late: number; waiting: number; ready: number };
    scheduledTransfers: { total: number; late: number };
  };
  alerts: {
    id: string;
    name: string;
    sku: string;
    uom: string;
    category: string | null;
    onHand: number;
    minQty: number | null;
    maxQty: number | null;
    status: StockStatus;
    suggestedQty: number | null;
  }[];
  recentMoves: LedgerEntry[];
}

export interface SearchResults {
  products: (ProductSummary & { onHand: number; imageUrl: string | null; category: { name: string } | null })[];
  documents: { id: string; reference: string; type: DocType; status: DocStatus; partnerName: string | null }[];
}
