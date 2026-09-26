import { useQuery } from "@tanstack/react-query";
import { Inbox, Plus, Search, Warehouse } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { DocumentTable } from "../../components/DocumentTable";
import { Button, Card, Chip, EmptyState, PageHeader, SelectPill, Skeleton } from "../../components/ui";
import { api, qs } from "../../lib/api";
import { STATUS_LABEL, docTypeBySlug, isOpen } from "../../lib/format";
import { useDebounced, useWarehouses } from "../../lib/queries";
import type { DocStatus, DocumentRow } from "../../lib/types";

type StatusFilter = "open" | DocStatus | "all";
const STATUSES: DocStatus[] = ["draft", "waiting", "ready", "done", "canceled"];

export function DocumentList() {
  const { kind } = useParams();
  const meta = docTypeBySlug(kind);
  const [status, setStatus] = useState<StatusFilter>("open");
  const [warehouseId, setWarehouseId] = useState("");
  const [q, setQ] = useState("");
  const search = useDebounced(q.trim());
  const warehouses = useWarehouses();

  const docs = useQuery({
    queryKey: ["documents", { type: meta?.type, warehouseId, q: search }],
    queryFn: () => api<{ items: DocumentRow[] }>(`/documents${qs({ type: meta!.type, warehouseId, q: search, limit: 500 })}`).then((r) => r.items),
    enabled: !!meta,
    placeholderData: (prev) => prev,
  });

  const counts = useMemo(() => {
    const c: Record<string, number> = { open: 0, all: docs.data?.length ?? 0 };
    for (const d of docs.data ?? []) {
      c[d.status] = (c[d.status] ?? 0) + 1;
      if (isOpen(d.status)) c.open!++;
    }
    return c;
  }, [docs.data]);

  if (!meta) {
    return <EmptyState icon={Inbox} title="Unknown operation type" />;
  }

  const visible = (docs.data ?? []).filter((d) => (status === "all" ? true : status === "open" ? isOpen(d.status) : d.status === status));

  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title={meta.plural}
        subtitle={meta.blurb}
        actions={
          <Link to={`/operations/${meta.slug}/new`}>
            <Button variant="primary" icon={Plus}>
              New {meta.label.toLowerCase()}
            </Button>
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full border border-line bg-white px-4 transition focus-within:border-ink focus-within:ring-1 focus-within:ring-ink sm:max-w-sm">
          <Search className="size-4 shrink-0 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Reference, ${meta.partnerLabel?.toLowerCase() ?? "product"} or SKU`}
            aria-label="Search"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
          />
        </label>
        <SelectPill icon={Warehouse} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} aria-label="Warehouse">
          <option value="">All warehouses</option>
          {warehouses.data?.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </SelectPill>
      </div>
      <div className="scrollbar-none -mx-1 mb-6 flex gap-2 overflow-x-auto px-1 py-0.5">
        <Chip active={status === "open"} onClick={() => setStatus("open")} count={counts.open}>
          To do
        </Chip>
        {STATUSES.map((s) => (
          <Chip key={s} active={status === s} onClick={() => setStatus(s)} count={counts[s] ?? 0}>
            {STATUS_LABEL[s]}
          </Chip>
        ))}
        <Chip active={status === "all"} onClick={() => setStatus("all")} count={counts.all}>
          All
        </Chip>
      </div>

      <Card>
        {!docs.data ? (
          <div className="space-y-3 p-6">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={meta.icon}
            title={`No ${meta.plural.toLowerCase()} here`}
            action={
              <Link to={`/operations/${meta.slug}/new`}>
                <Button variant="primary" icon={Plus}>
                  New {meta.label.toLowerCase()}
                </Button>
              </Link>
            }
          >
            {search ? "Nothing matches your search." : "Try another status, or create a new one."}
          </EmptyState>
        ) : (
          <DocumentTable docs={visible} />
        )}
      </Card>
    </div>
  );
}
