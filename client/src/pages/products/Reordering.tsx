import { Pencil, RefreshCcw } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button, Card, Chip, EmptyState, ErrorNote, Field, IconButton, Input, Modal, PageHeader, Skeleton, StockBadge } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { useIsManager } from "../../lib/auth";
import { docPath, fmtQty } from "../../lib/format";
import { useAction, useProducts } from "../../lib/queries";
import type { DocumentDetail, ProductRow } from "../../lib/types";

type View = "rules" | "attention" | "all";

export function Reordering() {
  const [view, setView] = useState<View>("rules");
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const navigate = useNavigate();
  const isManager = useIsManager();
  const products = useProducts(view === "rules" ? { withRules: "true" } : view === "attention" ? { stock: "alert" } : {});
  const replenish = useAction((id: string) => api<{ document: DocumentDetail }>(`/products/${id}/replenish`, { method: "POST", body: {} }), {
    success: "Draft receipt created",
  });

  return (
    <div>
      <PageHeader
        title="Reordering rules"
        subtitle="Set a minimum per product. When total stock drops to it, StockSense raises a low-stock alert and suggests a receipt back up to the maximum."
      />
      <div className="scrollbar-none -mx-1 mb-6 flex gap-2 overflow-x-auto px-1 py-0.5">
        <Chip active={view === "rules"} onClick={() => setView("rules")}>
          With rules
        </Chip>
        <Chip active={view === "attention"} onClick={() => setView("attention")}>
          Needs reorder
        </Chip>
        <Chip active={view === "all"} onClick={() => setView("all")}>
          All products
        </Chip>
      </div>

      <Card>
        {!products.data ? (
          <div className="space-y-3 p-6">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : products.data.length === 0 ? (
          <EmptyState icon={RefreshCcw} title={view === "attention" ? "Nothing needs reordering" : "No rules yet"}>
            {view === "attention" ? "All products are above their reorder point." : "Open “All products” and set a min quantity on anything you want to watch."}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead>
                <tr className="border-b border-hairline text-xs text-muted">
                  <th className="py-3 pr-4 pl-6 font-semibold">Product</th>
                  <th className="px-4 py-3 text-right font-semibold">On hand</th>
                  <th className="px-4 py-3 text-right font-semibold">Min</th>
                  <th className="px-4 py-3 text-right font-semibold">Max</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="py-3 pr-6 pl-4 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {products.data.map((p) => (
                  <tr key={p.id} className="border-b border-hairline last:border-0">
                    <td className="py-3.5 pr-4 pl-6">
                      <Link to={`/products/${p.id}`} className="font-semibold hover:underline">
                        {p.name}
                      </Link>
                      <div className="font-mono text-xs text-muted">{p.sku}</div>
                    </td>
                    <td className="px-4 py-3.5 text-right font-semibold whitespace-nowrap">
                      {fmtQty(p.onHand)} <span className="font-normal text-muted">{p.uom}</span>
                    </td>
                    <td className="px-4 py-3.5 text-right">{fmtQty(p.minQty)}</td>
                    <td className="px-4 py-3.5 text-right">{fmtQty(p.maxQty)}</td>
                    <td className="px-4 py-3.5">
                      <StockBadge status={p.status} />
                    </td>
                    <td className="py-3.5 pr-6 pl-4">
                      <div className="flex items-center justify-end gap-1">
                        {isManager && <IconButton icon={Pencil} label={`Edit rule for ${p.name}`} onClick={() => setEditing(p)} />}
                        {isManager && p.suggestedQty != null && p.status !== "in" && (
                          <Button
                            size="sm"
                            variant="subtle"
                            loading={replenish.isPending && replenish.variables === p.id}
                            onClick={() => replenish.mutate(p.id, { onSuccess: ({ document }) => navigate(docPath(document)) })}
                          >
                            Reorder {fmtQty(p.suggestedQty)}
                          </Button>
                        )}
                        {!isManager && p.status !== "in" && <span className="text-xs text-muted">Manager reorders</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && <RuleModal product={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function RuleModal({ product, onClose }: { product: ProductRow; onClose: () => void }) {
  const [min, setMin] = useState(product.minQty?.toString() ?? "");
  const [max, setMax] = useState(product.maxQty?.toString() ?? "");
  const toNum = (s: string) => (s.trim() === "" ? null : Number(s));
  const save = useAction(() => api(`/products/${product.id}/rule`, { method: "PUT", body: { minQty: toNum(min), maxQty: toNum(max) } }), {
    success: "Reordering rule saved",
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Reordering rule"
      footer={
        <>
          <Button variant="ghost" onClick={() => { setMin(""); setMax(""); }}>
            Clear rule
          </Button>
          <Button type="submit" form="rule-form" loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <p className="mb-5 text-[15px]">
        <span className="font-semibold">{product.name}</span> <span className="text-muted">· {fmtQty(product.onHand)} {product.uom} on hand</span>
      </p>
      <form
        id="rule-form"
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined, { onSuccess: onClose });
        }}
      >
        <Field label="Reorder at (min)" hint="Alert at or below this">
          <Input type="number" min={0} step="any" value={min} onChange={(e) => setMin(e.target.value)} placeholder="None" autoFocus />
        </Field>
        <Field label="Replenish up to (max)" hint="Target after reordering">
          <Input type="number" min={0} step="any" value={max} onChange={(e) => setMax(e.target.value)} placeholder="None" />
        </Field>
        {save.isError && <div className="sm:col-span-2"><ErrorNote>{errorMessage(save.error)}</ErrorNote></div>}
      </form>
    </Modal>
  );
}
