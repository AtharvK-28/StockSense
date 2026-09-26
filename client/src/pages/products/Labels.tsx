import { Minus, Plus, Printer, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Barcode } from "../../components/Barcode";
import { Button, Card, IconButton, PageHeader, Skeleton } from "../../components/ui";
import { useProducts } from "../../lib/queries";

/** Pick products and print Code 128 shelf/bin labels (A4, 3 columns). */
export function Labels() {
  const [params] = useSearchParams();
  const products = useProducts({});
  const [q, setQ] = useState("");
  const [copies, setCopies] = useState<Record<string, number>>(() =>
    Object.fromEntries((params.get("ids") ?? "").split(",").filter(Boolean).map((id) => [id, 1])),
  );
  const setCount = (id: string, n: number) => setCopies((c) => ({ ...c, [id]: Math.max(0, Math.min(n, 99)) }));

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (products.data ?? []).filter((p) => !term || p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term));
  }, [products.data, q]);
  const labels = (products.data ?? []).flatMap((p) => Array.from({ length: copies[p.id] ?? 0 }, (_, i) => ({ ...p, n: i })));

  return (
    <div>
      <div className="print:hidden">
        <PageHeader
          eyebrow="Products"
          title="Print labels"
          subtitle="Code 128 barcodes of each SKU — stick them on shelves, bins or cartons and scan them in any operation."
          actions={
            <Button variant="primary" icon={Printer} disabled={!labels.length} onClick={() => window.print()}>
              Print {labels.length || ""} label{labels.length === 1 ? "" : "s"}
            </Button>
          }
        />
        <div className="grid gap-8 lg:grid-cols-[380px_1fr]">
          <Card className="self-start">
            <div className="p-4">
              <label className="flex h-10 items-center gap-2 rounded-full border border-line px-4 focus-within:border-ink focus-within:ring-1 focus-within:ring-ink">
                <Search className="size-4 text-muted" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a product" aria-label="Find a product" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
              </label>
            </div>
            {!products.data ? (
              <div className="space-y-2 p-4">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
            ) : (
              <ul className="max-h-[560px] divide-y divide-hairline overflow-y-auto border-t border-hairline">
                {list.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{p.name}</p>
                      <p className="font-mono text-xs text-muted">{p.sku}</p>
                    </div>
                    <IconButton icon={Minus} label={`Fewer ${p.name} labels`} disabled={!copies[p.id]} onClick={() => setCount(p.id, (copies[p.id] ?? 0) - 1)} className="size-8" />
                    <span className="w-6 text-center text-sm font-semibold tabular-nums">{copies[p.id] ?? 0}</span>
                    <IconButton icon={Plus} label={`More ${p.name} labels`} onClick={() => setCount(p.id, (copies[p.id] ?? 0) + 1)} className="size-8" />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <div>
            <p className="mb-3 text-sm font-semibold text-muted">Preview</p>
            {labels.length === 0 ? (
              <Card className="grid h-60 place-items-center text-sm text-muted">Add products on the left to preview their labels.</Card>
            ) : (
              <LabelSheet labels={labels} />
            )}
          </div>
        </div>
      </div>
      <div className="hidden print:block">
        <LabelSheet labels={labels} />
      </div>
    </div>
  );
}

function LabelSheet({ labels }: { labels: { id: string; n: number; name: string; sku: string; uom: string; category: { name: string } | null }[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 print:grid-cols-3 print:gap-2">
      {labels.map((l) => (
        <div key={`${l.id}-${l.n}`} className="flex break-inside-avoid flex-col items-center rounded-lg border border-dashed border-line bg-white p-3 text-center text-black">
          <p className="w-full truncate text-sm font-semibold">{l.name}</p>
          <p className="mb-1 text-[11px]">
            {l.category?.name ?? "Uncategorised"} · {l.uom}
          </p>
          <Barcode value={l.sku} height={44} module={1.5} />
        </div>
      ))}
    </div>
  );
}
