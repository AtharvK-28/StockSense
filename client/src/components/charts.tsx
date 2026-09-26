import { clsx } from "clsx";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";

/*
 * Small hand-rolled SVG charts (no chart library). Specs follow the dataviz method:
 * 2px lines, 10% area wash, bars <= 24px with a 4px rounded data-end and square baseline,
 * hairline recessive grid, crosshair / per-mark tooltips, text in text tokens (never series color).
 */

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Clean axis ticks: 0 and ~4 round steps up to at least `max`. */
export function niceTicks(max: number, count = 4) {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1]! < max) ticks.push(ticks[ticks.length - 1]! + step);
  return ticks;
}

/** A bar path with a 4px rounded data-end and a square baseline. `h` may be negative (downward bar). */
function barPath(x: number, base: number, w: number, h: number, r = 4) {
  if (h === 0) return "";
  const up = h > 0;
  const top = up ? base - h : base;
  const bottom = up ? base : base - h;
  const rr = Math.min(r, Math.abs(h), w / 2);
  return up
    ? `M${x},${bottom} V${top + rr} Q${x},${top} ${x + rr},${top} H${x + w - rr} Q${x + w},${top} ${x + w},${top + rr} V${bottom} Z`
    : `M${x},${top} V${bottom - rr} Q${x},${bottom} ${x + rr},${bottom} H${x + w - rr} Q${x + w},${bottom} ${x + w},${bottom - rr} V${top} Z`;
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(x + 12, 0), Math.max(width - 190, 0));
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 min-w-40 rounded-xl border border-hairline bg-white px-3 py-2.5 text-sm shadow-pop"
      style={{ left, top: Math.max(y - 12, 0) }}
    >
      {children}
    </div>
  );
}

function TooltipRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-0.5 w-3 rounded-full" style={{ background: color }} />
      <span className="font-semibold text-ink tabular-nums">{value}</span>
      <span className="text-muted">{label}</span>
    </div>
  );
}

