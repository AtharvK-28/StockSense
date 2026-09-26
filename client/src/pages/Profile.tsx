import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Lock, LogOut, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Avatar, Button, Card, ErrorNote, Field, Input, PageHeader, Skeleton } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDate } from "../lib/format";
import { useAction } from "../lib/queries";
import type { User } from "../lib/types";
import { PasswordRules, passwordOk } from "./auth/AuthShell";

const PERMISSIONS: { label: string; staff: boolean; note?: string }[] = [
  { label: "View dashboard, stock and move history", staff: true },
  { label: "Create receipts, deliveries and transfers", staff: true },
  { label: "Pick, pack and validate operations", staff: true },
  { label: "Count stock and submit adjustments", staff: true },
  { label: "Approve stock adjustments", staff: false, note: "Your counts go to a manager" },
  { label: "Cancel operations", staff: false },
  { label: "Manage products, categories and costs", staff: false },
  { label: "Set reordering rules and reorder", staff: false },
  { label: "Configure warehouses and locations", staff: false },
  { label: "Manage the team and roles", staff: false },
];

export function Profile() {
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();
  const profile = useQuery({
    queryKey: ["profile"],
    queryFn: () => api<{ user: User; stats: { created: number; validated: number } }>("/profile"),
  });
  const [details, setDetails] = useState({ name: user?.name ?? "", email: user?.email ?? "" });
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  const [twoFactorPassword, setTwoFactorPassword] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [setup, setSetup] = useState<{ qrCode: string; secret: string } | null>(null);

  useEffect(() => {
    if (user) setDetails({ name: user.name, email: user.email });
  }, [user]);

  const saveDetails = useAction(() => api<{ user: User }>("/profile", { method: "PUT", body: details }), { success: "Profile updated" });
  const savePassword = useAction(() => api("/profile/password", { method: "PUT", body: pw }), { success: "Password changed" });
  const beginTwoFactor = useMutation({
    mutationFn: () => api<{ qrCode: string; secret: string }>("/profile/2fa/setup", { method: "POST", body: { currentPassword: twoFactorPassword } }),
    onSuccess: (result) => setSetup(result),
  });
  const confirmTwoFactor = useMutation({
    mutationFn: () => api<{ user: User }>("/profile/2fa/confirm", { method: "POST", body: { code: twoFactorCode } }),
    onSuccess: ({ user: updated }) => { setUser(updated); setSetup(null); setTwoFactorCode(""); setTwoFactorPassword(""); },
  });
  const disableTwoFactor = useMutation({
    mutationFn: () => api<{ user: User }>("/profile/2fa", { method: "DELETE", body: { currentPassword: twoFactorPassword, code: twoFactorCode } }),
    onSuccess: ({ user: updated }) => { setUser(updated); setTwoFactorCode(""); setTwoFactorPassword(""); },
  });

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
            <p className="text-sm text-muted">@{user.loginId}</p>
            <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-muted">
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
            <h2 className="text-lg font-semibold tracking-tight">What you can do</h2>
            <p className="mt-1 text-sm text-muted">
              {user.role === "manager"
                ? "As an inventory manager you control the catalog, approve stock corrections and run settings."
                : "As warehouse staff you run the day-to-day operations. Managers own the catalog and approve stock corrections."}
            </p>
            <ul className="mt-5 grid gap-x-6 gap-y-2.5 text-[15px] sm:grid-cols-2">
              {PERMISSIONS.map((perm) => {
                const allowed = user.role === "manager" || perm.staff;
                return (
                  <li key={perm.label} className={allowed ? "flex items-start gap-2.5" : "flex items-start gap-2.5 text-muted"}>
                    {allowed ? <Check className="mt-0.5 size-4 shrink-0 text-ok" strokeWidth={3} /> : <Lock className="mt-0.5 size-4 shrink-0" />}
                    <span>
                      {perm.label}
                      {!allowed && perm.note && <span className="block text-xs">{perm.note}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>

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

          <Card className="p-6">
            <h2 className="text-lg font-semibold tracking-tight">Two-step verification</h2>
            <p className="mt-1 text-sm text-muted">Protect sign-in with a code from Google Authenticator or another TOTP app.</p>
            {user.totpEnabled ? (
              <form className="mt-5 grid gap-5 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); disableTwoFactor.mutate(); }}>
                <Field label="Current password"><Input type="password" required value={twoFactorPassword} onChange={(e) => setTwoFactorPassword(e.target.value)} /></Field>
                <Field label="Authenticator code"><Input inputMode="numeric" autoComplete="one-time-code" required value={twoFactorCode} onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, "").slice(0, 6))} /></Field>
                {disableTwoFactor.isError && <div className="sm:col-span-2"><ErrorNote>{errorMessage(disableTwoFactor.error)}</ErrorNote></div>}
                <div className="flex justify-end sm:col-span-2"><Button type="submit" variant="outline" loading={disableTwoFactor.isPending} disabled={twoFactorCode.length !== 6 || !twoFactorPassword}>Disable two-step verification</Button></div>
              </form>
            ) : setup ? (
              <div className="mt-5 grid gap-5 sm:grid-cols-[240px_1fr] sm:items-start">
                <img src={setup.qrCode} alt="Scan this QR code with your authenticator app" className="size-60 rounded-lg border border-hairline p-2" />
                <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); confirmTwoFactor.mutate(); }}>
                  <p className="text-sm text-muted">Scan the QR code, then enter the current 6-digit code to finish setup.</p>
                  <p className="break-all rounded-lg bg-soft p-3 font-mono text-xs">Manual key: {setup.secret}</p>
                  <Field label="Authenticator code"><Input inputMode="numeric" autoComplete="one-time-code" required value={twoFactorCode} onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, "").slice(0, 6))} /></Field>
                  {confirmTwoFactor.isError && <ErrorNote>{errorMessage(confirmTwoFactor.error)}</ErrorNote>}
                  <Button type="submit" loading={confirmTwoFactor.isPending} disabled={twoFactorCode.length !== 6}>Confirm setup</Button>
                </form>
              </div>
            ) : (
              <form className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); beginTwoFactor.mutate(); }}>
                <Field label="Current password" className="flex-1"><Input type="password" required value={twoFactorPassword} onChange={(e) => setTwoFactorPassword(e.target.value)} /></Field>
                {beginTwoFactor.isError && <ErrorNote>{errorMessage(beginTwoFactor.error)}</ErrorNote>}
                <Button type="submit" loading={beginTwoFactor.isPending} disabled={!twoFactorPassword}>Set up authenticator</Button>
              </form>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
