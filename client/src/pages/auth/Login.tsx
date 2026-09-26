import { useMutation } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Button, ErrorNote } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import type { User } from "../../lib/types";
import { AuthShell, FloatingInput, InputStack } from "./AuthShell";

const DEMO = { login: "manager", password: "Demo@1234" };

export function Login() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");

  const signIn = useMutation({
    mutationFn: (body: { login: string; password: string }) => api<{ user?: User; requiresTwoFactor?: boolean; challenge?: string }>("/auth/login", { method: "POST", body }),
    onSuccess: (result) => {
      if (result.requiresTwoFactor && result.challenge) {
        setChallenge(result.challenge);
        return;
      }
      if (result.user) {
        setUser(result.user);
        navigate(from, { replace: true });
      }
    },
  });
  const verifyTwoFactor = useMutation({
    mutationFn: () => api<{ user: User }>("/auth/login/2fa", { method: "POST", body: { challenge, code } }),
    onSuccess: ({ user }) => {
      setUser(user);
      navigate(from, { replace: true });
    },
  });

  return (
    <AuthShell
      title="Log in"
      heading="Welcome back to StockSense"
    >
      {challenge ? <form
        onSubmit={(e) => {
          e.preventDefault();
          verifyTwoFactor.mutate();
        }}
        className="space-y-4"
      >
        <p className="text-sm text-muted">Enter the 6-digit code from your authenticator app.</p>
        <FloatingInput label="Authenticator code" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
        {verifyTwoFactor.isError && <ErrorNote>{errorMessage(verifyTwoFactor.error)}</ErrorNote>}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={verifyTwoFactor.isPending} disabled={code.length !== 6}>
          Verify code
        </Button>
        <button type="button" className="w-full text-center text-sm font-semibold underline" onClick={() => { setChallenge(null); setCode(""); }}>
          Use a different account
        </button>
      </form> : <form
        onSubmit={(e) => {
          e.preventDefault();
          signIn.mutate({ login, password });
        }}
        className="space-y-4"
      >
        <InputStack invalid={signIn.isError}>
          <FloatingInput label="Login ID" autoComplete="username" required value={login} onChange={(e) => setLogin(e.target.value)} />
          <FloatingInput label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </InputStack>
        <p className="text-[13px] text-muted">You can also use the email you signed up with.</p>
        {signIn.isError && <ErrorNote>{errorMessage(signIn.error)}</ErrorNote>}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={signIn.isPending}>
          Sign in
        </Button>
        <p className="text-center text-sm">
          <Link to="/forgot-password" className="font-semibold underline underline-offset-2">
            Forgot password?
          </Link>
          <span className="mx-2 text-line">|</span>
          <Link to="/signup" className="font-semibold underline underline-offset-2">
            Sign up
          </Link>
        </p>
      </form>}

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
        disabled={signIn.isPending}
        onClick={() => {
          setLogin(DEMO.login);
          setPassword(DEMO.password);
          signIn.mutate(DEMO);
        }}
      >
        Explore with the demo account
      </Button>
      <p className="mt-3 text-center text-xs text-muted">
        Login ID <span className="font-semibold">{DEMO.login}</span> · {DEMO.password}
      </p>
    </AuthShell>
  );
}