/** Collapsible table view — every chart's values are reachable without hovering. */
export function ChartTable({ caption, columns, rows }: { caption: string; columns: string[]; rows: (string | number)[][] }) {
  return (
    <details className="group mt-3 text-sm">
      <summary className="cursor-pointer list-none text-sm font-semibold text-muted underline underline-offset-2 hover:text-ink">
        <span className="group-open:hidden">Show data table</span>
        <span className="hidden group-open:inline">Hide data table</span>
      </summary>
      <div className="mt-3 max-h-64 overflow-auto rounded-xl border border-hairline">
        <table className="w-full text-left">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 bg-canvas text-xs text-muted">
            <tr>
              {columns.map((c, i) => (
                <th key={c} className={clsx("px-3 py-2 font-semibold", i > 0 && "text-right")}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} className="border-t border-hairline">
                {r.map((cell, i) => (
                  <td key={i} className={clsx("px-3 py-1.5", i > 0 && "text-right tabular-nums")}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

const PAD = { top: 16, right: 72, bottom: 28, left: 64 };

/** Single-series area/line over time with a crosshair that snaps to the nearest day. */
export function AreaChart({
  data,
  format,
  formatTick = format,
  label,
  height = 240,
}: {
  data: { date: string; value: number }[];
  format: (v: number) => string;
  formatTick?: (v: number) => string;
  label: string;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const w = Math.max(width, 280);
  const innerW = w - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const ticks = niceTicks(Math.max(...data.map((d) => d.value), 0));
  const yMax = ticks[ticks.length - 1]!;
  const x = (i: number) => PAD.left + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / yMax) * innerH;
  const line = data.map((d, i) => `${i ? "L" : "M"}${x(i)},${y(d.value)}`).join(" ");
  const area = `${line} L${x(data.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
  const last = data[data.length - 1];
  const dateLabel = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const xTickIdx = [...new Set([0, Math.round((data.length - 1) / 3), Math.round((2 * (data.length - 1)) / 3), data.length - 1])];

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * w;
    const i = Math.round(((px - PAD.left) / innerW) * (data.length - 1));
    setHover(Math.min(Math.max(i, 0), data.length - 1));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") setHover((h) => Math.max((h ?? data.length) - 1, 0));
    if (e.key === "ArrowRight") setHover((h) => Math.min((h ?? -1) + 1, data.length - 1));
  };
  const h = hover != null ? data[hover] : null;

  return (
    <div ref={ref} className="relative">
      {width > 0 && data.length > 0 && (
        <svg
          width={w}
          height={height}
          role="img"
          aria-label={label}
          tabIndex={0}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover(data.length - 1)}
          onBlur={() => setHover(null)}
          onKeyDown={onKey}
          className="block touch-pan-y outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={w - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--color-hairline)" strokeWidth={1} />
              <text x={PAD.left - 10} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular-nums">
                {formatTick(t)}
              </text>
            </g>
          ))}
          {xTickIdx.map((i) => (
            <text key={i} x={x(i)} y={height - 8} textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"} className="fill-muted text-[11px]">
              {dateLabel(data[i]!.date)}
            </text>
          ))}
          <path d={area} fill="var(--color-series-1)" opacity={0.1} />
          <path d={line} fill="none" stroke="var(--color-series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {last && (
            <>
              <circle cx={x(data.length - 1)} cy={y(last.value)} r={4} fill="var(--color-series-1)" stroke="var(--color-white)" strokeWidth={2} />
              <text x={x(data.length - 1) + 10} y={y(last.value)} dy="0.32em" className="fill-ink text-xs font-semibold">
                {formatTick(last.value)}
              </text>
            </>
          )}
          {h && (
            <>
              <line x1={x(hover!)} x2={x(hover!)} y1={PAD.top} y2={y(0)} stroke="var(--color-muted)" strokeWidth={1} />
              <circle cx={x(hover!)} cy={y(h.value)} r={5} fill="var(--color-series-1)" stroke="var(--color-white)" strokeWidth={2} />
            </>
          )}
        </svg>
      )}
      {h && (
        <Tooltip x={x(hover!)} y={y(h.value)} width={w}>
          <p className="mb-1 text-xs text-muted">{new Date(h.date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</p>
          <TooltipRow color="var(--color-series-1)" label={label} value={format(h.value)} />
        </Tooltip>
      )}
    </div>
  );
}

/** Two series mirrored around one baseline (e.g. received above, shipped below) — one axis, one scale. */
export function MirrorColumns({
  data,
  up,
  down,
  format,
  height = 240,
}: {
  data: { date: string; up: number; down: number }[];
  up: string;
  down: string;
  format: (v: number) => string;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const w = Math.max(width, 280);
  const pad = { ...PAD, right: 16 };
  const innerW = w - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const ticks = niceTicks(Math.max(...data.map((d) => Math.max(d.up, d.down)), 0), 2);
  const max = ticks[ticks.length - 1]!;
  const base = pad.top + innerH / 2;
  const scale = (v: number) => (v / max) * (innerH / 2);
  const band = innerW / Math.max(data.length, 1);
  const barW = Math.min(24, Math.max(band - 2, 2) * 0.7);
  const cx = (i: number) => pad.left + band * i + band / 2;
  const h = hover != null ? data[hover] : null;
  const dateLabel = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const xTickIdx = [...new Set([0, Math.round((data.length - 1) / 2), data.length - 1])];

  return (
    <div ref={ref} className="relative">
      <div className="mb-3 flex gap-5 text-sm text-muted" aria-hidden="true">
        <span className="flex items-center gap-2">
          <span className="size-2.5 rounded-sm" style={{ background: "var(--color-series-1)" }} /> {up}
        </span>
        <span className="flex items-center gap-2">
          <span className="size-2.5 rounded-sm" style={{ background: "var(--color-series-2)" }} /> {down}
        </span>
      </div>
      {width > 0 && (
        <svg width={w} height={height} role="img" aria-label={`${up} and ${down} per day`} className="block" onPointerLeave={() => setHover(null)}>
          {[...ticks.slice(1).map((t) => -t), 0, ...ticks.slice(1)].map((t) => (
            <g key={t}>
              <line
                x1={pad.left}
                x2={w - pad.right}
                y1={base - scale(t)}
                y2={base - scale(t)}
                stroke={t === 0 ? "var(--color-line)" : "var(--color-hairline)"}
                strokeWidth={1}
              />
              <text x={pad.left - 10} y={base - scale(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular-nums">
                {format(Math.abs(t))}
              </text>
            </g>
          ))}
          {data.map((d, i) => (
            <g key={d.date} opacity={hover == null || hover === i ? 1 : 0.55}>
              <path d={barPath(cx(i) - barW / 2, base - 1, barW, scale(d.up))} fill="var(--color-series-1)" />
              <path d={barPath(cx(i) - barW / 2, base + 1, barW, -scale(d.down))} fill="var(--color-series-2)" />
              {/* Hit target: the whole day's band, bigger than either bar. */}
              <rect
                x={pad.left + band * i}
                y={pad.top}
                width={band}
                height={innerH}
                fill="transparent"
                tabIndex={0}
                aria-label={`${dateLabel(d.date)}: ${format(d.up)} ${up.toLowerCase()}, ${format(d.down)} ${down.toLowerCase()}`}
                onPointerEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                className="outline-none"
              />
            </g>
          ))}
          {xTickIdx.map((i) => (
            <text key={i} x={cx(i)} y={height - 8} textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"} className="fill-muted text-[11px]">
              {dateLabel(data[i]!.date)}
            </text>
          ))}
        </svg>
      )}
      {h && (
        <Tooltip x={cx(hover!)} y={base - scale(h.up)} width={w}>
          <p className="mb-1 text-xs text-muted">{new Date(h.date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</p>
          <TooltipRow color="var(--color-series-1)" label={up} value={format(h.up)} />
          <TooltipRow color="var(--color-series-2)" label={down} value={format(h.down)} />
        </Tooltip>
      )}
    </div>
  );
}

/** Single-series horizontal bars with the value at each bar's tip. */
export function HBars({ items, format, label }: { items: { label: string; value: number; sub?: string }[]; format: (v: number) => string; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...items.map((i) => i.value), 0) || 1;
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  return (
    <ul className="space-y-3" aria-label={label}>
      {items.map((item, i) => (
        <li
          key={item.label}
          tabIndex={0}
          onPointerEnter={() => setHover(i)}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover(i)}
          onBlur={() => setHover(null)}
          className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ink"
        >
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate font-medium">{item.label}</span>
            <span className="text-xs text-muted">{hover === i ? `${Math.round((item.value / total) * 100)}% of total` : item.sub}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="h-5 flex-1">
              <div
                className="h-full rounded-r-[4px] transition-[filter]"
                style={{ width: `${Math.max((item.value / max) * 100, 1)}%`, background: "var(--color-series-1)", filter: hover === i ? "brightness(1.12)" : undefined }}
              />
            </div>
            <span className="w-24 shrink-0 text-right text-sm font-semibold tabular-nums">{format(item.value)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
