import { Check, MapPin, Pencil, Plus, Warehouse as WarehouseIcon, X } from "lucide-react";
import { useState } from "react";
import { Button, Card, EmptyState, ErrorNote, Field, IconButton, Input, Modal, PageHeader, Skeleton } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { fmtQty } from "../../lib/format";
import { useAction, useWarehouses } from "../../lib/queries";
import type { Warehouse } from "../../lib/types";

export function Warehouses() {
  const { user } = useAuth();
  const canEdit = user?.role === "manager";
  const warehouses = useWarehouses();
  const [editing, setEditing] = useState<Warehouse | "new" | null>(null);

  return (
    <div>
      <PageHeader
        eyebrow="Settings"
        title="Warehouses"
        subtitle="Your physical sites and the locations inside them — racks, zones and floors."
        actions={
          canEdit && (
            <Button variant="primary" icon={Plus} onClick={() => setEditing("new")}>
              New warehouse
            </Button>
          )
        }
      />
      {!canEdit && (
        <p className="mb-6 rounded-xl bg-canvas px-4 py-3 text-sm text-muted">Only inventory managers can change warehouse settings.</p>
      )}

      {!warehouses.data ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-72 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      ) : warehouses.data.length === 0 ? (
        <Card>
          <EmptyState icon={WarehouseIcon} title="No warehouses yet" action={canEdit && <Button variant="primary" onClick={() => setEditing("new")}>Add a warehouse</Button>}>
            Add your first site. It comes with a default “Stock” location.
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {warehouses.data.map((w) => (
            <WarehouseCard key={w.id} warehouse={w} canEdit={canEdit} onEdit={() => setEditing(w)} />
          ))}
        </div>
      )}

      {editing && <WarehouseModal warehouse={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function WarehouseCard({ warehouse: w, canEdit, onEdit }: { warehouse: Warehouse; canEdit: boolean; onEdit: () => void }) {
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const add = useAction((n: string) => api(`/warehouses/${w.id}/locations`, { method: "POST", body: { name: n } }), { success: "Location added" });
  const rename = useAction((l: { id: string; name: string }) => api(`/locations/${l.id}`, { method: "PUT", body: { name: l.name } }), { success: "Location renamed" });
  const total = w.locations.reduce((sum, l) => sum + l.totalQuantity, 0);

  return (
    <Card className="flex flex-col">
      <div className="flex items-start gap-4 p-6">
        <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand">
          <WarehouseIcon className="size-6" strokeWidth={1.6} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-lg font-semibold tracking-tight">{w.name}</h2>
            <span className="rounded-md bg-canvas px-2 py-0.5 font-mono text-xs font-semibold">{w.code}</span>
          </div>
          <p className="truncate text-sm text-muted">{w.address || "No address"}</p>
          <p className="mt-1 text-sm">
            <span className="font-semibold">{w.locations.length}</span> <span className="text-muted">locations ·</span> <span className="font-semibold">{fmtQty(total)}</span>{" "}
            <span className="text-muted">units on hand</span>
          </p>
        </div>
        {canEdit && <IconButton icon={Pencil} label={`Edit ${w.name}`} onClick={onEdit} />}
      </div>
      <ul className="flex-1 divide-y divide-hairline border-t border-hairline">
        {w.locations.map((l) => (
          <li key={l.id} className="flex items-center gap-3 px-6 py-3">
            <MapPin className="size-4 shrink-0 text-muted" />
            {renaming?.id === l.id ? (
              <form
                className="flex flex-1 items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  rename.mutate(renaming, { onSuccess: () => setRenaming(null) });
                }}
              >
                <Input autoFocus className="h-9" value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} aria-label="Location name" />
                <IconButton icon={Check} label="Save" type="submit" />
                <IconButton icon={X} label="Cancel" onClick={() => setRenaming(null)} />
              </form>
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{l.name}</span>
                <span className="text-sm whitespace-nowrap text-muted">
                  {l.productCount} product{l.productCount === 1 ? "" : "s"} · {fmtQty(l.totalQuantity)} units
                </span>
                {canEdit && <IconButton icon={Pencil} label={`Rename ${l.name}`} className="size-8" onClick={() => setRenaming({ id: l.id, name: l.name })} />}
              </>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form
          className="flex gap-2 border-t border-hairline p-4"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate(name, { onSuccess: () => setName("") });
          }}
        >
          <Input className="h-10" value={name} onChange={(e) => setName(e.target.value)} placeholder="New location, e.g. Rack C" aria-label="New location name" required />
          <Button type="submit" size="sm" icon={Plus} className="h-10" loading={add.isPending}>
            Add
          </Button>
        </form>
      )}
    </Card>
  );
}

function WarehouseModal({ warehouse, onClose }: { warehouse: Warehouse | null; onClose: () => void }) {
  const [form, setForm] = useState({ name: warehouse?.name ?? "", code: warehouse?.code ?? "", address: warehouse?.address ?? "" });
  const save = useAction(
    () =>
      warehouse
        ? api(`/warehouses/${warehouse.id}`, { method: "PUT", body: form })
        : api("/warehouses", { method: "POST", body: form }),
    { success: warehouse ? "Warehouse updated" : "Warehouse created" },
  );
  return (
    <Modal
      open
      onClose={onClose}
      title={warehouse ? "Edit warehouse" : "New warehouse"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="warehouse-form" loading={save.isPending}>
            {warehouse ? "Save" : "Create warehouse"}
          </Button>
        </>
      }
    >
      <form
        id="warehouse-form"
        className="grid gap-4 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined, { onSuccess: onClose });
        }}
      >
        <Field label="Name" className="sm:col-span-2">
          <Input autoFocus required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Main Warehouse" />
        </Field>
        <Field label="Short code" hint="Prefix for references">
          <Input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="WH" maxLength={6} className="font-mono uppercase" />
        </Field>
        <Field label="Address" className="sm:col-span-3">
          <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Optional" />
        </Field>
        {!warehouse && <p className="text-sm text-muted sm:col-span-3">A default “Stock” location is created automatically.</p>}
        {save.isError && <div className="sm:col-span-3"><ErrorNote>{errorMessage(save.error)}</ErrorNote></div>}
      </form>
    </Modal>
  );
}
