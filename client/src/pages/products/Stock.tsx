import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Boxes, PencilLine, Search, Tags, Warehouse } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { LocationSelect } from "../../components/pickers";
import { Button, Card, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, SelectPill, Skeleton, StockBadge } from "../../components/ui";
import { useToast } from "../../components/toast";
import { api, errorMessage } from "../../lib/api";
import { useIsManager } from "../../lib/auth";
import { fmtMoney, fmtQty } from "../../lib/format";
import { useAction, useCategories, useDebounced, useLocations, useProducts, useWarehouses } from "../../lib/queries";
import type { ProductDetail, ProductRow } from "../../lib/types";

export function Stock() {
  const [q, setQ] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const isManager = useIsManager();
  const search = useDebounced(q.trim());
  const warehouses = useWarehouses();
  const categories = useCategories();
  const products = useProducts({ q: search || undefined, warehouseId: warehouseId || undefined, categoryId: categoryId || undefined });
  const items = products.data;

  const totals = useMemo(() => {
    const rows = items ?? [];
    return {
      value: rows.reduce((sum, p) => sum + p.onHand * (p.unitCost ?? 0), 0),
      units: rows.reduce((sum, p) => sum + p.onHand, 0),
      reserved: rows.reduce((sum, p) => sum + p.reserved, 0),
    };
  }, [items]);

  return (
    <div>
      <PageHeader title="Stock" subtitle="What's on hand, what's promised to open deliveries, and what's free to use. Updating a count logs an adjustment in the ledger." />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: "Stock value", value: items ? fmtMoney(totals.value) : null },
          { label: "Units on hand", value: items ? fmtQty(totals.units) : null },
          { label: "Reserved for open orders", value: items ? fmtQty(totals.reserved) : null },
        ].map((t) => (
          <Card key={t.label} className="p-5">
            <p className="text-sm text-muted">{t.label}</p>
            {t.value == null ? <Skeleton className="mt-2 h-8 w-28" /> : <p className="mt-1 text-[26px] font-semibold tracking-tight">{t.value}</p>}
          </Card>
        ))}
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full border border-line bg-white px-4 transition focus-within:border-ink focus-within:ring-1 focus-within:ring-ink sm:max-w-sm">
          <Search className="size-4 shrink-0 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search product or SKU" aria-label="Search stock" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted" />
        </label>
        <SelectPill icon={Warehouse} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} aria-label="Warehouse">
          <option value="">All warehouses</option>
          {warehouses.data?.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </SelectPill>
        <SelectPill icon={Tags} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectPill>
      </div>

      <Card>
        {!items ? (
          <div className="space-y-3 p-6">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={Boxes} title="No stock to show">
            {search ? "Nothing matches your search." : "Add products and receive them to see stock here."}
          </EmptyState>
        ) : (
          <>
          <ul className="divide-y divide-hairline sm:hidden">
            {items.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <Link to={`/products/${p.id}`} className="font-semibold">
                    {p.name}
                  </Link>
                  <p className="font-mono text-xs text-muted">{p.sku}</p>
                  <p className="mt-1 text-sm">
                    <span className="font-semibold">
                      {fmtQty(p.onHand)} {p.uom}
                    </span>{" "}
                    <span className="text-muted">on hand · {fmtQty(p.freeQty)} free</span>
                  </p>
                </div>
                <Button size="sm" variant="subtle" icon={PencilLine} onClick={() => setEditing(p)}>
                  {isManager ? "Update" : "Count"}
                </Button>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-hairline text-xs text-muted">
                  <th className="py-3 pr-4 pl-6 font-semibold">Product</th>
                  <th className="px-4 py-3 text-right font-semibold">Per unit cost</th>
                  <th className="px-4 py-3 text-right font-semibold">On hand</th>
                  <th className="px-4 py-3 text-right font-semibold">Reserved</th>
                  <th className="px-4 py-3 text-right font-semibold">Free to use</th>
                  <th className="px-4 py-3 text-right font-semibold">Value</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="py-3 pr-6 pl-4" />
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id} className="border-b border-hairline last:border-0 hover:bg-canvas/60">
                    <td className="py-3.5 pr-4 pl-6">
                      <Link to={`/products/${p.id}`} className="font-semibold hover:underline">
                        {p.name}
                      </Link>
                      <div className="font-mono text-xs text-muted">{p.sku}</div>
                    </td>
                    <td className="px-4 py-3.5 text-right whitespace-nowrap">{fmtMoney(p.unitCost)}</td>
                    <td className="px-4 py-3.5 text-right font-semibold whitespace-nowrap">
                      {fmtQty(p.onHand)} <span className="font-normal text-muted">{p.uom}</span>
                    </td>
                    <td className="px-4 py-3.5 text-right whitespace-nowrap text-muted">{p.reserved ? fmtQty(p.reserved) : "—"}</td>
                    <td className={clsx("px-4 py-3.5 text-right font-semibold whitespace-nowrap", p.freeQty < p.onHand && "text-warn")}>{fmtQty(p.freeQty)}</td>
                    <td className="px-4 py-3.5 text-right whitespace-nowrap text-muted">{p.unitCost != null ? fmtMoney(p.unitCost * p.onHand) : "—"}</td>
                    <td className="px-4 py-3.5">
                      <StockBadge status={p.status} />
                    </td>
                    <td className="py-3.5 pr-6 pl-4 text-right">
                      <Button size="sm" variant="subtle" icon={PencilLine} onClick={() => setEditing(p)}>
                        {isManager ? "Update" : "Count"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>
      {editing && <UpdateStockModal product={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function UpdateStockModal({ product, onClose }: { product: ProductRow; onClose: () => void }) {
  const locations = useLocations();
  const isManager = useIsManager();
  const toast = useToast();
  const detail = useQuery({
    queryKey: ["product", product.id],
    queryFn: () => api<{ product: ProductDetail }>(`/products/${product.id}`).then((r) => r.product),
  });
  const [locationId, setLocationId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [cost, setCost] = useState(product.unitCost?.toString() ?? "");

  // Default to where most of this product sits.
  const location = locationId || detail.data?.stock[0]?.locationId || locations.data?.[0]?.id || "";
  const current = detail.data?.stock.find((s) => s.locationId === location)?.quantity ?? 0;
  const next = quantity === "" ? null : Number(quantity);
  const delta = next == null ? null : next - current;
  const costChanged = isManager && cost !== (product.unitCost?.toString() ?? "");

  const save = useAction(
    async () => {
      if (costChanged) {
        await api(`/products/${product.id}`, {
          method: "PUT",
          body: {
            name: product.name,
            sku: product.sku,
            categoryId: product.category?.id ?? null,
            uom: product.uom,
            minQty: product.minQty,
            maxQty: product.maxQty,
            unitCost: cost === "" ? null : Number(cost),
          },
        });
      }
      if (next != null && delta !== 0) {
        const res = await api<{ applied: boolean }>("/stock/adjust", {
          method: "POST",
          body: { productId: product.id, locationId: location, quantity: next, reason: reason || null },
        });
        return res.applied;
      }
      return true;
    },
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={isManager ? "Update stock" : "Submit a stock count"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="stock-form" loading={save.isPending} disabled={(next == null || delta === 0) && !costChanged}>
            {isManager ? "Save" : "Submit for approval"}
          </Button>
        </>
      }
    >
      <p className="mb-5 text-[15px]">
        <span className="font-semibold">{product.name}</span> <span className="font-mono text-sm text-muted">{product.sku}</span>
      </p>
      <form
        id="stock-form"
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined, {
            onSuccess: (applied) => {
              toast(applied ? { title: "Stock updated" } : { title: "Count sent for approval", description: "A manager will review it before stock changes." });
              onClose();
            },
          });
        }}
      >
        <Field label="Location" className="sm:col-span-2" hint={`Currently ${fmtQty(current)} ${product.uom} here`}>
          <LocationSelect value={location} onChange={setLocationId} locations={locations.data ?? []} />
        </Field>
        <Field
          label={`New quantity (${product.uom})`}
          hint={delta == null ? "Physical count at this location" : delta === 0 ? "No change" : <span className={delta > 0 ? "text-ok" : "text-bad"}>{delta > 0 ? "+" : ""}{fmtQty(delta)} will be logged</span>}
        >
          <Input type="number" min={0} step="any" autoFocus value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder={String(current)} />
        </Field>
        {isManager ? (
          <Field label="Per unit cost (₹)">
            <Input type="number" min={0} step="any" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="Not set" />
          </Field>
        ) : (
          <p className="self-center text-[13px] text-muted">Your count goes to an inventory manager for approval before stock changes.</p>
        )}
        <Field label="Reason" className="sm:col-span-2">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Cycle count, damaged items" />
        </Field>
        {save.isError && (
          <div className="sm:col-span-2">
            <ErrorNote>{errorMessage(save.error)}</ErrorNote>
          </div>
        )}
      </form>
    </Modal>
  );
}
