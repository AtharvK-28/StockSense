import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  CircleAlert,
  ClipboardCheck,
  History,
  Inbox,
  LayoutGrid,
  type LucideIcon,
  MapPin,
  PackageCheck,
  Tags,
  Truck,
  Warehouse,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { ActivityFeed } from "../components/ActivityFeed";
import { DocumentTable } from "../components/DocumentTable";
import { Button, Card, CardHeader, CategoryBar, Chip, EmptyState, SelectPill, Skeleton, StockBadge } from "../components/ui";
import { api, qs } from "../lib/api";
import { useAuth } from "../lib/auth";
import { DOC_TYPE_LIST, docPath, fmtDate, fmtQty } from "../lib/format";
import { useAction, useCategories, useLocations, useWarehouses } from "../lib/queries";
import type { Dashboard as DashboardData, DocStatus, DocType, DocumentDetail, DocumentRow } from "../lib/types";

type TypeFilter = "all" | DocType;
type StatusFilter = "open" | DocStatus | "all";

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "open", label: "To do" },
  { key: "draft", label: "Draft" },
  { key: "waiting", label: "Waiting" },
  { key: "ready", label: "Ready" },
  { key: "done", label: "Done" },
  { key: "canceled", label: "Canceled" },
  { key: "all", label: "All" },
];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function Kpi({
  label,
  value,
  sub,
  icon: Icon,
  to,
  alert,
  loading,
}: {
  label: string;
  value: number | undefined;
  sub: React.ReactNode;
  icon: LucideIcon;
  to: string;
  alert?: boolean;
  loading: boolean;
}) {
  return (
    <Link
      to={to}
      className={clsx(
        "group flex flex-col rounded-2xl border bg-white p-5 transition hover:-translate-y-0.5 hover:shadow-lift",
        alert ? "border-brand/30" : "border-hairline",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-muted">{label}</span>
        <span className={clsx("grid size-9 shrink-0 place-items-center rounded-full", alert ? "bg-brand-50 text-brand" : "bg-canvas text-ink")}>
          <Icon className="size-[18px]" strokeWidth={2} />
        </span>
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-9 w-16" />
      ) : (
        <span className={clsx("mt-2 text-[28px] leading-tight font-semibold tracking-tight sm:text-[34px]", alert && "text-brand")}>{value}</span>
      )}
      <span className="mt-1 text-[13px] text-muted">{sub}</span>
    </Link>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const isManager = user?.role === "manager";
  const navigate = useNavigate();
  const [warehouseId, setWarehouseId] = useState("");
  const [locationId, setLocationId] = useState("");
  const locations = useLocations();
  const [categoryId, setCategoryId] = useState("");
  const [type, setType] = useState<TypeFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("open");
  const warehouses = useWarehouses();
  const categories = useCategories();

  const scope = { warehouseId, locationId, categoryId };
  const dashboard = useQuery({
    queryKey: ["dashboard", scope],
    queryFn: () => api<DashboardData>(`/dashboard${qs(scope)}`),
    placeholderData: (prev) => prev,
    refetchInterval: 30_000,
  });
  const statusParam = status === "open" ? "draft,waiting,ready" : status === "all" ? undefined : status;
  const docs = useQuery({
    queryKey: ["documents", { ...scope, type, status }],
    queryFn: () =>
      api<{ items: DocumentRow[] }>(`/documents${qs({ ...scope, type: type === "all" ? undefined : type, status: statusParam, limit: 12 })}`).then(
        (r) => r.items,
      ),
    placeholderData: (prev) => prev,
  });

  const replenish = useAction((productId: string) =>
    api<{ document: DocumentDetail }>(`/products/${productId}/replenish`, { method: "POST", body: {} }),
  );

  const k = dashboard.data?.kpis;
  const loading = !dashboard.data;
  const firstName = user?.name.split(" ")[0] ?? "";

  return (
    <div className="space-y-10">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm text-muted">{fmtDate(new Date())}</p>
          <h1 className="mt-1 text-[28px] font-semibold tracking-tight sm:text-[32px]">
            {greeting()}, {firstName}
          </h1>
          <p className="mt-1 text-[15px] text-muted">Here's what's happening across your inventory right now.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SelectPill
            icon={Warehouse}
            value={warehouseId}
            onChange={(e) => {
              setWarehouseId(e.target.value);
              setLocationId("");
            }}
            aria-label="Filter by warehouse"
          >
            <option value="">All warehouses</option>
            {warehouses.data?.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </SelectPill>
          <SelectPill icon={MapPin} value={locationId} onChange={(e) => setLocationId(e.target.value)} aria-label="Filter by location">
            <option value="">All locations</option>
            {locations.data
              ?.filter((l) => !warehouseId || l.warehouseId === warehouseId)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.warehouse.code} / {l.name}
                </option>
              ))}
          </SelectPill>
          <SelectPill icon={Tags} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Filter by category">
            <option value="">All categories</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectPill>
        </div>
      </div>

      <section className="grid gap-4 lg:grid-cols-2" aria-label="Operations overview">
        <OpsCard
          loading={loading}
          title="Receipt"
          icon={ArrowDownToLine}
          listPath="/operations/receipts"
          cta={k ? `${k.pendingReceipts.ready} to receive` : ""}
          ctaPath="/operations/receipts?status=ready"
          stats={k ? [
            { label: "Late", value: k.pendingReceipts.late, bad: true },
            { label: "operations", value: k.pendingReceipts.total },
          ] : []}
        />
        <OpsCard
          loading={loading}
          title="Delivery"
          icon={Truck}
          listPath="/operations/deliveries"
          cta={k ? `${k.pendingDeliveries.ready} to deliver` : ""}
          ctaPath="/operations/deliveries?status=ready"
          stats={k ? [
            { label: "Late", value: k.pendingDeliveries.late, bad: true },
            { label: "waiting", value: k.pendingDeliveries.waiting, warn: true },
            { label: "operations", value: k.pendingDeliveries.total },
          ] : []}
        />
      </section>

      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3" aria-label="Key metrics">
        <Kpi
          loading={loading}
          label="Products in stock"
          icon={PackageCheck}
          to="/stock"
          value={k?.inStock}
          sub={k ? `of ${k.totalProducts} products · ${fmtQty(k.totalUnits)} units` : "…"}
        />
        <Kpi
          loading={loading}
          label="Low / out of stock"
          icon={CircleAlert}
          to="/products?stock=alert"
          alert={!!k && k.lowStock + k.outOfStock > 0}
          value={k ? k.lowStock + k.outOfStock : undefined}
          sub={k ? `${k.lowStock} low · ${k.outOfStock} out of stock` : "…"}
        />
        <Kpi
          loading={loading}
          label="Internal transfers scheduled"
          icon={ArrowLeftRight}
          to="/operations/transfers"
          value={k?.scheduledTransfers.total}
          sub={k ? <LateSub late={k.scheduledTransfers.late} extra="between locations" /> : "…"}
        />
      </section>

      <div className="grid gap-8 xl:grid-cols-3">
        <section className="min-w-0 xl:col-span-2">
          <div className="mb-4 flex items-end justify-between gap-4">
            <h2 className="text-[22px] font-semibold tracking-tight">Operations</h2>
            <Link to="/moves" className="text-sm font-semibold underline underline-offset-2">
              Move history
            </Link>
          </div>
          <div className="border-b border-hairline">
            <CategoryBar
              value={type}
              onChange={setType}
              items={[{ key: "all" as TypeFilter, label: "All", icon: LayoutGrid }, ...DOC_TYPE_LIST.map((m) => ({ key: m.type as TypeFilter, label: m.plural, icon: m.icon }))]}
            />
          </div>
          <div className="scrollbar-none -mx-1 my-4 flex gap-2 overflow-x-auto px-1 py-0.5">
            {STATUS_FILTERS.map((s) => (
              <Chip key={s.key} active={status === s.key} onClick={() => setStatus(s.key)}>
                {s.label}
              </Chip>
            ))}
          </div>
          <Card>
            {!docs.data ? (
              <div className="space-y-3 p-6">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            ) : docs.data.length === 0 ? (
              <EmptyState icon={Inbox} title="Nothing here" action={<Button onClick={() => navigate("/operations/receipts/new")}>New receipt</Button>}>
                No operations match these filters. Create a receipt to bring stock in.
              </EmptyState>
            ) : (
              <DocumentTable docs={docs.data} showType={type === "all"} compact />
            )}
          </Card>
        </section>

        <aside className="min-w-0 space-y-8">
          {dashboard.data && dashboard.data.awaitingApproval.length > 0 && (
            <Card className={isManager ? "border-brand/30" : undefined}>
              <CardHeader
                title={isManager ? "Awaiting your approval" : "Waiting for a manager"}
                subtitle={isManager ? "Stock counts submitted by warehouse staff" : "Counts submitted for approval"}
              />
              <ul className="divide-y divide-hairline border-t border-hairline">
                {dashboard.data.awaitingApproval.map((d) => (
                  <li key={d.id}>
                    <Link to={docPath(d)} className="flex items-center gap-3 px-6 py-3.5 transition hover:bg-canvas/70">
                      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-50 text-brand">
                        <ClipboardCheck className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{d.reference} · {d.submittedBy}</span>
                        <span className="block truncate text-xs text-muted">
                          {d.summary}
                          {d.location && ` · ${d.location}`}
                        </span>
                      </span>
                      <span className="text-sm font-semibold whitespace-nowrap underline underline-offset-2">{isManager ? "Review" : "View"}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <CardHeader
              title="Low stock alerts"
              subtitle="Products at or below their reorder point"
              action={
                <Link to="/products/reordering" className="text-sm font-semibold whitespace-nowrap underline underline-offset-2">
                  Rules
                </Link>
              }
            />
            {!dashboard.data ? (
              <div className="space-y-3 px-6 pb-6">
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
              </div>
            ) : dashboard.data.alerts.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-muted">Everything is above its reorder point. Nice.</p>
            ) : (
              <ul className="divide-y divide-hairline border-t border-hairline">
                {dashboard.data.alerts.map((a) => {
                  const target = a.minQty ?? 0;
                  const pct = target > 0 ? Math.min(100, (a.onHand / target) * 100) : 0;
                  return (
                    <li key={a.id} className="flex items-center gap-4 px-6 py-4">
                      <Link to={`/products/${a.id}`} className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold hover:underline">{a.name}</span>
                        </span>
                        <span className="mt-0.5 block text-xs text-muted">
                          {fmtQty(a.onHand)} {a.uom} on hand{a.minQty != null && ` · min ${fmtQty(a.minQty)}`}
                        </span>
                        <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-canvas">
                          <span className={clsx("block h-full rounded-full", a.status === "out" ? "bg-bad" : "bg-warn")} style={{ width: `${Math.max(pct, 3)}%` }} />
                        </span>
                      </Link>
                      <div className="flex flex-col items-end gap-2">
                        <StockBadge status={a.status} />
                        {isManager && (
                        <Button
                          size="sm"
                          variant="subtle"
                          loading={replenish.isPending && replenish.variables === a.id}
                          onClick={() => replenish.mutate(a.id, { onSuccess: ({ document }) => navigate(docPath(document)) })}
                        >
                          Reorder{a.suggestedQty ? ` ${fmtQty(a.suggestedQty)}` : ""}
                        </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Recent activity"
              subtitle="Latest entries in the stock ledger"
              action={
                <Link to="/moves" className="text-sm font-semibold underline underline-offset-2">
                  All
                </Link>
              }
            />
            {!dashboard.data ? (
              <div className="space-y-3 px-6 pb-6">
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
              </div>
            ) : dashboard.data.recentMoves.length === 0 ? (
              <EmptyState icon={History} title="No stock moves yet" className="py-8">
                Validate a receipt and it will show up here.
              </EmptyState>
            ) : (
              <div className="border-t border-hairline">
                <ActivityFeed moves={dashboard.data.recentMoves} />
              </div>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}

/** The mockup's big Receipt / Delivery cards: a "N to process" button plus late / waiting counts. */
function OpsCard({
  title,
  icon: Icon,
  listPath,
  cta,
  ctaPath,
  stats,
  loading,
}: {
  title: string;
  icon: LucideIcon;
  listPath: string;
  cta: string;
  ctaPath: string;
  stats: { label: string; value: number; bad?: boolean; warn?: boolean }[];
  loading: boolean;
}) {
  return (
    <Card className="p-6 transition hover:shadow-lift">
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-full bg-brand-50 text-brand">
          <Icon className="size-5" strokeWidth={2} />
        </span>
        <h2 className="text-[22px] font-semibold tracking-tight">{title}</h2>
        <Link to={listPath} className="ml-auto text-sm font-semibold underline underline-offset-2">
          View all
        </Link>
      </div>
      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        {loading ? (
          <Skeleton className="h-12 w-44 rounded-lg" />
        ) : (
          <Link to={ctaPath}>
            <Button variant="dark" size="lg">
              {cta}
            </Button>
          </Link>
        )}
        <ul className="space-y-1 text-right text-[15px]">
          {loading
            ? [0, 1].map((i) => <Skeleton key={i} className="ml-auto h-4 w-24" />)
            : stats.map((st) => (
                <li key={st.label} className={clsx(st.value > 0 && st.bad && "font-semibold text-bad", st.value > 0 && st.warn && "font-semibold text-warn")}>
                  <span className="font-semibold">{st.value}</span> {st.label}
                </li>
              ))}
        </ul>
      </div>
    </Card>
  );
}

function LateSub({ late, extra }: { late: number; extra: string }) {
  return (
    <>
      {late > 0 && <span className="font-semibold text-bad">{late} late · </span>}
      {extra}
    </>
  );
}
