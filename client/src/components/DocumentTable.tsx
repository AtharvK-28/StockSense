import { clsx } from "clsx";
import { ArrowRight } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { DOC_TYPES, docPath, fmtQty, fmtShortDate, isLate } from "../lib/format";
import type { DocumentRow } from "../lib/types";
import { StatusBadge } from "./ui";

export function docRoute(d: Pick<DocumentRow, "type" | "partnerName" | "sourceLocation" | "destinationLocation">) {
  const loc = (l: DocumentRow["sourceLocation"]) => (l ? `${l.warehouse.code} / ${l.name}` : "—");
  switch (d.type) {
    case "receipt":
      return { from: d.partnerName ?? "No supplier yet", to: loc(d.destinationLocation) };
    case "delivery":
      return { from: loc(d.sourceLocation), to: d.partnerName ?? "No customer yet" };
    case "transfer":
      return { from: loc(d.sourceLocation), to: loc(d.destinationLocation) };
    case "adjustment":
      return { from: loc(d.sourceLocation), to: null };
  }
}

/** `compact` folds the products column into the route cell, for narrow layouts like the dashboard. */
export function DocumentTable({ docs, showType, compact }: { docs: DocumentRow[]; showType?: boolean; compact?: boolean }) {
  const navigate = useNavigate();
  return (
    <div className="overflow-x-auto">
      <table className={clsx("w-full text-left text-sm", compact ? "min-w-[600px]" : "min-w-[760px]")}>
        <thead>
          <tr className="border-b border-hairline text-xs text-muted">
            <th className="py-3 pr-4 pl-6 font-semibold">Reference</th>
            <th className="px-4 py-3 font-semibold">From → To</th>
            {!compact && <th className="px-4 py-3 font-semibold">Products</th>}
            <th className="px-4 py-3 font-semibold">Scheduled</th>
            <th className="py-3 pr-6 pl-4 text-right font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => {
            const meta = DOC_TYPES[d.type];
            const route = docRoute(d);
            const late = isLate(d);
            return (
              <tr
                key={d.id}
                onClick={() => navigate(docPath(d))}
                className="cursor-pointer border-b border-hairline transition last:border-0 hover:bg-canvas/70"
              >
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
                <td className="px-4 py-4">
                  <div className="flex items-center gap-2 text-ink">
                    <span className="max-w-[180px] truncate">{route.from}</span>
                    {route.to && (
                      <>
                        <ArrowRight className="size-3.5 shrink-0 text-subtle" />
                        <span className="max-w-[180px] truncate">{route.to}</span>
                      </>
                    )}
                  </div>
                  {compact && (
                    <div className="mt-0.5 text-xs text-muted">
                      <ProductSummary doc={d} inline />
                    </div>
                  )}
                </td>
                {!compact && (
                  <td className="px-4 py-4 text-muted">
                    <ProductSummary doc={d} />
                  </td>
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
