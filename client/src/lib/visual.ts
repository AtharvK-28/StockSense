import { Armchair, Box, Cpu, Layers, type LucideIcon, Package, Shirt, Wrench } from "lucide-react";

const TILES = [
  { bg: "#FFE8EC", fg: "#D70466" },
  { bg: "#E8F0FF", fg: "#2C5BDB" },
  { bg: "#E6F6EC", fg: "#0A7A33" },
  { bg: "#FFF1DE", fg: "#B25E09" },
  { bg: "#F0EAFF", fg: "#6B3FD1" },
  { bg: "#E2F5F6", fg: "#0B7B85" },
];

const ICONS: [RegExp, LucideIcon][] = [
  [/raw|material|metal|steel/i, Layers],
  [/furniture|chair|desk/i, Armchair],
  [/pack|box|carton/i, Package],
  [/hardware|tool|bolt|screw/i, Wrench],
  [/electr|device|chip/i, Cpu],
  [/apparel|cloth|textile/i, Shirt],
];

function hash(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

/** A stable colour + icon per category, standing in for product photos. */
export function categoryVisual(name: string | null | undefined) {
  const key = name ?? "Uncategorised";
  // Known kinds get their own colour so common categories never clash; others fall back to a hash.
  const known = ICONS.findIndex(([re]) => re.test(key));
  const tile = TILES[(known >= 0 ? known : hash(key)) % TILES.length]!;
  return { ...tile, icon: known >= 0 ? ICONS[known]![1] : Box };
}

export const UOM_OPTIONS = ["Units", "kg", "g", "L", "m", "Box", "Pack", "Rolls", "Pairs"];
