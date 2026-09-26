import { Prisma } from "@prisma/client";
import { prisma } from "../db";

type Client = Prisma.TransactionClient | typeof prisma;

export type Changes = Record<string, { from: unknown; to: unknown }>;

const plain = (v: unknown) => (Prisma.Decimal.isDecimal(v) ? Number(v) : v instanceof Date ? v.toISOString() : (v ?? null));

/** Field-by-field differences between two records, limited to `keys`. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>, keys: string[]): Changes {
  const changes: Changes = {};
  for (const key of keys) {
    const from = plain(before[key]);
    const to = plain(after[key]);
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[key] = { from, to };
  }
  return changes;
}

/**
 * Records who changed what outside the stock ledger. Failing to write an audit row never breaks the
 * user's action, so errors are logged and swallowed.
 */
export async function audit(
  client: Client,
  entry: {
    userId: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    summary: string;
    changes?: Changes | null;
  },
) {
  if (entry.changes && Object.keys(entry.changes).length === 0 && entry.action.endsWith(".update")) return;
  try {
    await client.auditLog.create({
      data: {
        userId: entry.userId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        summary: entry.summary,
        changes: entry.changes ? (entry.changes as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });
  } catch (err) {
    console.error("[audit] failed to record", entry.action, err);
  }
}
