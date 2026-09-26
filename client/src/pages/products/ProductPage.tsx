import { useQuery } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowLeftRight, History, MapPin, SlidersHorizontal, Truck, Lock, Barcode as BarcodeIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ActivityFeed } from "../../components/ActivityFeed";
import { Button, Card, CardHeader, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Skeleton, StockBadge } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { docPath, fmtMoney, fmtQty, fmtRelative } from "../../lib/format";
import { useIsManager } from "../../lib/auth";
import { useAction, useCategories, useLocations } from "../../lib/queries";
import type { DocumentDetail, LedgerEntry, ProductDetail } from "../../lib/types";
import { UOM_OPTIONS, categoryVisual } from "../../lib/visual";

interface FormState {
  name: string;
  sku: string;
  categoryId: string;
  uom: string;
  unitCost: string;
  minQty: string;
  maxQty: string;
  initialLocationId: string;
  initialQty: string;
}

const emptyForm: FormState = { name: "", sku: "", categoryId: "", uom: "Units", unitCost: "", minQty: "", maxQty: "", initialLocationId: "", initialQty: "" };
const num = (s: string) => (s.trim() === "" ? null : Number(s));

export function ProductPage() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const categories = useCategories();
  const locations = useLocations();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [dirty, setDirty] = useState(false);

  const detail = useQuery({
    queryKey: ["product", id],
    queryFn: () => api<{ product: ProductDetail; moves: LedgerEntry[] }>(`/products/${id}`),
    enabled: !isNew,
  });
  const product = detail.data?.product;

  useEffect(() => {
    if (product && !dirty) {
      setForm({
        ...emptyForm,
        name: product.name,
        sku: product.sku,
        categoryId: product.category?.id ?? "",
        uom: product.uom,
        unitCost: product.unitCost?.toString() ?? "",
        minQty: product.minQty?.toString() ?? "",
        maxQty: product.maxQty?.toString() ?? "",
      });
    }
  }, [product, dirty]);

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setDirty(true);
  };

  const body = () => ({
    name: form.name,
    sku: form.sku,
    categoryId: form.categoryId || null,
    uom: form.uom,
    unitCost: num(form.unitCost),
    minQty: num(form.minQty),
    maxQty: num(form.maxQty),
  });

  const save = useAction(
    () =>
      isNew
        ? api<{ product: { id: string } }>("/products", {
            method: "POST",
            body: {
              ...body(),
              initialStock: form.initialQty && form.initialLocationId ? { locationId: form.initialLocationId, quantity: Number(form.initialQty) } : null,
            },
          })
        : api<{ product: { id: string } }>(`/products/${id}`, { method: "PUT", body: body() }),
    { success: isNew ? "Product created" : "Changes saved" },
  );

  const replenish = useAction(() => api<{ document: DocumentDetail }>(`/products/${id}/replenish`, { method: "POST", body: {} }));
  const isManager = useIsManager();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate(undefined, {
      onSuccess: ({ product: saved }) => {
        setDirty(false);
        if (isNew) navigate(`/products/${saved.id}`, { replace: true });
      },
    });
  };

  if (isNew && !isManager) {
    return (
      <EmptyState icon={Lock} title="Only inventory managers can add products" action={<Link to="/products"><Button>Back to products</Button></Link>}>
        Ask a manager to add it to the catalog. You can still receive, move and count existing products.
      </EmptyState>
    );
  }
  if (!isNew && detail.isError) {
    return <EmptyState icon={MapPin} title="Product not found" action={<Link to="/products"><Button>Back to products</Button></Link>} />;
  }
  if (!isNew && !product) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const visual = categoryVisual(product?.category?.name ?? categories.data?.find((c) => c.id === form.categoryId)?.name);
  const initialInvalid = !!form.initialQty && !form.initialLocationId;

  const detailsForm = (
    <form id="product-form" onSubmit={submit}>
      <fieldset disabled={!isManager} className="grid gap-5 sm:grid-cols-2">
      <Field label="Product name" className="sm:col-span-2">
        <Input value={form.name} onChange={set("name")} required placeholder="e.g. Steel Rods" />
      </Field>
      <Field label="SKU / code" hint="Unique. Letters, numbers, . _ / -">
        <Input value={form.sku} onChange={set("sku")} required placeholder="STL-001" className="font-mono uppercase" />
      </Field>
      <Field label="Category" hint={<Link to="/products/categories" className="underline">Manage categories</Link>}>
        <Select value={form.categoryId} onChange={set("categoryId")}>
          <option value="">Uncategorised</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Unit of measure">
        <Input value={form.uom} onChange={set("uom")} required list="uom-options" placeholder="Units" />
        <datalist id="uom-options">
          {UOM_OPTIONS.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
      </Field>
      <Field label="Per unit cost (₹)" hint="Used for stock valuation">
        <Input type="number" min={0} step="any" value={form.unitCost} onChange={set("unitCost")} placeholder="Optional" />
      </Field>
      <Field label="Reorder at (min)" hint="Alert when total stock falls to this level">
        <Input type="number" min={0} step="any" value={form.minQty} onChange={set("minQty")} placeholder="Optional" />
      </Field>
      <Field label="Replenish up to (max)" hint="Suggested reorder brings stock back to this">
        <Input type="number" min={0} step="any" value={form.maxQty} onChange={set("maxQty")} placeholder="Optional" />
      </Field>

      {isNew && (
        <div className="rounded-xl bg-canvas p-5 sm:col-span-2">
          <p className="text-sm font-semibold">Opening stock (optional)</p>
          <p className="mt-0.5 text-[13px] text-muted">Recorded as an inventory adjustment in the ledger, like every other stock change.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Location" error={initialInvalid ? "Choose where the stock is" : null}>
              <Select value={form.initialLocationId} onChange={set("initialLocationId")}>
                <option value="">Choose a location</option>
                {locations.data?.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.warehouse.name} / {l.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={`Quantity${form.uom ? ` (${form.uom})` : ""}`}>
              <Input type="number" min={0} step="any" value={form.initialQty} onChange={set("initialQty")} placeholder="0" />
            </Field>
          </div>
        </div>
      )}
      {save.isError && <div className="sm:col-span-2"><ErrorNote>{errorMessage(save.error)}</ErrorNote></div>}
      </fieldset>
    </form>
  );

  if (isNew) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader eyebrow={<Link to="/products" className="hover:underline">Products</Link>} title="New product" subtitle="Add an item to your catalog. Stock is tracked per location." />
        <Card className="p-6 sm:p-8">
          <div className="mb-6 flex items-center gap-4">
            <span className="grid size-16 place-items-center rounded-xl" style={{ background: visual.bg }}>
              <visual.icon className="size-8" style={{ color: visual.fg }} strokeWidth={1.4} />
            </span>
            <div>
              <p className="font-semibold">{form.name || "Untitled product"}</p>
              <p className="font-mono text-sm text-muted">{form.sku.toUpperCase() || "SKU"}</p>
            </div>
          </div>
          {detailsForm}
          <div className="mt-8 flex justify-end gap-3 border-t border-hairline pt-6">
            <Button variant="ghost" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button type="submit" form="product-form" variant="primary" loading={save.isPending} disabled={initialInvalid}>
              Create product
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const p = product!;
  const forecast = p.onHand + p.incoming - p.outgoing;
  const quick = [
    { type: "receipts", label: "Receive", icon: ArrowDownToLine },
    { type: "deliveries", label: "Deliver", icon: Truck },
    { type: "transfers", label: "Transfer", icon: ArrowLeftRight },
    { type: "adjustments", label: "Count", icon: SlidersHorizontal },
  ];

  return (
    <div>
      <PageHeader
        eyebrow={
          <>
            <Link to="/products" className="hover:underline">
              Products
            </Link>{" "}
            / <span className="font-mono">{p.sku}</span>
          </>
        }
        title={p.name}
        subtitle={`${p.category?.name ?? "Uncategorised"} · measured in ${p.uom}`}
        actions={
          <>
            <StockBadge status={p.status} />
            <Link to={`/products/labels?ids=${p.id}`}>
              <Button size="sm" variant="subtle" icon={BarcodeIcon}>
                Print label
              </Button>
            </Link>
          </>
        }
      />

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="min-w-0 space-y-8 lg:col-span-2">
          <Card>
            <CardHeader title="Stock by location" subtitle={`${p.stock.length} location${p.stock.length === 1 ? " holds" : "s hold"} this product`} />
            {p.stock.length === 0 ? (
              <p className="border-t border-hairline px-6 py-6 text-sm text-muted">No stock anywhere yet. Receive it to get started.</p>
            ) : (
              <ul className="divide-y divide-hairline border-t border-hairline">
                {p.stock.map((s) => (
                  <li key={s.locationId} className="flex items-center gap-4 px-6 py-4">
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-canvas">
                      <MapPin className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{s.location}</p>
                      <p className="truncate text-xs text-muted">
                        {s.warehouse.name} · updated {fmtRelative(s.updatedAt)}
                      </p>
                    </div>
                    <div className="w-32 text-right">
                      <p className="text-sm font-semibold">
                        {fmtQty(s.quantity)} <span className="font-normal text-muted">{p.uom}</span>
                      </p>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-canvas">
                        <div className="h-full rounded-full bg-ink" style={{ width: `${p.onHand > 0 ? (s.quantity / p.onHand) * 100 : 0}%` }} />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-6">
            <h2 className="mb-5 text-lg font-semibold tracking-tight">Details</h2>
            {detailsForm}
            {isManager ? (
            <div className="mt-6 flex justify-end gap-3 border-t border-hairline pt-5">
              {dirty && (
                <Button variant="ghost" onClick={() => setDirty(false)}>
                  Discard
                </Button>
              )}
              <Button type="submit" form="product-form" loading={save.isPending} disabled={!dirty}>
                Save changes
              </Button>
            </div>
            ) : (
              <p className="mt-6 flex items-center gap-2 border-t border-hairline pt-5 text-sm text-muted">
                <Lock className="size-4" /> Product details, costs and reordering rules are managed by inventory managers.
              </p>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Recent moves"
              subtitle="From the stock ledger"
              action={
                <Link to={`/moves?productId=${p.id}`} className="text-sm font-semibold underline underline-offset-2">
                  Full history
                </Link>
              }
            />
            {detail.data!.moves.length === 0 ? (
              <EmptyState icon={History} title="No moves yet" className="border-t border-hairline py-8" />
            ) : (
              <div className="border-t border-hairline">
                <ActivityFeed moves={detail.data!.moves} showProduct={false} />
              </div>
            )}
          </Card>
        </div>

        <aside className="lg:sticky lg:top-28 lg:self-start">
          <Card className="p-6 shadow-pop">
            <p className="text-sm text-muted">Total on hand</p>
            <p className="mt-1 text-[40px] leading-none font-semibold tracking-tight">
              {fmtQty(p.onHand)} <span className="text-lg font-medium text-muted">{p.uom}</span>
            </p>
            <dl className="mt-6 space-y-3 border-t border-hairline pt-5 text-[15px]">
              <div className="flex justify-between">
                <dt className="text-muted">Free to use</dt>
                <dd className="font-semibold">{fmtQty(p.freeQty)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Per unit cost</dt>
                <dd className="font-semibold">{fmtMoney(p.unitCost)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Incoming (open receipts)</dt>
                <dd className="font-semibold text-ok">+{fmtQty(p.incoming)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Outgoing (open deliveries)</dt>
                <dd className="font-semibold text-bad">−{fmtQty(p.outgoing)}</dd>
              </div>
              <div className="flex justify-between border-t border-hairline pt-3">
                <dt className="font-semibold">Forecast</dt>
                <dd className="font-semibold">{fmtQty(forecast)}</dd>
              </div>
            </dl>
            <div className="mt-5 rounded-xl bg-canvas p-4 text-sm">
              <p className="font-semibold">Reordering rule</p>
              <p className="mt-1 text-muted">
                {p.minQty != null ? `Reorder at ${fmtQty(p.minQty)}${p.maxQty != null ? `, up to ${fmtQty(p.maxQty)}` : ""} ${p.uom}` : "No rule set — add a min quantity to get alerts."}
              </p>
            </div>
            {isManager && p.suggestedQty != null && p.status !== "in" && (
              <Button
                variant="primary"
                size="lg"
                className="mt-5 w-full"
                loading={replenish.isPending}
                onClick={() => replenish.mutate(undefined, { onSuccess: ({ document }) => navigate(docPath(document)) })}
              >
                Reorder {fmtQty(p.suggestedQty)} {p.uom}
              </Button>
            )}
            <div className="mt-5 grid grid-cols-4 gap-2">
              {quick.map((a) => (
                <Link
                  key={a.type}
                  to={`/operations/${a.type}/new`}
                  state={{ productId: p.id }}
                  className="flex flex-col items-center gap-1.5 rounded-xl border border-hairline py-3 text-xs font-semibold transition hover:border-ink"
                >
                  <a.icon className="size-4" />
                  {a.label}
                </Link>
              ))}
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
