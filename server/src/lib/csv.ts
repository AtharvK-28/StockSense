import { Prisma } from "@prisma/client";

export type Cell = string | number | boolean | Date | Prisma.Decimal | null | undefined;

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-09-26 14:05" in the server's local time — what spreadsheets parse as a date. */
export function fmtDateTime(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function cellText(value: Cell): string {
  if (value == null) return "";
  if (value instanceof Date) return fmtDateTime(value);
  if (Prisma.Decimal.isDecimal(value)) return value.toString();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  // Text that a spreadsheet would run as a formula is prefixed with ' (CSV injection).
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** RFC 4180 CSV with a UTF-8 BOM so Excel shows ₹ and non-English names correctly. */
export function toCsv(header: string[], rows: Cell[][]) {
  const line = (cells: Cell[]) =>
    cells
      .map((c) => {
        const text = cellText(c);
        return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
      })
      .join(",");
  return "﻿" + [line(header), ...rows.map(line)].join("\r\n") + "\r\n";
}

/** The same table as an array of objects keyed by column name. */
export function toJsonRecords(header: string[], rows: Cell[][]) {
  return rows.map((row) =>
    Object.fromEntries(
      header.map((h, i) => {
        const v = row[i];
        return [h, v == null ? null : Prisma.Decimal.isDecimal(v) ? v.toNumber() : v instanceof Date ? v.toISOString() : v];
      }),
    ),
  );
}
