import { clsx } from "clsx";
import { LayoutGrid, List, Package, Plus, Search, Tags, Warehouse } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Button, Card, Chip, EmptyState, IconButton, PageHeader, SelectPill, Skeleton, StockBadge } from "../../components/ui";
import { useIsManager } from "../../lib/auth";
import { fmtQty } from "../../lib/format";
import { useCategories, useDebounced, useProducts, useWarehouses } from "../../lib/queries";
import type { ProductRow } from "../../lib/types";
import { categoryVisual } from "../../lib/visual";

const STOCK_FILTERS = [
  { key: "", label: "All" },
  { key: "in", label: "In stock" },
  { key: "alert", label: "Needs attention" },
  { key: "low", label: "Low stock" },
  { key: "out", label: "Out of stock" },
];

function readView(): "grid" | "list" {
  try {
    return localStorage.getItem("ss:productView") === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

export function ProductList() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [view, setView] = useState(readView);
  const isManager = useIsManager();
  const search = useDebounced(q.trim());
  const categoryId = params.get("categoryId") ?? "";
  const warehouseId = params.get("warehouseId") ?? "";
  const stock = params.get("stock") ?? "";

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  // Follow ?q= when it changes from outside (e.g. the global search), without fighting the input.
  useEffect(() => {
    const fromUrl = params.get("q") ?? "";
    if (fromUrl !== search) setQ(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);
  useEffect(() => {
    if (search !== (params.get("q") ?? "")) setParam("q", search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  useEffect(() => {
    try {
      localStorage.setItem("ss:productView", view);
    } catch {
      /* storage unavailable */
    }
  }, [view]);

  const products = useProducts({ q: search || undefined, categoryId: categoryId || undefined, warehouseId: warehouseId || undefined, stock: stock || undefined });
  const categories = useCategories();
  const warehouses = useWarehouses();
  const items = products.data;

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle={items ? `${items.length} product${items.length === 1 ? "" : "s"}${search ? ` matching “${search}”` : ""}` : "Loading…"}
        actions={
          isManager && (
            <Link to="/products/new">
              <Button variant="primary" icon={Plus}>
                New product
              </Button>
            </Link>
          )
        }
      />

      <div className="mb-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full border border-line bg-white px-4 transition focus-within:border-ink focus-within:ring-1 focus-within:ring-ink sm:max-w-sm">
            <Search className="size-4 shrink-0 text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name or SKU"
              aria-label="Search products"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
            />
          </label>
          <SelectPill icon={Tags} value={categoryId} onChange={(e) => setParam("categoryId", e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectPill>
          <SelectPill icon={Warehouse} value={warehouseId} onChange={(e) => setParam("warehouseId", e.target.value)} aria-label="Warehouse">
            <option value="">All warehouses</option>
            {warehouses.data?.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </SelectPill>
          <div className="ml-auto flex rounded-full border border-line p-0.5">
            <IconButton icon={LayoutGrid} label="Grid view" onClick={() => setView("grid")} className={clsx("size-8", view === "grid" && "bg-canvas")} />
            <IconButton icon={List} label="List view" onClick={() => setView("list")} className={clsx("size-8", view === "list" && "bg-canvas")} />
          </div>
        </div>
        <div className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 py-0.5">
          {STOCK_FILTERS.map((f) => (
            <Chip key={f.key} active={stock === f.key} onClick={() => setParam("stock", f.key)}>
              {f.label}
            </Chip>
          ))}
        </div>
      </div>

      {!items ? (
        <div className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i}>
              <Skeleton className="aspect-[4/3] rounded-xl" />
              <Skeleton className="mt-3 h-4 w-2/3" />
              <Skeleton className="mt-2 h-3 w-1/3" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon={Package}
            title={search || categoryId || stock ? "No products match" : "No products yet"}
            action={
              search || categoryId || stock ? (
                <Button variant="outline" onClick={() => setParams({}, { replace: true })}>
                  Clear filters
                </Button>
              ) : isManager ? (
                <Button variant="primary" icon={Plus} onClick={() => navigate("/products/new")}>
                  Add your first product
                </Button>
              ) : null
            }
          >
            {search || categoryId || stock ? "Try a different search or remove a filter." : "Add products with a SKU, category and unit of measure to start tracking stock."}
          </EmptyState>
        </Card>
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {items.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      ) : (
        <ProductTable products={items} />
      )}
    </div>
  );
}

function ProductCard({ product: p }: { product: ProductRow }) {
  const visual = categoryVisual(p.category?.name);
  return (
    <Link to={`/products/${p.id}`} className="group block">
      <div className="relative grid aspect-[4/3] place-items-center overflow-hidden rounded-xl" style={{ background: visual.bg }}>
        <visual.icon className="size-16 transition duration-300 group-hover:scale-110" style={{ color: visual.fg }} strokeWidth={1.25} />
        <span className="absolute top-3 left-3">
          <StockBadge status={p.status} floating />
        </span>
        <span className="absolute right-3 bottom-3 rounded-md bg-white/80 px-2 py-1 font-mono text-[11px] font-semibold text-ink backdrop-blur">{p.sku}</span>
      </div>
      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold">{p.name}</h3>
          <p className="truncate text-[15px] text-muted">{p.category?.name ?? "Uncategorised"}</p>
        </div>
      </div>
      <p className="mt-1 text-[15px]">
        <span className="font-semibold">
          {fmtQty(p.onHand)} {p.uom}
        </span>{" "}
        <span className="text-muted">on hand</span>
      </p>
    </Link>
  );
}

function ProductTable({ products }: { products: ProductRow[] }) {
  const navigate = useNavigate();
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-hairline text-xs text-muted">
              <th className="py-3 pr-4 pl-6 font-semibold">Product</th>
              <th className="px-4 py-3 font-semibold">SKU</th>
              <th className="px-4 py-3 font-semibold">Category</th>
              <th className="px-4 py-3 text-right font-semibold">On hand</th>
              <th className="px-4 py-3 text-right font-semibold">Min</th>
              <th className="py-3 pr-6 pl-4 text-right font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const visual = categoryVisual(p.category?.name);
              return (
                <tr key={p.id} onClick={() => navigate(`/products/${p.id}`)} className="cursor-pointer border-b border-hairline last:border-0 hover:bg-canvas/70">
                  <td className="py-3 pr-4 pl-6">
                    <div className="flex items-center gap-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-lg" style={{ background: visual.bg }}>
                        <visual.icon className="size-5" style={{ color: visual.fg }} strokeWidth={1.5} />
                      </span>
                      <span className="font-semibold">{p.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{p.sku}</td>
                  <td className="px-4 py-3 text-muted">{p.category?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-right font-semibold whitespace-nowrap">
                    {fmtQty(p.onHand)} <span className="font-normal text-muted">{p.uom}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-muted">{fmtQty(p.minQty)}</td>
                  <td className="py-3 pr-6 pl-4 text-right">
                    <StockBadge status={p.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
