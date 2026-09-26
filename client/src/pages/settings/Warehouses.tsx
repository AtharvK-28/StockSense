import { Check, ExternalLink, LocateFixed, MapPin, MapPinned, Navigation, Pencil, Plus, Search, Warehouse as WarehouseIcon, X } from "lucide-react";
import { useState } from "react";
import { ExportMenu } from "../../components/ExportMenu";
import { Button, Card, EmptyState, ErrorNote, Field, IconButton, Input, Modal, PageHeader, Skeleton } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { fmtQty } from "../../lib/format";
import { type Pin, currentPosition, directionsUrl, embedUrl, geocode, openMapUrl, parsePin, round6 } from "../../lib/maps";
import { useAction, useWarehouses } from "../../lib/queries";
import type { Warehouse } from "../../lib/types";

const pinOf = (w: { latitude: number | null; longitude: number | null }): Pin | null =>
  w.latitude != null && w.longitude != null ? { lat: w.latitude, lng: w.longitude } : null;

/** OpenStreetMap preview with a marker. Loads only when scrolled into view. */
function MapFrame({ pin, title, className }: { pin: Pin; title: string; className?: string }) {
  return (
    <iframe
      title={title}
      src={embedUrl(pin)}
      loading="lazy"
      referrerPolicy="strict-origin-when-cross-origin"
      className={`map-frame block w-full border-0 bg-canvas ${className ?? ""}`}
    />
  );
}

function MapLinks({ pin, address }: { pin: Pin | null; address: string | null }) {
  if (!pin && !address) return null;
  const link = "inline-flex h-9 items-center gap-1.5 rounded-full border border-line px-3.5 text-sm font-semibold transition hover:border-ink";
  return (
    <div className="flex flex-wrap gap-2">
      <a href={directionsUrl(pin, address)} target="_blank" rel="noreferrer" className={link}>
        <Navigation className="size-3.5" /> Directions
      </a>
      {pin && (
        <a href={openMapUrl(pin)} target="_blank" rel="noreferrer" className={link}>
          <ExternalLink className="size-3.5" /> Open map
        </a>
      )}
    </div>
  );
}

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
          <>
            <ExportMenu dataset="locations" />
            {canEdit && (
              <Button variant="primary" icon={Plus} onClick={() => setEditing("new")}>
                New warehouse
              </Button>
            )}
          </>
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
  const pin = pinOf(w);

  return (
    <Card className="flex min-w-0 flex-col overflow-hidden">
      {pin ? (
        <MapFrame pin={pin} title={`Map of ${w.name}`} className="h-44" />
      ) : (
        canEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="flex h-16 items-center justify-center gap-2 border-b border-dashed border-line bg-canvas/60 text-sm font-semibold text-muted transition hover:text-ink"
          >
            <MapPinned className="size-4" /> Pin this warehouse on the map
          </button>
        )
      )}
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
          <div className="mt-3">
            <MapLinks pin={pin} address={w.address} />
          </div>
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
  const [pin, setPin] = useState<Pin | null>(warehouse ? pinOf(warehouse) : null);
  const [pinText, setPinText] = useState(pin ? `${pin.lat}, ${pin.lng}` : "");
  const [locating, setLocating] = useState<"search" | "gps" | null>(null);
  const [pinNote, setPinNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const choosePin = (next: Pin | null, note?: string) => {
    const rounded = next && { lat: round6(next.lat), lng: round6(next.lng) };
    setPin(rounded);
    setPinText(rounded ? `${rounded.lat}, ${rounded.lng}` : "");
    setPinNote(note ? { tone: "ok", text: note } : null);
  };
  const locate = async (how: "search" | "gps") => {
    setLocating(how);
    setPinNote(null);
    try {
      if (how === "gps") choosePin(await currentPosition(), "Pinned to where you are now.");
      else {
        const hit = await geocode(form.address);
        if (hit) choosePin(hit, `Found: ${hit.label}`);
        else setPinNote({ tone: "bad", text: "No match for that address. Try adding the city, or paste a map link." });
      }
    } catch (err) {
      setPinNote({ tone: "bad", text: (err as Error).message });
    } finally {
      setLocating(null);
    }
  };
  const pinTextInvalid = pinText.trim() !== "" && !parsePin(pinText);

  const body = { ...form, latitude: pin?.lat ?? null, longitude: pin?.lng ?? null };
  const save = useAction(
    () =>
      warehouse
        ? api(`/warehouses/${warehouse.id}`, { method: "PUT", body })
        : api("/warehouses", { method: "POST", body }),
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
          <Button type="submit" form="warehouse-form" loading={save.isPending} disabled={pinTextInvalid}>
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
        <div className="rounded-xl bg-canvas p-4 sm:col-span-3">
          <p className="text-sm font-semibold">Map pin</p>
          <p className="mt-0.5 text-[13px] text-muted">Shows the site on a map and gives everyone one-tap directions.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" icon={Search} loading={locating === "search"} disabled={!form.address.trim() || !!locating} onClick={() => locate("search")}>
              Find the address
            </Button>
            <Button size="sm" variant="outline" icon={LocateFixed} loading={locating === "gps"} disabled={!!locating} onClick={() => locate("gps")}>
              I'm here now
            </Button>
            {pin && (
              <Button size="sm" variant="ghost" icon={X} onClick={() => choosePin(null)}>
                Remove pin
              </Button>
            )}
          </div>
          <Field
            label="Or paste coordinates or a map link"
            className="mt-3"
            error={pinTextInvalid ? "Couldn't read a location from that. Paste “18.52, 73.85” or a Google Maps / OpenStreetMap link." : null}
          >
            <Input
              value={pinText}
              onChange={(e) => {
                setPinText(e.target.value);
                const parsed = parsePin(e.target.value);
                if (parsed) setPin({ lat: round6(parsed.lat), lng: round6(parsed.lng) });
                else if (!e.target.value.trim()) setPin(null);
                setPinNote(null);
              }}
              placeholder="18.6298, 73.8478"
              className="h-10 bg-white font-mono text-sm"
            />
          </Field>
          {pinNote && <p className={`mt-2 text-[13px] ${pinNote.tone === "ok" ? "text-ok" : "text-bad"}`}>{pinNote.text}</p>}
          {pin && !pinNote && !pinTextInvalid && pinText !== `${pin.lat}, ${pin.lng}` && (
            <p className="mt-2 text-[13px] text-ok">
              Pinned at {pin.lat}, {pin.lng}
            </p>
          )}
          {pin && <MapFrame pin={pin} title="Map preview" className="mt-3 h-44 rounded-lg" />}
        </div>
        {!warehouse && <p className="text-sm text-muted sm:col-span-3">A default “Stock” location is created automatically.</p>}
        {save.isError && <div className="sm:col-span-3"><ErrorNote>{errorMessage(save.error)}</ErrorNote></div>}
      </form>
    </Modal>
  );
}
