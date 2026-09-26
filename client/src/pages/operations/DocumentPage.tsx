import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { ArrowRight, Check, FileQuestion, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { ProductPicker, LocationSelect } from "../../components/pickers";
import { useToast } from "../../components/toast";
import { Button, Card, CardHeader, EmptyState, ErrorNote, Field, IconButton, Input, PageHeader, Skeleton, StatusBadge, Textarea } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import {
  DOC_TYPES,
  docPath,
  docTypeBySlug,
  fmtDate,
  fmtDateTime,
  fmtQty,
  fmtSigned,
  isLate,
  isOpen,
  toDateInput,
} from "../../lib/format";
import { useLocations, useProducts } from "../../lib/queries";
import type { DocType, DocumentDetail, LocationOption, ProductRow } from "../../lib/types";

type Action = "confirm" | "check" | "pick" | "pack" | "validate" | "cancel";

interface LineDraft {
  key: string;
  productId: string;
  quantity: string;
  countedQuantity: string;
  notes: string;
}

interface Draft {
  partnerName: string;
  origin: string;
  sourceLocationId: string;
  destinationLocationId: string;
  scheduledDate: string;
  notes: string;
  lines: LineDraft[];
}

const newKey = () => Math.random().toString(36).slice(2);
const blankLine = (productId = ""): LineDraft => ({ key: newKey(), productId, quantity: "", countedQuantity: "", notes: "" });

function initialDraft(type: DocType, locations: LocationOption[], productId?: string): Draft {
  const first = locations[0]?.id ?? "";
  const second = locations.find((l) => l.id !== first)?.id ?? "";
  return {
    partnerName: "",
    origin: "",
    sourceLocationId: type === "receipt" ? "" : first,
    destinationLocationId: type === "receipt" ? first : type === "transfer" ? second : "",
    scheduledDate: toDateInput(new Date()),
    notes: "",
    lines: [blankLine(productId)],
  };
}

function draftFromDoc(doc: DocumentDetail): Draft {
  return {
    partnerName: doc.partnerName ?? "",
    origin: doc.origin ?? "",
    sourceLocationId: doc.sourceLocationId ?? "",
    destinationLocationId: doc.destinationLocationId ?? "",
    scheduledDate: toDateInput(doc.scheduledDate),
    notes: doc.notes ?? "",
    lines: doc.lines.map((l) => ({
      key: l.id,
      productId: l.productId,
      quantity: l.quantity ? String(l.quantity) : "",
      countedQuantity: l.countedQuantity != null ? String(l.countedQuantity) : "",
      notes: l.notes ?? "",
    })),
  };
}

function payload(type: DocType, d: Draft) {
  const [y, m, day] = d.scheduledDate.split("-").map(Number);
  return {
    partnerName: d.partnerName || null,
    origin: d.origin || null,
    sourceLocationId: d.sourceLocationId || null,
    destinationLocationId: d.destinationLocationId || null,
    scheduledDate: y ? new Date(y, m! - 1, day).toISOString() : undefined,
    notes: d.notes || null,
    lines: d.lines
      .filter((l) => l.productId)
      .map((l) => ({
        productId: l.productId,
        quantity: type === "adjustment" ? null : l.quantity === "" ? null : Number(l.quantity),
        countedQuantity: type === "adjustment" ? (l.countedQuantity === "" ? null : Number(l.countedQuantity)) : null,
        notes: l.notes || null,
      })),
  };
}

const STEPS: Record<DocType, string[]> = {
  receipt: ["Draft", "Ready to receive", "Received"],
  delivery: ["Draft", "Ready", "Picked", "Packed", "Shipped"],
  transfer: ["Draft", "Ready to move", "Transferred"],
  adjustment: ["Counted", "Applied"],
};

function stepIndex(doc: { type: DocType; status: string; pickedAt: string | null; packedAt: string | null } | null) {
  if (!doc || doc.status === "draft") return 0;
  if (doc.status === "done") return STEPS[doc.type].length - 1;
  if (doc.type === "delivery") return doc.packedAt ? 3 : doc.pickedAt ? 2 : 1;
  return 1;
}

function primaryFor(type: DocType, doc: DocumentDetail | undefined): { action: Action; label: string } | null {
  if (!doc || doc.status === "draft") {
    if (type === "adjustment") return { action: "validate", label: "Apply adjustment" };
    return { action: "confirm", label: doc ? "Confirm" : "Save & confirm" };
  }
  if (doc.status !== "ready") return null;
  switch (type) {
    case "receipt":
      return { action: "validate", label: "Validate · receive stock" };
    case "transfer":
      return { action: "validate", label: "Validate transfer" };
    case "adjustment":
      return { action: "validate", label: "Apply adjustment" };
    case "delivery":
      if (!doc.pickedAt) return { action: "pick", label: "Mark as picked" };
      if (!doc.packedAt) return { action: "pack", label: "Mark as packed" };
      return { action: "validate", label: "Validate · ship" };
  }
}

function hintFor(type: DocType, doc: DocumentDetail | undefined, sourceName: string) {
  if (!doc) return type === "adjustment" ? "Applying sets stock to the counted quantities and logs each difference in the ledger." : "Save a draft to finish later, or confirm to schedule it.";
  switch (doc.status) {
    case "draft":
      if (type === "adjustment") return "Applying sets stock to the counted quantities and logs each difference in the ledger.";
      if (type === "receipt") return "Confirm once the order is placed. Validate when the goods arrive.";
      return `Confirming checks that ${sourceName} has enough stock.`;
    case "waiting":
      return `Not enough stock at ${sourceName} yet. This becomes Ready automatically as soon as stock arrives.`;
    case "ready":
      if (type === "receipt") return "When the goods arrive, validate to add them to stock.";
      if (type === "transfer") return "Validate once the stock has physically moved.";
      if (type === "adjustment") return "Apply to update stock to the counted quantities.";
      if (!doc.pickedAt) return "Pick the items from their shelves.";
      if (!doc.packedAt) return "Pack the picked items for shipment.";
      return "Validate once the shipment leaves the warehouse.";
    case "done":
      return `Validated by ${doc.validatedBy?.name ?? "—"} on ${doc.validatedAt ? fmtDateTime(doc.validatedAt) : "—"}. The stock ledger has been updated.`;
    case "canceled":
      return "Canceled. No stock was moved.";
  }
}

export function DocumentPage() {
  const { kind, id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const qc = useQueryClient();
  const toast = useToast();
  const routeMeta = docTypeBySlug(kind);

  const docQuery = useQuery({
    queryKey: ["document", id],
    queryFn: () => api<{ document: DocumentDetail }>(`/documents/${id}`).then((r) => r.document),
    enabled: !isNew,
  });
  const doc = docQuery.data;
  const type: DocType | undefined = doc?.type ?? routeMeta?.type;
  const meta = type ? DOC_TYPES[type] : undefined;

  const products = useProducts({});
  const locations = useLocations();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = isNew || doc?.status === "draft";

  useEffect(() => {
    if (isNew && type && locations.data && !draft) {
      setDraft(initialDraft(type, locations.data, (routerLocation.state as { productId?: string } | null)?.productId));
    }
  }, [isNew, type, locations.data, draft, routerLocation.state]);

  useEffect(() => {
    if (doc && !dirty) setDraft(doc.status === "draft" ? draftFromDoc(doc) : null);
  }, [doc, dirty]);

  const stockLocationId = type === "receipt" ? "" : editable ? (draft?.sourceLocationId ?? "") : (doc?.sourceLocationId ?? "");
  const locationStock = useQuery({
    queryKey: ["location-stock", stockLocationId],
    queryFn: () =>
      api<{ items: { productId: string; quantity: number }[] }>(`/locations/${stockLocationId}/stock`).then(
        (r) => new Map(r.items.map((i) => [i.productId, i.quantity])),
      ),
    enabled: editable && !!stockLocationId,
  });

  const update = (patch: Partial<Draft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
    setError(null);
  };
  const updateLine = (key: string, patch: Partial<LineDraft>) =>
    update({ lines: draft!.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) });

  const run = useMutation({
    mutationFn: async ({ action, saveFirst }: { action?: Action; saveFirst: boolean }) => {
      let current = doc;
      if (isNew) {
        current = (await api<{ document: DocumentDetail }>("/documents", { method: "POST", body: { type, ...payload(type!, draft!) } })).document;
      } else if (saveFirst) {
        current = (await api<{ document: DocumentDetail }>(`/documents/${id}`, { method: "PUT", body: payload(type!, draft!) })).document;
      }
      if (action) {
        try {
          current = (await api<{ document: DocumentDetail }>(`/documents/${current!.id}/${action}`, { method: "POST" })).document;
        } catch (err) {
          // The document was saved; surface the action error on its page.
          if (isNew) navigate(docPath(current!), { replace: true });
          throw err;
        }
      }
      return { document: current!, action };
    },
    onSuccess: ({ document, action }) => {
      setDirty(false);
      setError(null);
      qc.setQueryData(["document", document.id], document);
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "me" && !(q.queryKey[0] === "document" && q.queryKey[1] === document.id) });
      if (isNew) navigate(docPath(document), { replace: true });
      toast(toastFor(document, action));
    },
    onError: (err) => {
      setError(errorMessage(err));
      // A new document may have been saved before the action failed; its page remounts, so toast too.
      if (isNew) toast({ title: errorMessage(err), tone: "error" });
    },
  });

  const productMap = useMemo(() => new Map((products.data ?? []).map((p) => [p.id, p])), [products.data]);

  if (!routeMeta && !doc) return <EmptyState icon={FileQuestion} title="Unknown operation type" />;
  if (!isNew && docQuery.isError) {
    return (
      <EmptyState icon={FileQuestion} title="Document not found" action={<Link to={`/operations/${routeMeta?.slug ?? "receipts"}`}><Button>Back</Button></Link>}>
        It may have been removed, or the link is wrong.
      </EmptyState>
    );
  }
  if (!meta || !type || (!isNew && !doc) || (editable && !draft)) {
    return (
      <div className="grid gap-8 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  const locs = locations.data ?? [];
  const locName = (lid: string | null | undefined) => {
    const l = locs.find((x) => x.id === lid);
    return l ? `${l.warehouse.code} / ${l.name}` : "the source location";
  };
  const primary = primaryFor(type, doc);
  const steps = STEPS[type];
  const current = stepIndex(doc ?? null);
  const open = !doc || isOpen(doc.status);
  const lineCount = editable ? draft!.lines.filter((l) => l.productId).length : doc!.lines.length;

  const subtitle = (() => {
    const src = editable ? draft!.sourceLocationId : doc!.sourceLocationId;
    const dst = editable ? draft!.destinationLocationId : doc!.destinationLocationId;
    const partner = editable ? draft!.partnerName : doc!.partnerName;
    if (type === "receipt") return `${partner || "Supplier"} → ${locName(dst)}`;
    if (type === "delivery") return `${locName(src)} → ${partner || "Customer"}`;
    if (type === "transfer") return `${locName(src)} → ${locName(dst)}`;
    return `Stock count at ${locName(src)}`;
  })();

  return (
    <div>
      <PageHeader
        eyebrow={
          <Link to={`/operations/${meta.slug}`} className="hover:underline">
            {meta.plural}
          </Link>
        }
        title={isNew ? `New ${meta.label.toLowerCase()}` : doc!.reference}
        subtitle={subtitle}
        actions={doc && <StatusBadge status={doc.status} className="px-3 py-1.5 text-sm" />}
      />

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="min-w-0 space-y-8 lg:col-span-2">
          <Card className="p-6">
            <h2 className="mb-5 text-lg font-semibold tracking-tight">Details</h2>
            {editable ? (
              <DetailsForm type={type} draft={draft!} locations={locs} update={update} />
            ) : (
              <DetailsView doc={doc!} />
            )}
          </Card>

          <Card>
            <CardHeader
              title={type === "adjustment" ? "Counted products" : "Products"}
              subtitle={
                type === "adjustment"
                  ? "Enter what you physically counted. The difference is logged as an adjustment."
                  : type === "receipt"
                    ? "What's arriving and how much"
                    : `Availability shown at ${locName(editable ? draft!.sourceLocationId : doc!.sourceLocationId)}`
              }
            />
            <div className="border-t border-hairline">
              {editable ? (
                <LinesEditor
                  type={type}
                  lines={draft!.lines}
                  products={products.data ?? []}
                  productMap={productMap}
                  stock={locationStock.data}
                  onChange={updateLine}
                  onAdd={() => update({ lines: [...draft!.lines, blankLine()] })}
                  onRemove={(key) => update({ lines: draft!.lines.filter((l) => l.key !== key) })}
                />
              ) : (
                <LinesView doc={doc!} />
              )}
            </div>
          </Card>

          {doc && doc.moves.length > 0 && (
            <Card>
              <CardHeader title="Stock ledger entries" subtitle="Written when this document was validated. Ledger entries can't be edited." />
              <div className="overflow-x-auto border-t border-hairline">
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-hairline text-xs text-muted">
                      <th className="py-3 pr-4 pl-6 font-semibold">Product</th>
                      <th className="px-4 py-3 font-semibold">Location</th>
                      <th className="px-4 py-3 text-right font-semibold">Change</th>
                      <th className="py-3 pr-6 pl-4 text-right font-semibold">Balance after</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doc.moves.map((m) => (
                      <tr key={m.id} className="border-b border-hairline last:border-0">
                        <td className="py-3 pr-4 pl-6 font-semibold">{m.product.name}</td>
                        <td className="px-4 py-3 text-muted">
                          {m.location.warehouse.code} / {m.location.name}
                        </td>
                        <td className={clsx("px-4 py-3 text-right font-semibold", m.quantityDelta > 0 ? "text-ok" : "text-bad")}>
                          {fmtSigned(m.quantityDelta)} {m.product.uom}
                        </td>
                        <td className="py-3 pr-6 pl-4 text-right">
                          {fmtQty(m.balanceAfter)} {m.product.uom}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>

        <aside className="lg:sticky lg:top-28 lg:self-start">
          <Card className="p-6 shadow-pop">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[22px] font-semibold tracking-tight">{lineCount} <span className="text-base font-normal text-muted">product{lineCount === 1 ? "" : "s"}</span></p>
              {doc && isLate(doc) && <span className="text-sm font-semibold text-bad">Late</span>}
            </div>

            <ol className="mt-5 space-y-0">
              {steps.map((label, i) => {
                const canceled = doc?.status === "canceled";
                const waiting = doc?.status === "waiting" && i === 1;
                const done = !canceled && (i < current || doc?.status === "done");
                const active = !canceled && i === current && doc?.status !== "done";
                return (
                  <li key={label} className="relative flex gap-3 pb-4 last:pb-0">
                    {i < steps.length - 1 && <span className={clsx("absolute top-6 left-[11px] h-[calc(100%-16px)] w-0.5", done ? "bg-ink" : "bg-hairline")} />}
                    <span
                      className={clsx(
                        "relative z-10 grid size-6 shrink-0 place-items-center rounded-full border-2",
                        done && "border-ink bg-ink text-white",
                        active && clsx("bg-white", waiting ? "border-warn" : "border-brand"),
                        !done && !active && "border-line bg-white",
                      )}
                    >
                      {done ? <Check className="size-3.5" strokeWidth={3} /> : active && <span className={clsx("size-2 rounded-full", waiting ? "bg-warn" : "bg-brand")} />}
                    </span>
                    <span className={clsx("pt-0.5 text-[15px]", active ? "font-semibold" : done ? "text-ink" : "text-muted", canceled && "line-through")}>
                      {waiting ? "Waiting for stock" : label}
                    </span>
                  </li>
                );
              })}
            </ol>

            <p className="mt-5 rounded-xl bg-canvas p-4 text-sm leading-relaxed text-muted">{hintFor(type, doc, locName(doc?.sourceLocationId ?? draft?.sourceLocationId))}</p>

            {error && <div className="mt-4"><ErrorNote>{error}</ErrorNote></div>}

            {open && (
              <div className="mt-5 space-y-3">
                {primary ? (
                  <Button
                    variant="primary"
                    size="lg"
                    className="w-full"
                    loading={run.isPending && run.variables?.action === primary.action}
                    disabled={run.isPending}
                    onClick={() => run.mutate({ action: primary.action, saveFirst: editable && dirty })}
                  >
                    {primary.label}
                  </Button>
                ) : doc?.status === "waiting" ? (
                  <Button variant="outline" size="lg" className="w-full" loading={run.isPending} onClick={() => run.mutate({ action: "check", saveFirst: false })}>
                    Check availability again
                  </Button>
                ) : null}

                {isNew && (
                  <Button variant="outline" size="lg" className="w-full" disabled={run.isPending} loading={run.isPending && !run.variables?.action} onClick={() => run.mutate({ saveFirst: true })}>
                    Save as draft
                  </Button>
                )}
                {!isNew && editable && dirty && (
                  <Button variant="outline" size="lg" className="w-full" disabled={run.isPending} loading={run.isPending && !run.variables?.action} onClick={() => run.mutate({ saveFirst: true })}>
                    Save changes
                  </Button>
                )}
                {doc && (
                  <button
                    type="button"
                    disabled={run.isPending}
                    onClick={() => confirm(`Cancel ${doc.reference}? No stock will move.`) && run.mutate({ action: "cancel", saveFirst: false })}
                    className="w-full py-2 text-center text-sm font-semibold text-muted underline underline-offset-2 hover:text-bad"
                  >
                    Cancel {meta.label.toLowerCase()}
                  </button>
                )}
              </div>
            )}

            {doc && (
              <dl className="mt-5 space-y-2 border-t border-hairline pt-5 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">Created by</dt>
                  <dd className="text-right font-medium">{doc.createdBy.name}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">Created</dt>
                  <dd className="text-right font-medium">{fmtDateTime(doc.createdAt)}</dd>
                </div>
                {doc.pickedAt && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">Picked</dt>
                    <dd className="text-right font-medium">{fmtDateTime(doc.pickedAt)}</dd>
                  </div>
                )}
                {doc.packedAt && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">Packed</dt>
                    <dd className="text-right font-medium">{fmtDateTime(doc.packedAt)}</dd>
                  </div>
                )}
              </dl>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}

function toastFor(doc: DocumentDetail, action?: Action) {
  const summary = doc.lines
    .slice(0, 2)
    .map((l) => `${doc.type === "adjustment" ? fmtSigned(l.quantity) : fmtQty(l.quantity)} ${l.product.uom} ${l.product.name}`)
    .join(", ");
  switch (action) {
    case "validate":
      return {
        title: { receipt: "Received — stock increased", delivery: "Shipped — stock reduced", transfer: "Transfer complete", adjustment: "Adjustment applied" }[doc.type],
        description: summary,
      };
    case "confirm":
      return doc.status === "waiting"
        ? { title: `${doc.reference} is waiting for stock`, tone: "info" as const }
        : { title: `${doc.reference} is ready` };
    case "check":
      return doc.status === "ready" ? { title: "Stock is available — ready to go" } : { title: "Still waiting for stock", tone: "info" as const };
    case "pick":
      return { title: "Items picked" };
    case "pack":
      return { title: "Items packed" };
    case "cancel":
      return { title: `${doc.reference} canceled`, tone: "info" as const };
    default:
      return { title: `Draft ${doc.reference} saved` };
  }
}

function DetailsForm({ type, draft, locations, update }: { type: DocType; draft: Draft; locations: LocationOption[]; update: (p: Partial<Draft>) => void }) {
  const partnerLabel = DOC_TYPES[type].partnerLabel;
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {partnerLabel && (
        <Field label={partnerLabel}>
          <Input value={draft.partnerName} onChange={(e) => update({ partnerName: e.target.value })} placeholder={type === "receipt" ? "e.g. Tata Steel Ltd" : "e.g. Sharma Furniture"} />
        </Field>
      )}
      {(type === "receipt" || type === "delivery") && (
        <Field label="Source document" hint={type === "receipt" ? "Purchase order number (optional)" : "Sales order number (optional)"}>
          <Input value={draft.origin} onChange={(e) => update({ origin: e.target.value })} placeholder={type === "receipt" ? "PO-2051" : "SO-1192"} />
        </Field>
      )}
      {type !== "receipt" && (
        <Field label={type === "adjustment" ? "Location counted" : type === "delivery" ? "Ship from" : "From"}>
          <LocationSelect value={draft.sourceLocationId} onChange={(v) => update({ sourceLocationId: v })} locations={locations} exclude={type === "transfer" ? draft.destinationLocationId : undefined} />
        </Field>
      )}
      {(type === "receipt" || type === "transfer") && (
        <Field label={type === "receipt" ? "Receive into" : "To"}>
          <LocationSelect value={draft.destinationLocationId} onChange={(v) => update({ destinationLocationId: v })} locations={locations} exclude={type === "transfer" ? draft.sourceLocationId : undefined} />
        </Field>
      )}
      <Field label={type === "adjustment" ? "Count date" : "Scheduled date"}>
        <Input type="date" value={draft.scheduledDate} onChange={(e) => update({ scheduledDate: e.target.value })} />
      </Field>
      <Field label="Notes" className="sm:col-span-2">
        <Textarea value={draft.notes} onChange={(e) => update({ notes: e.target.value })} placeholder={type === "adjustment" ? "e.g. Weekly cycle count" : "Anything the team should know"} rows={2} className="min-h-20" />
      </Field>
    </div>
  );
}

function DetailsView({ doc }: { doc: DocumentDetail }) {
  const meta = DOC_TYPES[doc.type];
  const loc = (l: DocumentDetail["sourceLocation"]) => (l ? `${l.warehouse.name} / ${l.name}` : "—");
  const rows: [string, React.ReactNode][] = [];
  if (meta.partnerLabel) rows.push([meta.partnerLabel, doc.partnerName ?? "—"]);
  if (doc.origin) rows.push(["Source document", doc.origin]);
  if (doc.type === "transfer") {
    rows.push([
      "Route",
      <span className="flex flex-wrap items-center gap-2">
        {loc(doc.sourceLocation)} <ArrowRight className="size-3.5 text-muted" /> {loc(doc.destinationLocation)}
      </span>,
    ]);
  } else if (doc.type === "receipt") rows.push(["Receive into", loc(doc.destinationLocation)]);
  else rows.push([doc.type === "adjustment" ? "Location counted" : "Ship from", loc(doc.sourceLocation)]);
  rows.push([doc.type === "adjustment" ? "Count date" : "Scheduled", fmtDate(doc.scheduledDate)]);
  if (doc.notes) rows.push(["Notes", doc.notes]);

  return (
    <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className={clsx(label === "Notes" && "sm:col-span-2")}>
          <dt className="text-sm text-muted">{label}</dt>
          <dd className="mt-0.5 text-[15px] font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function LinesEditor({
  type,
  lines,
  products,
  productMap,
  stock,
  onChange,
  onAdd,
  onRemove,
}: {
  type: DocType;
  lines: LineDraft[];
  products: ProductRow[];
  productMap: Map<string, ProductRow>;
  stock: Map<string, number> | undefined;
  onChange: (key: string, patch: Partial<LineDraft>) => void;
  onAdd: () => void;
  onRemove: (key: string) => void;
}) {
  const showAvailable = type === "delivery" || type === "transfer";
  const isAdjustment = type === "adjustment";
  return (
    <div>
      <div className="overflow-x-auto">
        <table className={clsx("w-full text-left text-sm", isAdjustment ? "min-w-[860px]" : "min-w-[640px]")}>
          <thead>
            <tr className="border-b border-hairline text-xs text-muted">
              <th className="min-w-[260px] py-3 pr-3 pl-6 font-semibold">Product</th>
              {showAvailable && <th className="px-3 py-3 text-right font-semibold">Available</th>}
              {isAdjustment && <th className="px-3 py-3 text-right font-semibold">Recorded</th>}
              <th className="w-36 px-3 py-3 font-semibold">{isAdjustment ? "Counted" : "Quantity"}</th>
              {isAdjustment && <th className="px-3 py-3 text-right font-semibold">Difference</th>}
              {isAdjustment && <th className="w-48 px-3 py-3 font-semibold">Reason</th>}
              <th className="w-14 py-3 pr-6" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const product = productMap.get(line.productId);
              const available = stock?.get(line.productId) ?? 0;
              const qty = Number(line.quantity || 0);
              const short = showAvailable && !!line.productId && qty > available;
              const counted = line.countedQuantity === "" ? null : Number(line.countedQuantity);
              const diff = counted == null ? null : counted - available;
              return (
                <tr key={line.key} className="border-b border-hairline align-top last:border-0">
                  <td className="py-3 pr-3 pl-6">
                    <ProductPicker value={line.productId} onChange={(pid) => onChange(line.key, { productId: pid })} products={products} />
                  </td>
                  {showAvailable && (
                    <td className={clsx("px-3 pt-6 text-right whitespace-nowrap", short ? "font-semibold text-bad" : "text-muted")}>
                      {line.productId ? `${fmtQty(available)} ${product?.uom ?? ""}` : "—"}
                    </td>
                  )}
                  {isAdjustment && (
                    <td className="px-3 pt-6 text-right whitespace-nowrap text-muted">{line.productId ? `${fmtQty(available)} ${product?.uom ?? ""}` : "—"}</td>
                  )}
                  <td className="px-3 py-3">
                    <div className="relative">
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        inputMode="decimal"
                        className="h-11 pr-12 text-right"
                        value={isAdjustment ? line.countedQuantity : line.quantity}
                        onChange={(e) => onChange(line.key, isAdjustment ? { countedQuantity: e.target.value } : { quantity: e.target.value })}
                        placeholder="0"
                        invalid={short}
                        aria-label={isAdjustment ? "Counted quantity" : "Quantity"}
                      />
                      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted">{product?.uom}</span>
                    </div>
                  </td>
                  {isAdjustment && (
                    <td className={clsx("px-3 pt-6 text-right font-semibold whitespace-nowrap", diff == null || diff === 0 ? "text-muted" : diff > 0 ? "text-ok" : "text-bad")}>
                      {diff == null ? "—" : diff === 0 ? "No change" : fmtSigned(diff)}
                    </td>
                  )}
                  {isAdjustment && (
                    <td className="px-3 py-3">
                      <Input className="h-11" value={line.notes} onChange={(e) => onChange(line.key, { notes: e.target.value })} placeholder="e.g. Damaged" aria-label="Reason" />
                    </td>
                  )}
                  <td className="py-3 pr-6 pl-1 pt-4">
                    <IconButton icon={Trash2} label="Remove line" onClick={() => onRemove(line.key)} disabled={lines.length === 1} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-6 py-4">
        <Button variant="ghost" size="sm" icon={Plus} onClick={onAdd} className="-ml-3.5">
          Add a product
        </Button>
      </div>
    </div>
  );
}

function LinesView({ doc }: { doc: DocumentDetail }) {
  const isAdjustment = doc.type === "adjustment";
  const done = doc.status === "done";
  const showAvailable = !done && (doc.type === "delivery" || doc.type === "transfer") && isOpen(doc.status);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead>
          <tr className="border-b border-hairline text-xs text-muted">
            <th className="py-3 pr-4 pl-6 font-semibold">Product</th>
            {isAdjustment && <th className="px-4 py-3 text-right font-semibold">Recorded</th>}
            <th className="px-4 py-3 text-right font-semibold">{isAdjustment ? "Counted" : "Quantity"}</th>
            {isAdjustment && <th className="px-4 py-3 text-right font-semibold">Difference</th>}
            {showAvailable && <th className="px-4 py-3 text-right font-semibold">Available</th>}
            {isAdjustment && <th className="py-3 pr-6 pl-4 font-semibold">Reason</th>}
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((l) => {
            const recorded = done ? l.recordedQuantity : l.available;
            const diff = done ? l.quantity : l.countedQuantity != null && recorded != null ? l.countedQuantity - recorded : null;
            const short = showAvailable && l.available != null && l.available < l.quantity;
            return (
              <tr key={l.id} className="border-b border-hairline last:border-0">
                <td className="py-3.5 pr-4 pl-6">
                  <Link to={`/products/${l.productId}`} className="font-semibold hover:underline">
                    {l.product.name}
                  </Link>
                  <div className="font-mono text-xs text-muted">{l.product.sku}</div>
                </td>
                {isAdjustment && <td className="px-4 py-3.5 text-right text-muted">{fmtQty(recorded)}</td>}
                <td className="px-4 py-3.5 text-right font-semibold whitespace-nowrap">
                  {fmtQty(isAdjustment ? l.countedQuantity : l.quantity)} <span className="font-normal text-muted">{l.product.uom}</span>
                </td>
                {isAdjustment && (
                  <td className={clsx("px-4 py-3.5 text-right font-semibold", !diff ? "text-muted" : diff > 0 ? "text-ok" : "text-bad")}>
                    {diff == null ? "—" : diff === 0 ? "No change" : fmtSigned(diff)}
                  </td>
                )}
                {showAvailable && (
                  <td className={clsx("px-4 py-3.5 text-right whitespace-nowrap", short ? "font-semibold text-bad" : "text-muted")}>
                    {fmtQty(l.available)} {l.product.uom}
                  </td>
                )}
                {isAdjustment && <td className="py-3.5 pr-6 pl-4 text-muted">{l.notes ?? "—"}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
