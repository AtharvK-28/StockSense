import {
  ArrowDownToLine,
  ArrowLeftRight,
  type LucideIcon,
  SlidersHorizontal,
  Truck,
} from "lucide-react";
import type { DocStatus, DocType, LedgerEntry, MoveType } from "./types";

const qtyFormat = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });
const dateFormat = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });
const shortDate = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });
const timeFormat = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" });

const moneyFormat = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
export const fmtMoney = (n: number | null | undefined) => (n == null ? "—" : moneyFormat.format(n));
export const fmtQty = (n: number | null | undefined) => (n == null ? "—" : qtyFormat.format(n));
export const fmtSigned = (n: number) => (n > 0 ? `+${fmtQty(n)}` : fmtQty(n));
export const fmtDate = (d: string | Date) => dateFormat.format(new Date(d));
export const fmtShortDate = (d: string | Date) => shortDate.format(new Date(d));
export const fmtDateTime = (d: string | Date) => `${shortDate.format(new Date(d))}, ${timeFormat.format(new Date(d))}`;

export function fmtRelative(d: string | Date) {
  const seconds = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return fmtShortDate(d);
}

export function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export const isOpen = (status: DocStatus) => status === "draft" || status === "waiting" || status === "ready";
export const isLate = (doc: { status: DocStatus; scheduledDate: string }) =>
  isOpen(doc.status) && new Date(doc.scheduledDate) < startOfToday();

/** yyyy-mm-dd in local time, for <input type="date">. */
export function toDateInput(d: string | Date) {
  const date = new Date(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export interface DocTypeMeta {
  type: DocType;
  label: string;
  plural: string;
  slug: string;
  icon: LucideIcon;
  partnerLabel: string | null;
  blurb: string;
}

export const DOC_TYPES: Record<DocType, DocTypeMeta> = {
  receipt: {
    type: "receipt",
    label: "Receipt",
    plural: "Receipts",
    slug: "receipts",
    icon: ArrowDownToLine,
    partnerLabel: "Supplier",
    blurb: "Incoming goods from vendors. Validating adds stock.",
  },
  delivery: {
    type: "delivery",
    label: "Delivery",
    plural: "Deliveries",
    slug: "deliveries",
    icon: Truck,
    partnerLabel: "Customer",
    blurb: "Outgoing shipments. Pick, pack, then validate to reduce stock.",
  },
  transfer: {
    type: "transfer",
    label: "Internal transfer",
    plural: "Internal transfers",
    slug: "transfers",
    icon: ArrowLeftRight,
    partnerLabel: null,
    blurb: "Move stock between warehouses and racks. Total stock stays the same.",
  },
  adjustment: {
    type: "adjustment",
    label: "Adjustment",
    plural: "Adjustments",
    slug: "adjustments",
    icon: SlidersHorizontal,
    partnerLabel: null,
    blurb: "Reconcile recorded stock with a physical count.",
  },
};

export const DOC_TYPE_LIST = Object.values(DOC_TYPES);
export const docTypeBySlug = (slug: string | undefined) => DOC_TYPE_LIST.find((m) => m.slug === slug);
export const docPath = (doc: { type: DocType; id: string }) => `/operations/${DOC_TYPES[doc.type].slug}/${doc.id}`;

export const STATUS_LABEL: Record<DocStatus, string> = {
  draft: "Draft",
  waiting: "Waiting",
  ready: "Ready",
  done: "Done",
  canceled: "Canceled",
};

export const MOVE_LABEL: Record<MoveType, string> = {
  receipt: "Receipt",
  delivery: "Delivery",
  transfer_in: "Transfer in",
  transfer_out: "Transfer out",
  adjustment: "Adjustment",
};

/** Human "from → to" for a ledger entry. */
export function moveRoute(m: LedgerEntry) {
  const here = `${m.location.warehouse.code} / ${m.location.name}`;
  const name = (l: LedgerEntry["document"]["sourceLocation"]) => (l ? `${l.warehouse.code} / ${l.name}` : "—");
  switch (m.operationType) {
    case "receipt":
      return { from: m.document.partnerName ?? "Vendor", to: here };
    case "delivery":
      return { from: here, to: m.document.partnerName ?? "Customer" };
    case "transfer_out":
    case "transfer_in":
      return { from: name(m.document.sourceLocation), to: name(m.document.destinationLocation) };
    case "adjustment":
      return m.quantityDelta >= 0 ? { from: "Inventory count", to: here } : { from: here, to: "Inventory loss" };
  }
}
