import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Lock, ScrollText, Search } from "lucide-react";
import { useState } from "react";
import { ExportMenu } from "../../components/ExportMenu";
import { Card, Chip, EmptyState, IconButton, PageHeader, Skeleton } from "../../components/ui";
import { api, qs } from "../../lib/api";
import { useIsManager } from "../../lib/auth";
import { fmtDateTime } from "../../lib/format";
import { useDebounced } from "../../lib/queries";

interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  createdAt: string;
  user: { id: string; name: string; loginId: string } | null;
}

const TYPES = [
  { key: "", label: "Everything" },
  { key: "document", label: "Operations" },
  { key: "product", label: "Products" },
  { key: "category", label: "Categories" },
  { key: "warehouse", label: "Warehouses" },
  { key: "location", label: "Locations" },
  { key: "user", label: "Team" },
  { key: "settings", label: "Settings" },
];
const PAGE_SIZE = 50;
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

export function AuditLog() {
  const isManager = useIsManager();
  const [entityType, setEntityType] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const search = useDebounced(q.trim());
  const log = useQuery({
    queryKey: ["audit", entityType, search, page],
    queryFn: () => api<{ items: AuditEntry[]; total: number }>(`/audit${qs({ entityType, q: search, page, pageSize: PAGE_SIZE })}`),
    enabled: isManager,
    placeholderData: (prev) => prev,
  });

  if (!isManager) return <EmptyState icon={Lock} title="Only inventory managers can see the audit log" />;
  const total = log.data?.total ?? 0;

  return (
    <div>
      <PageHeader
        eyebrow="Settings"
        title="Audit log"
        subtitle="Who changed what outside the stock ledger — catalog, costs, rules, warehouses, roles, settings and document lifecycle. Stock movements themselves are in Move history."
        actions={<ExportMenu dataset="audit" />}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full border border-line bg-white px-4 transition focus-within:border-ink focus-within:ring-1 focus-within:ring-ink sm:max-w-sm">
          <Search className="size-4 shrink-0 text-muted" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Search, e.g. a SKU or reference"
            aria-label="Search the audit log"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
          />
        </label>
      </div>
      <div className="scrollbar-none -mx-1 mb-6 flex gap-2 overflow-x-auto px-1 py-0.5">
        {TYPES.map((t) => (
          <Chip
            key={t.key}
            active={entityType === t.key}
            onClick={() => {
              setEntityType(t.key);
              setPage(1);
            }}
          >
            {t.label}
          </Chip>
        ))}
      </div>
      <Card>
        {!log.data ? (
          <div className="space-y-3 p-6">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : log.data.items.length === 0 ? (
          <EmptyState icon={ScrollText} title="Nothing recorded yet">
            Changes to products, settings and operations will appear here.
          </EmptyState>
        ) : (
          <>
            <ul className="divide-y divide-hairline">
              {log.data.items.map((e) => (
                <li key={e.id} className="flex flex-col gap-1 px-6 py-4 sm:flex-row sm:items-start sm:gap-6">
                  <span className="w-40 shrink-0 text-sm text-muted">{fmtDateTime(e.createdAt)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px]">
                      <span className="font-semibold">{e.user?.name ?? "StockSense"}</span> · {e.summary}
                    </p>
                    {e.changes && Object.keys(e.changes).length > 0 && (
                      <ul className="mt-2 space-y-1 rounded-xl bg-canvas px-4 py-2.5 text-sm">
                        {Object.entries(e.changes).map(([field, c]) => (
                          <li key={field}>
                            <span className="text-muted">{field}</span>: <span className="line-through decoration-bad/60">{show(c.from)}</span> →{" "}
                            <span className="font-semibold">{show(c.to)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <span className="shrink-0 rounded-full bg-canvas px-2.5 py-1 font-mono text-[11px] text-muted">{e.action}</span>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-hairline px-6 py-3 text-sm text-muted">
              <span>
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
              </span>
              <div className="flex gap-1">
                <IconButton icon={ChevronLeft} label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} />
                <IconButton icon={ChevronRight} label="Next page" disabled={page * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)} />
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
