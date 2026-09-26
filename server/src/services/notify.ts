import type { Role } from "@prisma/client";
import { prisma } from "../db";
import { broadcast } from "../lib/events";

export interface NotificationInput {
  kind: string;
  title: string;
  body?: string | null;
  link?: string | null;
}

/**
 * Sends an in-app notification to everyone with `role`, and/or specific users. The acting user is
 * skipped (you don't need to be told about your own action).
 */
export async function notify(
  to: { role?: Role; userIds?: (string | null | undefined)[]; except?: string | null },
  n: NotificationInput,
) {
  const ids = new Set<string>();
  if (to.role) {
    for (const u of await prisma.user.findMany({ where: { role: to.role }, select: { id: true } })) ids.add(u.id);
  }
  for (const id of to.userIds ?? []) if (id) ids.add(id);
  if (to.except) ids.delete(to.except);
  if (ids.size === 0) return;
  await prisma.notification.createMany({
    data: [...ids].map((userId) => ({ userId, kind: n.kind, title: n.title, body: n.body ?? null, link: n.link ?? null })),
  });
  broadcast("notifications");
}
