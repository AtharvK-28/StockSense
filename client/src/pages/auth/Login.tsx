import { useMutation } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Button, ErrorNote } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import type { User } from "../../lib/types";
import { AuthShell, FloatingInput, InputStack } from "./AuthShell";

const DEMO = { email: "manager@stocksense.app", password: "Demo@1234" };

export function Login() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const login = useMutation({
    mutationFn: (body: { email: string; password: string }) => api<{ user: User }>("/auth/login", { method: "POST", body }),
    onSuccess: ({ user }) => {
      setUser(user);
      navigate(from, { replace: true });
    },
  });

  return (
    <AuthShell
      title="Log in"
      heading="Welcome back to StockSense"
      footer={
        <>
          New here?{" "}
          <Link to="/signup" className="font-semibold text-ink underline underline-offset-2">
            Create an account
          </Link>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate({ email, password });
        }}
        className="space-y-4"
      >
        <InputStack invalid={login.isError}>
          <FloatingInput label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <FloatingInput label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </InputStack>
        {login.isError && <ErrorNote>{errorMessage(login.error)}</ErrorNote>}
        <div className="flex justify-end">
          <Link to="/forgot-password" state={{ email }} className="text-sm font-semibold underline underline-offset-2">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={login.isPending}>
          Continue
        </Button>
      </form>

      <div className="my-6 flex items-center gap-4 text-xs text-muted">
        <span className="h-px flex-1 bg-hairline" />
        or
        <span className="h-px flex-1 bg-hairline" />
      </div>
      <Button
        variant="outline"
        size="lg"
        icon={Sparkles}
        className="w-full"
        disabled={login.isPending}
        onClick={() => {
          setEmail(DEMO.email);
          setPassword(DEMO.password);
          login.mutate(DEMO);
        }}
      >
        Explore with the demo account
      </Button>
      <p className="mt-3 text-center text-xs text-muted">
        {DEMO.email} · {DEMO.password}
      </p>
    </AuthShell>
  );
}
