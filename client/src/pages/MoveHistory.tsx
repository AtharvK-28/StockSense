import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, History, KanbanSquare, List, MapPin, Package, Search, Tags, Warehouse } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ExportMenu } from "../components/ExportMenu";
import { ViewToggle } from "../components/DocumentTable";
import { Card, Chip, EmptyState, IconButton, PageHeader, SelectPill, Skeleton, StatusBadge } from "../components/ui";
import { api, qs } from "../lib/api";
import { MOVE_LABEL, docPath, fmtDateTime, fmtQty, fmtSigned, moveRoute } from "../lib/format";
import { useCategories, useDebounced, useLocations, useProducts, useWarehouses } from "../lib/queries";
import type { LedgerEntry, MoveType } from "../lib/types";

const TYPES: { key: "" | MoveType; label: string }[] = [
  { key: "", label: "All moves" },
  { key: "receipt", label: "Receipts" },
  { key: "delivery", label: "Deliveries" },
  { key: "transfer_in", label: "Transfers in" },
  { key: "transfer_out", label: "Transfers out" },
  { key: "adjustment", label: "Adjustments" },
];
const PAGE_SIZE = 50;

interface LedgerPage {
  items: LedgerEntry[];
  total: number;
}

export function MoveHistory() {
  const [params, setParams] = useSearchParams();
  const productId = params.get("productId") ?? "";
  const [q, setQ] = useState("");
  const [type, setType] = useState<"" | MoveType>("");
  const [warehouseId, setWarehouseId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [locationId, setLocationId] = useState("");
  const locations = useLocations();
  const products = useProducts({});
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [view, setView] = useState<"list" | "kanban">("list");
  const search = useDebounced(q.trim());
  const warehouses = useWarehouses();
  const categories = useCategories();

  const filters = { productId, q: search, type, warehouseId, locationId, categoryId, from, to };
  const ledger = useQuery({
    queryKey: ["ledger", filters, page],
    queryFn: () => api<LedgerPage>(`/ledger${qs({ ...filters, page, pageSize: PAGE_SIZE })}`),
    placeholderData: (prev) => prev,
  });
  const reset = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  const total = ledger.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        title="Move history"
        subtitle="The stock ledger — every movement, who made it, and the balance after. Entries are append-only."
        actions={
          <ExportMenu dataset="moves" params={{ productId, q: search, type, warehouseId, locationId, categoryId, from, to }} disabled={!total} />
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full border border-line bg-white px-4 transition focus-within:border-ink focus-within:ring-1 focus-within:ring-ink sm:max-w-xs">
          <Search className="size-4 shrink-0 text-muted" />
          <input value={q} onChange={(e) => reset(setQ)(e.target.value)} placeholder="Reference, contact or product" aria-label="Search moves" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted" />
        </label>
        <SelectPill
          icon={Warehouse}
          value={warehouseId}
          onChange={(e) => {
            reset(setWarehouseId)(e.target.value);
            setLocationId("");
          }}
          aria-label="Warehouse"
        >
          <option value="">All warehouses</option>
          {warehouses.data?.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </SelectPill>
        <SelectPill icon={MapPin} value={locationId} onChange={(e) => reset(setLocationId)(e.target.value)} aria-label="Location">
          <option value="">All locations</option>
          {locations.data
            ?.filter((l) => !warehouseId || l.warehouseId === warehouseId)
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.warehouse.code} / {l.name}
              </option>
            ))}
        </SelectPill>
        <SelectPill
          icon={Package}
          value={productId}
          onChange={(e) => {
            setPage(1);
            setParams(e.target.value ? { productId: e.target.value } : {}, { replace: true });
          }}
          aria-label="Product"
        >
          <option value="">All products</option>
          {products.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectPill>
        <SelectPill icon={Tags} value={categoryId} onChange={(e) => reset(setCategoryId)(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectPill>
        <div className="flex h-10 items-center gap-1 rounded-full border border-line bg-white px-3 text-sm">
          <input type="date" value={from} onChange={(e) => reset(setFrom)(e.target.value)} aria-label="From date" className="bg-transparent outline-none" />
          <span className="text-muted">–</span>
          <input type="date" value={to} onChange={(e) => reset(setTo)(e.target.value)} aria-label="To date" className="bg-transparent outline-none" />
        </div>
        <div className="ml-auto">
          <ViewToggle
            value={view}
            onChange={setView}
            options={[
              { key: "list", label: "List", icon: List },
              { key: "kanban", label: "Kanban", icon: KanbanSquare },
            ]}
          />
        </div>
      </div>
      <div className="scrollbar-none -mx-1 mb-6 flex gap-2 overflow-x-auto px-1 py-0.5">
        {TYPES.map((t) => (
          <Chip key={t.key} active={type === t.key} onClick={() => reset(setType)(t.key)}>
            {t.label}
          </Chip>
        ))}
      </div>

      <Card>
        {!ledger.data ? (
          <div className="space-y-3 p-6">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : ledger.data.items.length === 0 ? (
          <EmptyState icon={History} title="No moves found">
            Validated receipts, deliveries, transfers and adjustments appear here.
          </EmptyState>
        ) : (
          <>
            {view === "kanban" ? (
              <MoveKanban moves={ledger.data.items} />
            ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] text-left text-sm">
                <thead>
                  <tr className="border-b border-hairline text-xs text-muted">
                    <th className="py-3 pr-4 pl-6 font-semibold">Reference</th>
                    <th className="px-4 py-3 font-semibold">Date</th>
                    <th className="px-4 py-3 font-semibold">Contact</th>
                    <th className="px-4 py-3 font-semibold">Product</th>
                    <th className="px-4 py-3 font-semibold">From</th>
                    <th className="px-4 py-3 font-semibold">To</th>
                    <th className="px-4 py-3 text-right font-semibold">Quantity</th>
                    <th className="px-4 py-3 text-right font-semibold">Balance</th>
                    <th className="px-4 py-3 font-semibold">By</th>
                    <th className="py-3 pr-6 pl-4 text-right font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.data.items.map((m) => {
                    const route = moveRoute(m);
                    const incoming = m.quantityDelta > 0;
                    return (
                      <tr
                        key={m.id}
                        className={clsx(
                          "border-b border-hairline border-l-4 last:border-b-0",
                          incoming ? "border-l-ok bg-ok-50/40 text-ok" : "border-l-bad bg-bad-50/40 text-bad",
                        )}
                      >
                        <td className="py-3.5 pr-4 pl-5">
                          <Link to={docPath(m.document)} className="flex items-center gap-1.5 font-semibold whitespace-nowrap hover:underline">
                            {incoming ? <ArrowDownLeft className="size-3.5" /> : <ArrowUpRight className="size-3.5" />}
                            {m.document.reference}
                          </Link>
                          <div className="text-xs opacity-80">{MOVE_LABEL[m.operationType]}</div>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap">{fmtDateTime(m.createdAt)}</td>
                        <td className="px-4 py-3.5">
                          <span className="block max-w-[160px] truncate">{m.document.partnerName ?? "—"}</span>
                        </td>
                        <td className="px-4 py-3.5">
                          <Link to={`/products/${m.product.id}`} className="block max-w-[200px] truncate font-medium hover:underline" title={m.product.name}>
                            {m.product.name}
                          </Link>
                          <div className="font-mono text-xs opacity-80">{m.product.sku}</div>
                        </td>
                        <td className="px-4 py-3.5">
                          <span className="block max-w-[160px] truncate">{route.from}</span>
                        </td>
                        <td className="px-4 py-3.5">
                          <span className="block max-w-[160px] truncate">{route.to}</span>
                        </td>
                        <td className="px-4 py-3.5 text-right font-semibold whitespace-nowrap">
                          {fmtSigned(m.quantityDelta)} <span className="font-normal">{m.product.uom}</span>
                        </td>
                        <td className="px-4 py-3.5 text-right whitespace-nowrap text-ink">{fmtQty(m.balanceAfter)}</td>
                        <td className="px-4 py-3.5 whitespace-nowrap text-muted">{m.performedBy.name}</td>
                        <td className="py-3.5 pr-6 pl-4 text-right">
                          <StatusBadge status={m.document.status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )}
            <div className="flex items-center justify-between border-t border-hairline px-6 py-3 text-sm text-muted">
              <span>
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total} moves
              </span>
              <div className="flex gap-1">
                <IconButton icon={ChevronLeft} label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} />
                <IconButton icon={ChevronRight} label="Next page" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} />
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

const KANBAN_GROUPS: { label: string; types: MoveType[] }[] = [
  { label: "Receipts", types: ["receipt"] },
  { label: "Deliveries", types: ["delivery"] },
  { label: "Transfers", types: ["transfer_in", "transfer_out"] },
  { label: "Adjustments", types: ["adjustment"] },
];

/** Kanban view of the ledger, one column per kind of move. */
function MoveKanban({ moves }: { moves: LedgerEntry[] }) {
  return (
    <div className="scrollbar-none flex gap-4 overflow-x-auto p-4">
      {KANBAN_GROUPS.map((g) => {
        const items = moves.filter((m) => g.types.includes(m.operationType));
        return (
          <section key={g.label} className="flex w-72 shrink-0 flex-col rounded-2xl bg-canvas p-3">
            <header className="flex items-center px-2 pt-1 pb-3">
              <h3 className="text-sm font-semibold">{g.label}</h3>
              <span className="ml-auto rounded-full bg-white px-2 text-xs font-semibold text-muted">{items.length}</span>
            </header>
            <div className="flex flex-col gap-3">
              {items.length === 0 && <p className="px-2 pb-2 text-xs text-muted">No moves</p>}
              {items.map((m) => {
                const incoming = m.quantityDelta > 0;
                const route = moveRoute(m);
                return (
                  <Link
                    key={m.id}
                    to={docPath(m.document)}
                    className={clsx("rounded-xl border-l-4 bg-white p-4 transition hover:shadow-lift", incoming ? "border-l-ok" : "border-l-bad")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{m.document.reference}</span>
                      <span className={clsx("text-sm font-semibold", incoming ? "text-ok" : "text-bad")}>
                        {fmtSigned(m.quantityDelta)} {m.product.uom}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-sm">{m.product.name}</p>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {route.from} → {route.to}
                    </p>
                    <p className="mt-2 text-xs text-muted">{fmtDateTime(m.createdAt)}</p>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
