import { clsx } from "clsx";
import { ArrowRight, Check, ChevronDown, Pencil, Plus, Tags, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { ExportMenu } from "../../components/ExportMenu";
import { ProductImage } from "../../components/ProductImage";
import { Button, Card, EmptyState, IconButton, Input, PageHeader, Skeleton, StockBadge } from "../../components/ui";
import { api } from "../../lib/api";
import { useIsManager } from "../../lib/auth";
import { fmtQty } from "../../lib/format";
import { useAction, useCategories, useProducts } from "../../lib/queries";
import type { ProductRow } from "../../lib/types";
import { categoryVisual } from "../../lib/visual";

/** The products inside one category, shown when its row is expanded. */
function CategoryProducts({ id, products, categoryId }: { id: string; products: ProductRow[] | undefined; categoryId: string | null }) {
  return (
    <div id={id} className="border-t border-hairline bg-canvas/50 px-4 py-3 sm:px-6">
      {!products ? (
        <Skeleton className="h-12" />
      ) : products.length === 0 ? (
        <p className="px-2 py-3 text-sm text-muted">No products in this category yet.</p>
      ) : (
        <ul className="space-y-1">
          {products.map((p) => (
            <li key={p.id}>
              <Link to={`/products/${p.id}`} className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-white">
                <ProductImage product={p} className="size-10 rounded-lg" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{p.name}</span>
                  <span className="block truncate font-mono text-xs text-muted">{p.sku}</span>
                </span>
                <span className="hidden text-sm whitespace-nowrap sm:block">
                  <span className="font-semibold">{fmtQty(p.onHand)}</span> <span className="text-muted">{p.uom}</span>
                </span>
                <StockBadge status={p.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {categoryId && products && products.length > 0 && (
        <Link to={`/products?categoryId=${categoryId}`} className="mt-2 inline-flex items-center gap-1.5 px-2 py-1 text-sm font-semibold underline-offset-2 hover:underline">
          Open in products <ArrowRight className="size-3.5" />
        </Link>
      )}
    </div>
  );
}

export function Categories() {
  const categories = useCategories();
  const isManager = useIsManager();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const products = useProducts();
  const byCategory = useMemo(() => {
    const map = new Map<string, ProductRow[]>();
    for (const p of products.data ?? []) {
      const key = p.category?.id ?? "";
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    return map;
  }, [products.data]);
  const uncategorised = byCategory.get("") ?? [];
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const create = useAction((n: string) => api("/categories", { method: "POST", body: { name: n } }), { success: "Category added" });
  const rename = useAction((c: { id: string; name: string }) => api(`/categories/${c.id}`, { method: "PUT", body: { name: c.name } }), {
    success: "Category renamed",
  });
  const remove = useAction((id: string) => api(`/categories/${id}`, { method: "DELETE" }), { success: "Category deleted" });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Product categories"
        subtitle="Group products for filtering, reporting and dashboard views. Open a category to see what's in it."
        actions={<ExportMenu dataset="categories" />}
      />

      {isManager ? (
      <Card className="mb-6 p-5">
        <form
          className="flex flex-col gap-3 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(name, { onSuccess: () => setName("") });
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category, e.g. Electronics" aria-label="Category name" required minLength={2} />
          <Button type="submit" variant="primary" icon={Plus} size="lg" loading={create.isPending}>
            Add
          </Button>
        </form>
      </Card>
      ) : (
        <p className="mb-6 rounded-xl bg-canvas px-4 py-3 text-sm text-muted">Only inventory managers can change categories.</p>
      )}

      <Card>
        {!categories.data ? (
          <div className="space-y-3 p-6">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : categories.data.length === 0 ? (
          <EmptyState icon={Tags} title="No categories yet">
            Add one above, then assign products to it.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-hairline">
            {categories.data.map((c) => {
              const v = categoryVisual(c.name);
              const isEditing = editing?.id === c.id;
              return (
                <li key={c.id}>
                  <div className="flex items-center gap-4 px-4 py-4 sm:px-6">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl" style={{ background: v.bg }}>
                    <v.icon className="size-5" style={{ color: v.fg }} strokeWidth={1.6} />
                  </span>
                  {isEditing ? (
                    <form
                      className="flex flex-1 items-center gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        rename.mutate(editing, { onSuccess: () => setEditing(null) });
                      }}
                    >
                      <Input autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="h-10" aria-label="Category name" />
                      <IconButton icon={Check} label="Save" type="submit" />
                      <IconButton icon={X} label="Cancel" onClick={() => setEditing(null)} />
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => toggle(c.id)}
                        aria-expanded={open.has(c.id)}
                        aria-controls={`cat-${c.id}`}
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg py-1 text-left"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{c.name}</span>
                          <span className="text-sm text-muted">
                            {c.productCount} product{c.productCount === 1 ? "" : "s"}
                          </span>
                        </span>
                        <ChevronDown className={clsx("size-5 shrink-0 text-muted transition", open.has(c.id) && "rotate-180")} />
                      </button>
                      {isManager && (
                        <>
                      <IconButton icon={Pencil} label={`Rename ${c.name}`} onClick={() => setEditing({ id: c.id, name: c.name })} />
                      <IconButton
                        icon={Trash2}
                        label={`Delete ${c.name}`}
                        disabled={remove.isPending}
                        onClick={() => {
                          if (confirm(`Delete the “${c.name}” category?`)) remove.mutate(c.id);
                        }}
                      />
                        </>
                      )}
                    </>
                  )}
                  </div>
                  {open.has(c.id) && <CategoryProducts id={`cat-${c.id}`} products={products.data && (byCategory.get(c.id) ?? [])} categoryId={c.id} />}
                </li>
              );
            })}
            {uncategorised.length > 0 && (
              <li>
                <button
                  type="button"
                  onClick={() => toggle("")}
                  aria-expanded={open.has("")}
                  aria-controls="cat-none"
                  className="flex w-full items-center gap-4 px-4 py-4 text-left sm:px-6"
                >
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-canvas">
                    <Tags className="size-5 text-muted" strokeWidth={1.6} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-muted">Uncategorised</span>
                    <span className="text-sm text-muted">
                      {uncategorised.length} product{uncategorised.length === 1 ? "" : "s"}
                    </span>
                  </span>
                  <ChevronDown className={clsx("size-5 shrink-0 text-muted transition", open.has("") && "rotate-180")} />
                </button>
                {open.has("") && <CategoryProducts id="cat-none" products={uncategorised} categoryId={null} />}
              </li>
            )}
          </ul>
        )}
      </Card>
    </div>
  );
}
