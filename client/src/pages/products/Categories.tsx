import { Check, Pencil, Plus, Tags, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Button, Card, EmptyState, IconButton, Input, PageHeader, Skeleton } from "../../components/ui";
import { api } from "../../lib/api";
import { useIsManager } from "../../lib/auth";
import { useAction, useCategories } from "../../lib/queries";
import { categoryVisual } from "../../lib/visual";

export function Categories() {
  const categories = useCategories();
  const isManager = useIsManager();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  const create = useAction((n: string) => api("/categories", { method: "POST", body: { name: n } }), { success: "Category added" });
  const rename = useAction((c: { id: string; name: string }) => api(`/categories/${c.id}`, { method: "PUT", body: { name: c.name } }), {
    success: "Category renamed",
  });
  const remove = useAction((id: string) => api(`/categories/${id}`, { method: "DELETE" }), { success: "Category deleted" });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Product categories" subtitle="Group products for filtering, reporting and dashboard views." />

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
                <li key={c.id} className="flex items-center gap-4 px-6 py-4">
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
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{c.name}</p>
                        <Link to={`/products?categoryId=${c.id}`} className="text-sm text-muted hover:underline">
                          {c.productCount} product{c.productCount === 1 ? "" : "s"}
                        </Link>
                      </div>
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
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
