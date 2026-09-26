import { code128Widths } from "../lib/code128";

/**
 * Code 128 barcode as crisp SVG. Always black on white (scanners need contrast), with the
 * required 10-module quiet zone on each side.
 */
export function Barcode({ value, height = 56, module = 2, showText = true }: { value: string; height?: number; module?: number; showText?: boolean }) {
  let widths: number[];
  try {
    widths = code128Widths(value);
  } catch {
    return <span className="text-xs text-bad">Can't encode “{value}”</span>;
  }
  const quiet = 10 * module;
  const total = widths.reduce((s, w) => s + w, 0) * module + quiet * 2;
  const textH = showText ? 16 : 0;
  let x = quiet;
  const bars: { x: number; w: number }[] = [];
  widths.forEach((w, i) => {
    if (i % 2 === 0) bars.push({ x, w: w * module });
    x += w * module;
  });
  return (
    <svg
      viewBox={`0 0 ${total} ${height + textH}`}
      width={total}
      height={height + textH}
      role="img"
      aria-label={`Barcode ${value}`}
      className="max-w-full"
      shapeRendering="crispEdges"
    >
      <rect width={total} height={height + textH} fill="#fff" />
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.w} height={height} fill="#000" />
      ))}
      {showText && (
        <text x={total / 2} y={height + 13} textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize={12} fill="#000">
          {value}
        </text>
      )}
    </svg>
  );
}
