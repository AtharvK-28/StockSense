import { z } from "zod";
import { prisma } from "../db";

/** Company-wide settings. Add a field here (with a default) to introduce a new setting. */
export const settingsSchema = z.object({
  /** Create a draft receipt automatically when a validation drops a product to its reorder point. */
  autoReorder: z.boolean(),
});
export type Settings = z.infer<typeof settingsSchema>;

const DEFAULTS: Settings = { autoReorder: true };

export async function getSettings(): Promise<Settings> {
  const rows = await prisma.appSetting.findMany();
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return settingsSchema.parse({ ...DEFAULTS, ...stored });
}

export async function updateSettings(patch: Partial<Settings>) {
  await prisma.$transaction(
    Object.entries(patch).map(([key, value]) =>
      prisma.appSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } }),
    ),
  );
  return getSettings();
}
