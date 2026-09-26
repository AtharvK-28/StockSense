import { useQuery } from "@tanstack/react-query";
import { Lock, Users } from "lucide-react";
import { RolePill } from "../../components/Layout";
import { ExportMenu } from "../../components/ExportMenu";
import { Avatar, Card, EmptyState, PageHeader, Select, Skeleton } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth, useIsManager } from "../../lib/auth";
import { fmtDate } from "../../lib/format";
import { useAction } from "../../lib/queries";
import type { Role, User } from "../../lib/types";

type Member = User & { created: number; validated: number };

export function Team() {
  const { user, setUser } = useAuth();
  const isManager = useIsManager();
  const team = useQuery({
    queryKey: ["users"],
    queryFn: () => api<{ items: Member[] }>("/users").then((r) => r.items),
    enabled: isManager,
  });
  const changeRole = useAction(
    ({ id, role }: { id: string; role: Role }) => api<{ user: User }>(`/users/${id}/role`, { method: "PUT", body: { role } }),
    { success: "Role updated" },
  );

  if (!isManager) {
    return (
      <EmptyState icon={Lock} title="Only inventory managers can manage the team">
        Ask a manager if you need your role changed.
      </EmptyState>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow="Settings"
        title="Team"
        subtitle="Everyone who can sign in. New sign-ups join as warehouse staff — promote the people who should manage the catalog, approve counts and configure warehouses."
        actions={<ExportMenu dataset="team" />}
      />
      <Card>
        {!team.data ? (
          <div className="space-y-3 p-6">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : team.data.length === 0 ? (
          <EmptyState icon={Users} title="No users yet" />
        ) : (
          <ul className="divide-y divide-hairline">
            {team.data.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-4 px-6 py-4">
                <Avatar name={m.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {m.name} {m.id === user?.id && <span className="font-normal text-muted">(you)</span>}
                  </p>
                  <p className="truncate text-sm text-muted">
                    @{m.loginId} · {m.email} · joined {fmtDate(m.createdAt)}
                  </p>
                  <p className="text-xs text-muted">
                    {m.created} operations created · {m.validated} validated
                  </p>
                </div>
                <RolePill role={m.role} />
                <div className="w-48">
                  <Select
                    aria-label={`Role for ${m.name}`}
                    className="h-10"
                    value={m.role}
                    disabled={changeRole.isPending}
                    onChange={(e) =>
                      changeRole.mutate(
                        { id: m.id, role: e.target.value as Role },
                        { onSuccess: ({ user: updated }) => updated.id === user?.id && setUser(updated) },
                      )
                    }
                  >
                    <option value="manager">Inventory manager</option>
                    <option value="staff">Warehouse staff</option>
                  </Select>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
