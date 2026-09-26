import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { ArrowRight, ChevronLeft, ChevronRight, Download, History, Search, Tags, Warehouse, X } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useToast } from "../components/toast";
import { Button, Card, Chip, EmptyState, IconButton, PageHeader, SelectPill, Skeleton } from "../components/ui";
import { api, errorMessage, qs } from "../lib/api";
import { MOVE_LABEL, docPath, fmtDateTime, fmtQty, fmtSigned, moveRoute } from "../lib/format";
import { useCategories, useDebounced, useWarehouses } from "../lib/queries";
import type { LedgerEntry, MoveType, ProductDetail } from "../lib/types";

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
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const search = useDebounced(q.trim());
  const warehouses = useWarehouses();
  const categories = useCategories();
  const toast = useToast();
  const [exporting, setExporting] = useState(false);

  const filters = { productId, q: search, type, warehouseId, categoryId, from, to };
  const ledger = useQuery({
    queryKey: ["ledger", filters, page],
    queryFn: () => api<LedgerPage>(`/ledger${qs({ ...filters, page, pageSize: PAGE_SIZE })}`),
    placeholderData: (prev) => prev,
  });
  const product = useQuery({
    queryKey: ["product", productId],
    queryFn: () => api<{ product: ProductDetail }>(`/products/${productId}`).then((r) => r.product),
    enabled: !!productId,
  });

  const reset = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const data = await api<LedgerPage>(`/ledger${qs({ ...filters, page: 1, pageSize: 500 })}`);
      const header = ["Date", "Reference", "Operation", "Product", "SKU", "From", "To", "Change", "Unit", "Balance after", "By"];
      const rows = data.items.map((m) => {
        const r = moveRoute(m);
        return [new Date(m.createdAt).toISOString(), m.document.reference, MOVE_LABEL[m.operationType], m.product.name, m.product.sku, r.from, r.to, m.quantityDelta, m.product.uom, m.balanceAfter, m.performedBy.name];
      });
      const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: `stock-ledger-${new Date().toISOString().slice(0, 10)}.csv` });
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: `Exported ${data.items.length} moves`, description: data.total > 500 ? "Only the latest 500 matching moves were included." : undefined });
    } catch (err) {
      toast({ title: errorMessage(err), tone: "error" });
    } finally {
      setExporting(false);
    }
  };

  const total = ledger.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        title="Move history"
        subtitle="The stock ledger — every movement, who made it, and the balance after. Entries are append-only."
        actions={
          <Button variant="subtle" icon={Download} onClick={exportCsv} loading={exporting} disabled={!total}>
            Export CSV
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full border border-line bg-white px-4 transition focus-within:border-ink focus-within:ring-1 focus-within:ring-ink sm:max-w-xs">
          <Search className="size-4 shrink-0 text-muted" />
          <input value={q} onChange={(e) => reset(setQ)(e.target.value)} placeholder="Product, SKU, reference…" aria-label="Search moves" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted" />
        </label>
        <SelectPill icon={Warehouse} value={warehouseId} onChange={(e) => reset(setWarehouseId)(e.target.value)} aria-label="Warehouse">
          <option value="">All warehouses</option>
          {warehouses.data?.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
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
        {productId && (
          <span className="flex h-10 items-center gap-2 rounded-full border border-ink bg-canvas pr-1.5 pl-4 text-sm font-medium ring-1 ring-ink ring-inset">
            {product.data?.name ?? "Product"}
            <IconButton icon={X} label="Clear product filter" className="size-7" onClick={() => setParams({}, { replace: true })} />
          </span>
        )}
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
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left text-sm">
                <thead>
                  <tr className="border-b border-hairline text-xs text-muted">
                    <th className="py-3 pr-4 pl-6 font-semibold">Date</th>
                    <th className="px-4 py-3 font-semibold">Reference</th>
                    <th className="px-4 py-3 font-semibold">Product</th>
                    <th className="px-4 py-3 font-semibold">From → To</th>
                    <th className="px-4 py-3 text-right font-semibold">Change</th>
                    <th className="px-4 py-3 text-right font-semibold">Balance</th>
                    <th className="py-3 pr-6 pl-4 font-semibold">By</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.data.items.map((m) => {
                    const route = moveRoute(m);
                    return (
                      <tr key={m.id} className="border-b border-hairline last:border-0 hover:bg-canvas/60">
                        <td className="py-3.5 pr-4 pl-6 whitespace-nowrap text-muted">{fmtDateTime(m.createdAt)}</td>
                        <td className="px-4 py-3.5">
                          <Link to={docPath(m.document)} className="font-semibold whitespace-nowrap hover:underline">
                            {m.document.reference}
                          </Link>
                          <div className="text-xs text-muted">{MOVE_LABEL[m.operationType]}</div>
                        </td>
                        <td className="px-4 py-3.5">
                          <Link to={`/products/${m.product.id}`} className="font-medium hover:underline">
                            {m.product.name}
                          </Link>
                          <div className="font-mono text-xs text-muted">{m.product.sku}</div>
                        </td>
                        <td className="px-4 py-3.5">
                          <span className="flex items-center gap-2">
                            <span className="max-w-[160px] truncate">{route.from}</span>
                            <ArrowRight className="size-3.5 shrink-0 text-subtle" />
                            <span className="max-w-[160px] truncate">{route.to}</span>
                          </span>
                        </td>
                        <td className={clsx("px-4 py-3.5 text-right font-semibold whitespace-nowrap", m.quantityDelta > 0 ? "text-ok" : "text-bad")}>
                          {fmtSigned(m.quantityDelta)} <span className="font-normal text-muted">{m.product.uom}</span>
                        </td>
                        <td className="px-4 py-3.5 text-right whitespace-nowrap">{fmtQty(m.balanceAfter)}</td>
                        <td className="py-3.5 pr-6 pl-4 whitespace-nowrap text-muted">{m.performedBy.name}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
