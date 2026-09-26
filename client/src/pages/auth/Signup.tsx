import { useMutation } from "@tanstack/react-query";
import { clsx } from "clsx";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button, ErrorNote } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import type { User } from "../../lib/types";
import { AuthShell, FloatingInput, InputStack, PasswordRules, loginIdOk, passwordOk } from "./AuthShell";

export function Signup() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ loginId: "", name: "", email: "", password: "", confirm: "" });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });

  const signup = useMutation({
    mutationFn: () =>
      api<{ user: User }>("/auth/signup", {
        method: "POST",
        body: { loginId: form.loginId, name: form.name || undefined, email: form.email, password: form.password },
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

        <p className="rounded-xl bg-canvas px-4 py-3 text-[13px] text-muted">
          New accounts join as <span className="font-semibold text-ink">Warehouse staff</span>. An inventory manager can promote you from
          Settings → Team. (The very first account on a fresh install becomes the manager.)
        </p>

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
