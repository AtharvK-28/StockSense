import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Download, Moon, Printer, Tags, TrendingUp, Warehouse } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { AreaChart, ChartTable, HBars, MirrorColumns } from "../components/charts";
import { Button, Card, CardHeader, CategoryBar, Chip, EmptyState, PageHeader, SelectPill, Skeleton } from "../components/ui";
import { api, qs } from "../lib/api";
import { fmtDate, fmtMoney, fmtQty, fmtShortDate } from "../lib/format";
import { useCategories, useWarehouses } from "../lib/queries";

interface ProductStat {
  id: string;
  name: string;
  sku: string;
  uom: string;
  category: string;
  onHand: number;
  unitCost: number;
  value: number;
  shipped: number;
  shippedValue: number;
  daysOfCover: number | null;
  lastShippedAt: string | null;
}

interface AnalyticsData {
  days: number;
  kpis: { stockValue: number; valueChange: number; unitsShipped: number; unitsReceived: number; turnover: number; deadStockValue: number };
  series: { date: string; value: number; units: number; inQty: number; outQty: number; inValue: number; outValue: number }[];
  topMovers: ProductStat[];
  deadStock: ProductStat[];
  byCategory: { category: string; value: number; units: number }[];
}

interface Valuation {
  groupBy: "product" | "location" | "category";
  items: { key: string; label: string; sublabel: string | null; quantity: number; value: number; uom: string | null; unitCost: number | null; lines: number }[];
  total: number;
}

const compactMoney = (v: number) =>
  v >= 1e7 ? `₹${(v / 1e7).toFixed(1)}Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(1)}L` : v >= 1e3 ? `₹${(v / 1e3).toFixed(0)}K` : `₹${Math.round(v)}`;

type Tab = "overview" | "valuation";

