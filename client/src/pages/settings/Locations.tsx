import { Check, MapPin, Pencil, Plus, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Button, Card, EmptyState, ErrorNote, Field, IconButton, Input, PageHeader, Select, Skeleton } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { fmtQty } from "../../lib/format";
import { useAction, useWarehouses } from "../../lib/queries";

interface Editing {
  id: string;
  name: string;
  code: string;
  warehouseId: string;
}

export function Locations() {
  const { user } = useAuth();
  const canEdit = user?.role === "manager";
  const warehouses = useWarehouses();
  const [form, setForm] = useState({ name: "", code: "", warehouseId: "" });
  const [editing, setEditing] = useState<Editing | null>(null);

  const create = useAction(
    () => api("/locations", { method: "POST", body: { ...form, warehouseId: form.warehouseId || warehouses.data?.[0]?.id } }),
    { success: "Location added" },
  );
  const update = useAction((l: Editing) => api(`/locations/${l.id}`, { method: "PUT", body: { name: l.name, code: l.code, warehouseId: l.warehouseId } }), {
    success: "Location updated",
  });

  const rows = (warehouses.data ?? []).flatMap((w) => w.locations.map((l) => ({ ...l, warehouse: w })));

  return (
    <div>
      <PageHeader
        eyebrow="Settings"
        title="Locations"
        subtitle={
          <>
            Racks, zones and floors inside each warehouse. Manage the sites themselves under{" "}
            <Link to="/settings/warehouses" className="font-semibold text-ink underline underline-offset-2">
              Warehouses
            </Link>
            .
          </>
        }
      />

      {canEdit ? (
        <Card className="mb-6 p-5">
          <form
            className="grid gap-4 sm:grid-cols-[1fr_160px_1fr_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate(undefined, { onSuccess: () => setForm({ name: "", code: "", warehouseId: form.warehouseId }) });
            }}
          >
            <Field label="Location name">
              <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Rack C" />
            </Field>
            <Field label="Short code">
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="RACKC" maxLength={8} className="font-mono uppercase" />
            </Field>
            <Field label="Warehouse">
              <Select value={form.warehouseId || warehouses.data?.[0]?.id || ""} onChange={(e) => setForm({ ...form, warehouseId: e.target.value })}>
                {warehouses.data?.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.code})
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" variant="primary" size="lg" icon={Plus} loading={create.isPending}>
              Add
            </Button>
          </form>
          {create.isError && (
            <div className="mt-4">
              <ErrorNote>{errorMessage(create.error)}</ErrorNote>
            </div>
          )}
        </Card>
      ) : (
        <p className="mb-6 rounded-xl bg-canvas px-4 py-3 text-sm text-muted">Only inventory managers can change locations.</p>
      )}

      <Card>
        {!warehouses.data ? (
          <div className="space-y-3 p-6">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={MapPin} title="No locations yet">
            Create a warehouse first — it comes with a default “Stock” location.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-hairline text-xs text-muted">
                  <th className="py-3 pr-4 pl-6 font-semibold">Location</th>
                  <th className="px-4 py-3 font-semibold">Short code</th>
                  <th className="px-4 py-3 font-semibold">Warehouse</th>
                  <th className="px-4 py-3 text-right font-semibold">Products</th>
                  <th className="px-4 py-3 text-right font-semibold">Units</th>
                  <th className="py-3 pr-6 pl-4" />
                </tr>
              </thead>
              <tbody>
                {rows.map((l) =>
                  editing?.id === l.id ? (
                    <tr key={l.id} className="border-b border-hairline bg-canvas/60 last:border-0">
                      <td className="py-2 pr-2 pl-6">
                        <Input className="h-10" autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} aria-label="Location name" />
                      </td>
                      <td className="px-2 py-2">
                        <Input className="h-10 font-mono uppercase" value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })} maxLength={8} aria-label="Short code" />
                      </td>
                      <td className="px-2 py-2">
                        <Select className="h-10" value={editing.warehouseId} onChange={(e) => setEditing({ ...editing, warehouseId: e.target.value })} aria-label="Warehouse">
                          {warehouses.data.map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.name}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td colSpan={2} />
                      <td className="py-2 pr-6 pl-2">
                        <div className="flex justify-end gap-1">
                          <IconButton icon={Check} label="Save" onClick={() => update.mutate(editing, { onSuccess: () => setEditing(null) })} />
                          <IconButton icon={X} label="Cancel" onClick={() => setEditing(null)} />
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={l.id} className="border-b border-hairline last:border-0">
                      <td className="py-3.5 pr-4 pl-6">
                        <span className="flex items-center gap-3 font-semibold">
                          <MapPin className="size-4 text-muted" /> {l.name}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 font-mono text-xs">{l.code ? `${l.warehouse.code}/${l.code}` : <span className="text-muted">—</span>}</td>
                      <td className="px-4 py-3.5">{l.warehouse.name}</td>
                      <td className="px-4 py-3.5 text-right">{l.productCount}</td>
                      <td className="px-4 py-3.5 text-right">{fmtQty(l.totalQuantity)}</td>
                      <td className="py-3.5 pr-6 pl-4 text-right">
                        {canEdit && (
                          <IconButton
                            icon={Pencil}
                            label={`Edit ${l.name}`}
                            onClick={() => setEditing({ id: l.id, name: l.name, code: l.code ?? "", warehouseId: l.warehouseId })}
                          />
                        )}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {update.isError && (
        <div className="mt-4">
          <ErrorNote>{errorMessage(update.error)}</ErrorNote>
        </div>
      )}
    </div>
  );
}
