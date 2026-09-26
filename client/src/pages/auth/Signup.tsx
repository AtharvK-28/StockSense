import { useMutation } from "@tanstack/react-query";
import { clsx } from "clsx";
import { ClipboardList, Forklift } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button, ErrorNote } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import type { Role, User } from "../../lib/types";
import { AuthShell, FloatingInput, InputStack, PasswordRules, loginIdOk, passwordOk } from "./AuthShell";

const ROLES: { value: Role; title: string; blurb: string; icon: typeof Forklift }[] = [
  { value: "manager", title: "Inventory manager", blurb: "Oversee stock, approve operations, configure warehouses", icon: ClipboardList },
  { value: "staff", title: "Warehouse staff", blurb: "Receive, pick, pack, transfer and count stock", icon: Forklift },
];

export function Signup() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ loginId: "", name: "", email: "", password: "", confirm: "", role: "manager" as Role });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });

  const signup = useMutation({
    mutationFn: () =>
      api<{ user: User }>("/auth/signup", {
        method: "POST",
        body: { loginId: form.loginId, name: form.name || undefined, email: form.email, password: form.password, role: form.role },
      }),
    onSuccess: ({ user }) => {
      setUser(user);
      navigate("/", { replace: true });
    },
  });

  const loginIdInvalid = form.loginId.length > 0 && !loginIdOk(form.loginId);
  const mismatch = form.confirm.length > 0 && form.confirm !== form.password;

  return (
    <AuthShell
      title="Sign up"
      heading="Create your StockSense account"
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="font-semibold text-ink underline underline-offset-2">
            Log in
          </Link>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          signup.mutate();
        }}
        className="space-y-5"
      >
        <div>
          <InputStack invalid={loginIdInvalid || mismatch}>
            <FloatingInput label="Enter Login ID" autoComplete="username" required value={form.loginId} onChange={set("loginId")} maxLength={12} />
            <FloatingInput label="Enter Email ID" type="email" autoComplete="email" required value={form.email} onChange={set("email")} />
            <FloatingInput label="Full name (optional)" autoComplete="name" value={form.name} onChange={set("name")} />
            <FloatingInput label="Enter Password" type="password" autoComplete="new-password" required value={form.password} onChange={set("password")} />
            <FloatingInput label="Re-Enter Password" type="password" autoComplete="new-password" required value={form.confirm} onChange={set("confirm")} />
          </InputStack>
          <p className={clsx("mt-2 text-[13px]", loginIdInvalid ? "text-bad" : "text-muted")}>
            Login ID: 6–12 characters — letters, numbers, dot or underscore. Must be unique.
          </p>
          {mismatch && <p className="mt-1 text-[13px] text-bad">Passwords don't match</p>}
          {form.password && <PasswordRules password={form.password} />}
        </div>

        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Your role</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {ROLES.map((r) => (
              <label
                key={r.value}
                className={clsx(
                  "flex cursor-pointer flex-col gap-2 rounded-xl border p-4 transition",
                  form.role === r.value ? "border-ink bg-canvas ring-1 ring-ink" : "border-line hover:border-ink",
                )}
              >
                <input type="radio" name="role" value={r.value} checked={form.role === r.value} onChange={() => setForm({ ...form, role: r.value })} className="sr-only" />
                <r.icon className="size-6" strokeWidth={1.6} />
                <span className="text-[15px] font-semibold">{r.title}</span>
                <span className="text-[13px] leading-snug text-muted">{r.blurb}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {signup.isError && <ErrorNote>{errorMessage(signup.error)}</ErrorNote>}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full"
          loading={signup.isPending}
          disabled={!loginIdOk(form.loginId) || !passwordOk(form.password) || form.password !== form.confirm}
        >
          Sign up
        </Button>
      </form>
    </AuthShell>
  );
}
