import { clsx } from "clsx";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { fmtQty } from "../lib/format";
import type { LocationOption, ProductRow } from "../lib/types";
import { Select } from "./ui";

export function ProductPicker({
  value,
  onChange,
  products,
  invalid,
}: {
  value: string;
  onChange: (id: string) => void;
  products: ProductRow[];
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [highlight, setHighlight] = useState(0);
  const selected = products.find((p) => p.id === value);

  const matches = useMemo(() => {
    const term = q.trim().toLowerCase();
    return products.filter((p) => !term || p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term)).slice(0, 8);
  }, [products, q]);

  const choose = (id: string) => {
    onChange(id);
    setOpen(false);
    setQ("");
  };

  return (
    <div className="relative min-w-[220px]">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
      <input
        value={open ? q : (selected?.name ?? "")}
        placeholder="Search product or SKU"
        onFocus={() => {
          setOpen(true);
          setQ("");
          setHighlight(0);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          setQ(e.target.value);
          setHighlight(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter" && open && matches[highlight]) {
            e.preventDefault();
            choose(matches[highlight].id);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        aria-label="Product"
        aria-invalid={invalid || undefined}
        className={clsx(
          "h-11 w-full rounded-lg border bg-white pr-3 pl-9 text-[15px] outline-none transition placeholder:text-subtle focus:border-ink focus:ring-1 focus:ring-ink",
          invalid ? "border-bad" : "border-line hover:border-muted",
        )}
      />
      {selected && !open && <p className="mt-1 pl-1 font-mono text-[11px] text-muted">{selected.sku}</p>}
      {open && (
        <ul className="animate-rise-in absolute inset-x-0 top-12 z-30 max-h-72 overflow-y-auto rounded-xl border border-hairline bg-white py-1.5 shadow-pop">
          {matches.length === 0 && <li className="px-4 py-3 text-sm text-muted">No products match</li>}
          {matches.map((p, i) => (
            <li
              key={p.id}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(p.id);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={clsx("flex cursor-pointer items-center gap-3 px-4 py-2.5", i === highlight && "bg-canvas")}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{p.name}</span>
                <span className="block font-mono text-[11px] text-muted">{p.sku}</span>
              </span>
              <span className="text-xs whitespace-nowrap text-muted">
                {fmtQty(p.onHand)} {p.uom}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function LocationSelect({
  value,
  onChange,
  locations,
  placeholder = "Choose a location",
  exclude,
  ...props
}: {
  value: string;
  onChange: (id: string) => void;
  locations: LocationOption[];
  placeholder?: string;
  exclude?: string;
  id?: string;
  disabled?: boolean;
}) {
  const groups = useMemo(() => {
    const byWarehouse = new Map<string, { name: string; items: LocationOption[] }>();
    for (const l of locations) {
      const g = byWarehouse.get(l.warehouse.id) ?? { name: l.warehouse.name, items: [] };
      g.items.push(l);
      byWarehouse.set(l.warehouse.id, g);
    }
    return [...byWarehouse.values()];
  }, [locations]);

  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} {...props}>
      <option value="">{placeholder}</option>
      {groups.map((g) => (
        <optgroup key={g.name} label={g.name}>
          {g.items.map((l) => (
            <option key={l.id} value={l.id} disabled={l.id === exclude}>
              {l.warehouse.code} / {l.name}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}