export function Analytics() {
  const [tab, setTab] = useState<Tab>("overview");
  const [days, setDays] = useState(30);
  const [warehouseId, setWarehouseId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const warehouses = useWarehouses();
  const categories = useCategories();

  return (
    <div>
      <PageHeader title="Analytics" subtitle="Everything here is computed from the stock ledger — history is replayed from every validated movement." />
      <div className="mb-6 border-b border-hairline">
        <CategoryBar
          value={tab}
          onChange={setTab}
          items={[
            { key: "overview" as Tab, label: "Overview", icon: TrendingUp },
            { key: "valuation" as Tab, label: "Valuation report", icon: Tags },
          ]}
        />
      </div>

      {/* One filter row scopes everything below it. */}
      <div className="mb-8 flex flex-wrap items-center gap-2 print:hidden">
        {tab === "overview" &&
          [7, 30, 90].map((d) => (
            <Chip key={d} active={days === d} onClick={() => setDays(d)}>
              Last {d} days
            </Chip>
          ))}
        <SelectPill icon={Warehouse} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} aria-label="Warehouse">
          <option value="">All warehouses</option>
          {warehouses.data?.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </SelectPill>
        {tab === "overview" && (
          <SelectPill icon={Tags} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectPill>
        )}
      </div>

      {tab === "overview" ? <Overview days={days} warehouseId={warehouseId} categoryId={categoryId} /> : <ValuationReport warehouseId={warehouseId} />}
    </div>
  );
}

function Tile({ label, value, sub, hero }: { label: string; value: string; sub?: React.ReactNode; hero?: boolean }) {
  return (
    <Card className={clsx("min-w-0 p-5", hero && "col-span-2")}>
      <p className="text-sm text-muted">{label}</p>
      <p className={clsx("mt-1 font-semibold tracking-tight", hero ? "text-[40px] leading-none sm:text-[48px]" : "text-[26px]")}>{value}</p>
      {sub && <p className="mt-2 text-[13px] text-muted">{sub}</p>}
    </Card>
  );
}

function Overview({ days, warehouseId, categoryId }: { days: number; warehouseId: string; categoryId: string }) {
  const q = useQuery({
    queryKey: ["analytics", days, warehouseId, categoryId],
    queryFn: () => api<AnalyticsData>(`/analytics${qs({ days, warehouseId, categoryId })}`),
    placeholderData: (prev) => prev,
  });
  const d = q.data;
  if (!d) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  }
  const k = d.kpis;
  const change = k.valueChange;

  return (
    // Refetch keeps the frame: previous render stays, dimmed, while new data loads.
    <div className={clsx("space-y-8 transition-opacity", q.isFetching && "opacity-60")}>
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-6" aria-label="Key figures">
        <Tile
          hero
          label="Stock value"
          value={fmtMoney(Math.round(k.stockValue)).replace(/\.00$/, "")}
          sub={
            <>
              {change === 0 ? "No change" : `${change > 0 ? "+" : "−"}${fmtMoney(Math.abs(change))}`} vs {days} days ago
            </>
          }
        />
        <Tile label="Units shipped" value={fmtQty(k.unitsShipped)} sub={`last ${days} days`} />
        <Tile label="Units received" value={fmtQty(k.unitsReceived)} sub={`last ${days} days`} />
        <Tile label="Turnover" value={`${k.turnover.toFixed(2)}×`} sub="cost shipped ÷ avg stock value" />
        <Tile label="Dead stock" value={compactMoney(k.deadStockValue)} sub={`no sales in ${days} days`} />
      </section>

      <Card className="p-6">
        <h2 className="text-lg font-semibold tracking-tight">Stock value over time</h2>
        <p className="mb-4 text-sm text-muted">End-of-day value at current unit costs</p>
        <AreaChart data={d.series.map((s) => ({ date: s.date, value: s.value }))} format={fmtMoney} formatTick={compactMoney} label="Stock value" />
        <ChartTable
          caption="Stock value by day"
          columns={["Date", "Stock value", "Units"]}
          rows={d.series.map((s) => [fmtDate(s.date), fmtMoney(s.value), fmtQty(s.units)])}
        />
      </Card>

      <Card className="p-6">
        <h2 className="text-lg font-semibold tracking-tight">Received vs shipped</h2>
        <p className="mb-4 text-sm text-muted">
          Value per day at current unit costs — receipts and positive counts above the line, deliveries and losses below
        </p>
        <MirrorColumns data={d.series.map((s) => ({ date: s.date, up: s.inValue, down: s.outValue }))} up="Received" down="Shipped" format={compactMoney} />
        <ChartTable
          caption="Value and units received and shipped by day"
          columns={["Date", "Received (₹)", "Shipped (₹)", "Units in", "Units out"]}
          rows={d.series.map((s) => [fmtDate(s.date), fmtMoney(s.inValue), fmtMoney(s.outValue), fmtQty(s.inQty), fmtQty(s.outQty)])}
        />
      </Card>

      <div className="grid gap-8 xl:grid-cols-3">
        <Card className="min-w-0 p-6">
          <h2 className="text-lg font-semibold tracking-tight">Value by category</h2>
          <p className="mb-5 text-sm text-muted">Where the money sits today</p>
          {d.byCategory.length ? (
            <HBars label="Stock value by category" format={compactMoney} items={d.byCategory.map((c) => ({ label: c.category, value: c.value, sub: `${fmtQty(c.units)} units` }))} />
          ) : (
            <p className="text-sm text-muted">No stock in this view.</p>
          )}
        </Card>

        <Card className="min-w-0 xl:col-span-2">
          <CardHeader title="Top movers" subtitle={`Highest value shipped in the last ${days} days`} />
          {d.topMovers.length === 0 ? (
            <EmptyState icon={TrendingUp} title="No deliveries in this period" className="py-8" />
          ) : (
            <div className="overflow-x-auto border-t border-hairline">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead>
                  <tr className="border-b border-hairline text-xs text-muted">
                    <th className="py-3 pr-4 pl-6 font-semibold">Product</th>
                    <th className="px-4 py-3 text-right font-semibold">Shipped</th>
                    <th className="px-4 py-3 text-right font-semibold">Value shipped</th>
                    <th className="px-4 py-3 text-right font-semibold">On hand</th>
                    <th className="py-3 pr-6 pl-4 text-right font-semibold">Days of cover</th>
                  </tr>
                </thead>
                <tbody>
                  {d.topMovers.map((p) => (
                    <tr key={p.id} className="border-b border-hairline last:border-0">
                      <td className="py-3 pr-4 pl-6">
                        <Link to={`/products/${p.id}`} className="font-semibold hover:underline">
                          {p.name}
                        </Link>
                        <div className="font-mono text-xs text-muted">{p.sku}</div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {fmtQty(p.shipped)} <span className="text-muted">{p.uom}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{fmtMoney(p.shippedValue)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmtQty(p.onHand)}</td>
                      <td className={clsx("py-3 pr-6 pl-4 text-right font-semibold tabular-nums", p.daysOfCover != null && p.daysOfCover < 7 && "text-bad")}>
                        {p.daysOfCover == null ? "—" : `${Math.round(p.daysOfCover)} days`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Dead stock" subtitle={`On hand but not shipped in the last ${days} days — candidates for promotion, return to vendor or write-off`} />
        {d.deadStock.length === 0 ? (
          <EmptyState icon={Moon} title="No dead stock" className="py-8">
            Everything on hand moved in this period.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-hairline border-t border-hairline">
            {d.deadStock.map((p) => (
              <li key={p.id} className="flex items-center gap-4 px-6 py-3.5">
                <div className="min-w-0 flex-1">
                  <Link to={`/products/${p.id}`} className="font-semibold hover:underline">
                    {p.name}
                  </Link>
                  <p className="text-xs text-muted">
                    {fmtQty(p.onHand)} {p.uom} on hand · {p.lastShippedAt ? `last shipped ${fmtShortDate(p.lastShippedAt)}` : "never shipped"}
                  </p>
                </div>
                <span className="font-semibold tabular-nums">{fmtMoney(p.value)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ValuationReport({ warehouseId }: { warehouseId: string }) {
  const [groupBy, setGroupBy] = useState<Valuation["groupBy"]>("product");
  const q = useQuery({
    queryKey: ["valuation", groupBy, warehouseId],
    queryFn: () => api<Valuation>(`/analytics/valuation${qs({ groupBy, warehouseId })}`),
    placeholderData: (prev) => prev,
  });
  const v = q.data;
  const heading = { product: "Product", location: "Location", category: "Category" }[groupBy];

  const exportCsv = () => {
    if (!v) return;
    const header = groupBy === "product" ? ["Product", "SKU", "Quantity", "Unit", "Unit cost", "Value"] : [heading, "Quantity", "Value"];
    const rows = v.items.map((i) =>
      groupBy === "product" ? [i.label, i.sublabel ?? "", i.quantity, i.uom ?? "", i.unitCost ?? "", i.value.toFixed(2)] : [i.label, i.quantity, i.value.toFixed(2)],
    );
    const csv = [header, ...rows, [], ["Total", "", "", "", "", v.total.toFixed(2)]]
      .map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href: url, download: `stock-valuation-by-${groupBy}-${new Date().toISOString().slice(0, 10)}.csv` }).click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={clsx("transition-opacity", q.isFetching && "opacity-60")}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2 print:hidden">
          {(["product", "location", "category"] as const).map((g) => (
            <Chip key={g} active={groupBy === g} onClick={() => setGroupBy(g)}>
              By {g}
            </Chip>
          ))}
        </div>
        <div className="flex gap-2 print:hidden">
          <Button variant="subtle" icon={Printer} onClick={() => window.print()}>
            Print / PDF
          </Button>
          <Button variant="subtle" icon={Download} onClick={exportCsv} disabled={!v?.items.length}>
            Export CSV
          </Button>
        </div>
      </div>
      <Card>
        <div className="flex items-baseline justify-between px-6 pt-5 pb-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Stock valuation by {groupBy}</h2>
            <p className="text-sm text-muted">On-hand quantity × per-unit cost, as of {fmtDate(new Date())}</p>
          </div>
          <p className="text-right">
            <span className="block text-xs text-muted">Total</span>
            <span className="text-[22px] font-semibold">{v ? fmtMoney(v.total) : "…"}</span>
          </p>
        </div>
        {!v ? (
          <div className="space-y-3 p-6">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : (
          <div className="overflow-x-auto border-t border-hairline">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-hairline text-xs text-muted">
                  <th className="py-3 pr-4 pl-6 font-semibold">{heading}</th>
                  <th className="px-4 py-3 text-right font-semibold">Quantity</th>
                  {groupBy === "product" && <th className="px-4 py-3 text-right font-semibold">Unit cost</th>}
                  <th className="px-4 py-3 text-right font-semibold">Value</th>
                  <th className="w-48 py-3 pr-6 pl-4 font-semibold">Share</th>
                </tr>
              </thead>
              <tbody>
                {v.items.map((i) => {
                  const share = v.total ? (i.value / v.total) * 100 : 0;
                  return (
                    <tr key={i.key} className="border-b border-hairline last:border-0">
                      <td className="py-3 pr-4 pl-6">
                        <span className="font-semibold">{i.label}</span>
                        {i.sublabel && <span className="block text-xs text-muted">{i.sublabel}</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {fmtQty(i.quantity)} {i.uom && <span className="text-muted">{i.uom}</span>}
                      </td>
                      {groupBy === "product" && <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(i.unitCost)}</td>}
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{fmtMoney(i.value)}</td>
                      <td className="py-3 pr-6 pl-4">
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 rounded-full bg-canvas">
                            <div className="h-full rounded-full" style={{ width: `${Math.max(share, 0.5)}%`, background: "var(--color-series-1)" }} />
                          </div>
                          <span className="w-10 text-right text-xs text-muted tabular-nums">{share.toFixed(0)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-ink font-semibold">
                  <td className="py-3 pr-4 pl-6">Total</td>
                  <td colSpan={groupBy === "product" ? 2 : 1} />
                  <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(v.total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
