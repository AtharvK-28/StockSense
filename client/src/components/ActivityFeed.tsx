import { clsx } from "clsx";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Link } from "react-router";
import { MOVE_LABEL, docPath, fmtRelative, fmtSigned } from "../lib/format";
import type { LedgerEntry } from "../lib/types";

export function ActivityFeed({ moves, showProduct = true }: { moves: LedgerEntry[]; showProduct?: boolean }) {
  return (
    <ul className="divide-y divide-hairline">
      {moves.map((m) => {
        const incoming = m.quantityDelta > 0;
        return (
          <li key={m.id}>
            <Link to={docPath(m.document)} className="flex items-center gap-3 px-6 py-3.5 transition hover:bg-canvas/70">
              <span className={clsx("grid size-9 shrink-0 place-items-center rounded-full", incoming ? "bg-ok-50 text-ok" : "bg-bad-50 text-bad")}>
                {incoming ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {showProduct ? m.product.name : MOVE_LABEL[m.operationType]}
                </span>
                <span className="block truncate text-xs text-muted">
                  {m.document.reference} · {m.location.warehouse.code} / {m.location.name} · {fmtRelative(m.createdAt)}
                </span>
              </span>
              <span className={clsx("text-sm font-semibold whitespace-nowrap", incoming ? "text-ok" : "text-bad")}>
                {fmtSigned(m.quantityDelta)} <span className="font-normal text-muted">{m.product.uom}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
