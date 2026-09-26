import { useQuery } from "@tanstack/react-query";
import { LogOut, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Avatar, Button, Card, ErrorNote, Field, Input, PageHeader, Skeleton } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate } from "../lib/format";
import { useAction } from "../lib/queries";
import type { User } from "../lib/types";
import { PasswordRules, passwordOk } from "./auth/AuthShell";

export function Profile() {
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();
  const profile = useQuery({
    queryKey: ["profile"],
    queryFn: () => api<{ user: User; stats: { created: number; validated: number } }>("/profile"),
  });
  const [details, setDetails] = useState({ name: user?.name ?? "", email: user?.email ?? "" });
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });

  useEffect(() => {
    if (user) setDetails({ name: user.name, email: user.email });
  }, [user]);

  const saveDetails = useAction(() => api<{ user: User }>("/profile", { method: "PUT", body: details }), { success: "Profile updated" });
  const savePassword = useAction(() => api("/profile/password", { method: "PUT", body: pw }), { success: "Password changed" });

  if (!user) return null;
  const stats = profile.data?.stats;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="My profile" />
      <div className="grid gap-8 lg:grid-cols-[340px_1fr]">
        <aside className="space-y-6">
          <Card className="flex flex-col items-center p-8 text-center shadow-pop">
            <Avatar name={user.name} size="lg" />
            <h2 className="mt-4 text-[26px] font-semibold tracking-tight">{user.name}</h2>
            <p className="flex items-center gap-1.5 text-sm font-medium text-muted">
              <ShieldCheck className="size-4" />
              {user.role === "manager" ? "Inventory manager" : "Warehouse staff"}
            </p>
            <div className="mt-6 grid w-full grid-cols-2 divide-x divide-hairline border-t border-hairline pt-5">
              <div>
                {stats ? <p className="text-[22px] font-semibold">{stats.created}</p> : <Skeleton className="mx-auto h-7 w-8" />}
                <p className="text-xs text-muted">Operations created</p>
              </div>
              <div>
                {stats ? <p className="text-[22px] font-semibold">{stats.validated}</p> : <Skeleton className="mx-auto h-7 w-8" />}
                <p className="text-xs text-muted">Validated</p>
              </div>
            </div>
            <p className="mt-5 text-xs text-muted">Member since {fmtDate(user.createdAt)}</p>
          </Card>
          <Button
            variant="outline"
            icon={LogOut}
            className="w-full"
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
          >
            Log out
          </Button>
        </aside>

        <div className="space-y-8">
          <Card className="p-6">
            <h2 className="text-lg font-semibold tracking-tight">Personal details</h2>
            <form
              className="mt-5 grid gap-5 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                saveDetails.mutate(undefined, { onSuccess: (r) => setUser(r.user) });
              }}
            >
              <Field label="Full name">
                <Input required value={details.name} onChange={(e) => setDetails({ ...details, name: e.target.value })} />
              </Field>
              <Field label="Email">
                <Input type="email" required value={details.email} onChange={(e) => setDetails({ ...details, email: e.target.value })} />
              </Field>
              {saveDetails.isError && <div className="sm:col-span-2"><ErrorNote>{errorMessage(saveDetails.error)}</ErrorNote></div>}
              <div className="flex justify-end sm:col-span-2">
                <Button type="submit" loading={saveDetails.isPending} disabled={details.name === user.name && details.email === user.email}>
                  Save
                </Button>
              </div>
            </form>
          </Card>

          <Card className="p-6">
            <h2 className="text-lg font-semibold tracking-tight">Change password</h2>
            <p className="mt-1 text-sm text-muted">Forgot it instead? Log out and use “Forgot password” to reset with a one-time code.</p>
            <form
              className="mt-5 grid gap-5 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                savePassword.mutate(undefined, { onSuccess: () => setPw({ currentPassword: "", newPassword: "" }) });
              }}
            >
              <Field label="Current password">
                <Input type="password" autoComplete="current-password" required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
              </Field>
              <Field label="New password">
                <Input type="password" autoComplete="new-password" required value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
                {pw.newPassword && <PasswordRules password={pw.newPassword} />}
              </Field>
              {savePassword.isError && <div className="sm:col-span-2"><ErrorNote>{errorMessage(savePassword.error)}</ErrorNote></div>}
              <div className="flex justify-end sm:col-span-2">
                <Button type="submit" loading={savePassword.isPending} disabled={!pw.currentPassword || !passwordOk(pw.newPassword)}>
                  Update password
                </Button>
              </div>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}
