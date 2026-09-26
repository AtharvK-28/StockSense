import { clsx } from "clsx";
import { ArrowRight, CalendarDays } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { DOC_TYPES, STATUS_LABEL, docPath, fmtQty, fmtShortDate, isLate } from "../lib/format";
import type { DocStatus, DocType, DocumentRow } from "../lib/types";
import { StatusBadge } from "./ui";

/** From / To in the mockup's terms: vendors and customers are virtual locations. */
export function docRoute(d: Pick<DocumentRow, "type" | "sourceLocation" | "destinationLocation">) {
  const loc = (l: DocumentRow["sourceLocation"]) => (l ? `${l.warehouse.code}/${l.name}` : "—");
  switch (d.type) {
    case "receipt":
      return { from: "Vendor", to: loc(d.destinationLocation) };
    case "delivery":
      return { from: loc(d.sourceLocation), to: "Customer" };
    case "transfer":
      return { from: loc(d.sourceLocation), to: loc(d.destinationLocation) };
    case "adjustment":
      return { from: loc(d.sourceLocation), to: "Inventory adjustment" };
  }
}

/** `compact` merges columns for narrow layouts like the dashboard. */
export function DocumentTable({ docs, showType, compact }: { docs: DocumentRow[]; showType?: boolean; compact?: boolean }) {
  const navigate = useNavigate();
  return (
    <div className="overflow-x-auto">
      <table className={clsx("w-full text-left text-sm", compact ? "min-w-[600px]" : "min-w-[900px]")}>
        <thead>
          <tr className="border-b border-hairline text-xs text-muted">
            <th className="py-3 pr-4 pl-6 font-semibold">Reference</th>
            {compact ? (
              <th className="px-4 py-3 font-semibold">From → To</th>
            ) : (
              <>
                <th className="px-4 py-3 font-semibold">From</th>
                <th className="px-4 py-3 font-semibold">To</th>
                <th className="px-4 py-3 font-semibold">Contact</th>
                <th className="px-4 py-3 font-semibold">Products</th>
              </>
            )}
            <th className="px-4 py-3 font-semibold">Schedule date</th>
            <th className="py-3 pr-6 pl-4 text-right font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => {
            const meta = DOC_TYPES[d.type];
            const route = docRoute(d);
            const late = isLate(d);
            return (
              <tr key={d.id} onClick={() => navigate(docPath(d))} className="cursor-pointer border-b border-hairline transition last:border-0 hover:bg-canvas/70">
                <td className="py-4 pr-4 pl-6">
                  <div className="flex items-center gap-3">
                    {showType && (
                      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-canvas" title={meta.label}>
                        <meta.icon className="size-4" />
                      </span>
                    )}
                    <div>
                      <Link to={docPath(d)} onClick={(e) => e.stopPropagation()} className="font-semibold whitespace-nowrap hover:underline">
                        {d.reference}
                      </Link>
                      {d.origin && <div className="text-xs text-muted">{d.origin}</div>}
                    </div>
                  </div>
                </td>
                {compact ? (
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2 text-ink">
                      <span className="max-w-[160px] truncate">{d.type === "receipt" ? (d.partnerName ?? route.from) : route.from}</span>
                      <ArrowRight className="size-3.5 shrink-0 text-subtle" />
                      <span className="max-w-[160px] truncate">{d.type === "delivery" ? (d.partnerName ?? route.to) : route.to}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted">
                      <ProductSummary doc={d} inline />
                    </div>
                  </td>
                ) : (
                  <>
                    <td className="px-4 py-4 whitespace-nowrap">{route.from}</td>
                    <td className="px-4 py-4 whitespace-nowrap">{route.to}</td>
                    <td className="px-4 py-4">
                      <span className="block max-w-[180px] truncate">{d.partnerName ?? <span className="text-muted">—</span>}</span>
                    </td>
                    <td className="px-4 py-4 text-muted">
                      <ProductSummary doc={d} />
                    </td>
                  </>
                )}
                <td className="px-4 py-4 whitespace-nowrap">
                  <span className={clsx(late && "font-semibold text-bad")}>{fmtShortDate(d.scheduledDate)}</span>
                  {late && <div className="text-xs font-semibold text-bad">Late</div>}
                </td>
                <td className="py-4 pr-6 pl-4 text-right">
                  <StatusBadge status={d.status} />
                  {d.type === "delivery" && d.status === "ready" && (d.pickedAt || d.packedAt) && (
                    <div className="mt-1 text-xs text-muted">{d.packedAt ? "Packed" : "Picked"}</div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ProductSummary({ doc: d, inline }: { doc: DocumentRow; inline?: boolean }) {
  const qty = `${fmtQty(d.totalQuantity)} ${d.lineCount === 1 ? (d.products[0]?.uom ?? "") : "units total"}${d.type === "adjustment" ? " counted" : ""}`;
  const more = d.lineCount > 1 ? ` +${d.lineCount - 1} more` : "";
  if (inline) return <>{`${d.products[0]?.name ?? "—"}${more} · ${qty}`}</>;
  return (
    <>
      <span className="text-ink">{d.products[0]?.name ?? "—"}</span>
      {more}
      <div className="text-xs">{qty}</div>
    </>
  );
}

const KANBAN_COLUMNS: Record<DocType, DocStatus[]> = {
  receipt: ["draft", "ready", "done", "canceled"],
  delivery: ["draft", "waiting", "ready", "done", "canceled"],
  transfer: ["draft", "waiting", "ready", "done", "canceled"],
  adjustment: ["draft", "ready", "done", "canceled"],
};

const COLUMN_ACCENT: Record<DocStatus, string> = {
  draft: "bg-subtle",
  waiting: "bg-warn",
  ready: "bg-info",
  done: "bg-ok",
  canceled: "bg-bad",
};

/** Kanban view of documents, one column per status. */
export function DocumentKanban({ docs, type }: { docs: DocumentRow[]; type: DocType }) {
  return (
    <div className="scrollbar-none -mx-4 flex gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
      {KANBAN_COLUMNS[type].map((status) => {
        const items = docs.filter((d) => d.status === status);
        return (
          <section key={status} className="flex w-72 shrink-0 flex-col rounded-2xl bg-canvas p-3" aria-label={STATUS_LABEL[status]}>
            <header className="flex items-center gap-2 px-2 pt-1 pb-3">
              <span className={clsx("size-2 rounded-full", COLUMN_ACCENT[status])} />
              <h3 className="text-sm font-semibold">{STATUS_LABEL[status]}</h3>
              <span className="ml-auto rounded-full bg-white px-2 text-xs font-semibold text-muted">{items.length}</span>
            </header>
            <div className="flex flex-col gap-3">
              {items.length === 0 && <p className="px-2 pb-2 text-xs text-muted">Nothing here</p>}
              {items.map((d) => {
                const route = docRoute(d);
                const late = isLate(d);
                return (
                  <Link key={d.id} to={docPath(d)} className="rounded-xl border border-hairline bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-lift">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-semibold">{d.reference}</span>
                      {late && <span className="text-xs font-semibold text-bad">Late</span>}
                    </div>
                    <p className="mt-1 truncate text-sm">{d.partnerName ?? `${route.from} → ${route.to}`}</p>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      <ProductSummary doc={d} inline />
                    </p>
                    <p className={clsx("mt-3 flex items-center gap-1.5 text-xs", late ? "font-semibold text-bad" : "text-muted")}>
                      <CalendarDays className="size-3.5" />
                      {fmtShortDate(d.scheduledDate)}
                      {d.type === "delivery" && d.status === "ready" && (d.packedAt || d.pickedAt) && (
                        <span className="ml-auto font-medium text-muted">{d.packedAt ? "Packed" : "Picked"}</span>
                      )}
                    </p>
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

/** List / Kanban switch shown next to search, as in the mockups. */
export function ViewToggle<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { key: T; label: string; icon: React.ComponentType<{ className?: string }> }[];
}) {
  return (
    <div className="flex rounded-full border border-line bg-white p-0.5" role="group" aria-label="View">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={value === o.key}
          title={`${o.label} view`}
          className={clsx(
            "flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition",
            value === o.key ? "bg-ink text-white" : "text-ink hover:bg-canvas",
          )}
        >
          <o.icon className="size-4" />
          <span className="hidden sm:inline">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
