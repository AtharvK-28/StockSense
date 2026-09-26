import { useMutation } from "@tanstack/react-query";
import { CircleCheck, KeyRound } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router";
import { Button, ErrorNote } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { AuthShell, FloatingInput, InputStack, OtpInput, PasswordRules, passwordOk } from "./AuthShell";

type Step = "email" | "code" | "done";

export function ForgotPassword() {
  const location = useLocation();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState((location.state as { email?: string } | null)?.email ?? "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [devOtp, setDevOtp] = useState<string | null>(null);

  const request = useMutation({
    mutationFn: () => api<{ message: string; devOtp?: string }>("/auth/forgot-password", { method: "POST", body: { email } }),
    onSuccess: (res) => {
      setDevOtp(res.devOtp ?? null);
      setCode("");
      setStep("code");
    },
  });

  const reset = useMutation({
    mutationFn: () => api("/auth/reset-password", { method: "POST", body: { email, code, password } }),
    onSuccess: () => setStep("done"),
  });

  const mismatch = confirm.length > 0 && confirm !== password;

  return (
    <AuthShell
      title="Reset password"
      heading={step === "email" ? "Forgot your password?" : step === "code" ? "Check your email" : "Password updated"}
      footer={
        <Link to="/login" className="font-semibold text-ink underline underline-offset-2">
          Back to log in
        </Link>
      }
    >
      {step === "email" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            request.mutate();
          }}
          className="space-y-4"
        >
          <p className="text-[15px] text-muted">Enter the email you signed up with. We'll send a 6-digit code that's valid for 10 minutes.</p>
          <InputStack>
            <FloatingInput label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </InputStack>
          {request.isError && <ErrorNote>{errorMessage(request.error)}</ErrorNote>}
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={request.isPending}>
            Send code
          </Button>
        </form>
      )}

      {step === "code" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            reset.mutate();
          }}
          className="space-y-5"
        >
          <p className="text-[15px] text-muted">
            If an account exists for <span className="font-semibold text-ink">{email}</span>, we've sent it a code. Enter it below with your new password.
          </p>
          {devOtp && (
            <div className="flex items-center gap-3 rounded-xl border border-dashed border-line bg-canvas px-4 py-3 text-sm">
              <KeyRound className="size-4 shrink-0" />
              <span className="flex-1">
                Demo mode — your code is <span className="font-mono font-semibold tracking-widest">{devOtp}</span>
              </span>
              <button type="button" onClick={() => setCode(devOtp)} className="font-semibold underline underline-offset-2">
                Fill
              </button>
            </div>
          )}
          <OtpInput value={code} onChange={setCode} />
          <div>
            <InputStack invalid={mismatch}>
              <FloatingInput label="New password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              <FloatingInput label="Confirm new password" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </InputStack>
            {mismatch ? <p className="mt-2 text-[13px] text-bad">Passwords don't match</p> : password && <PasswordRules password={password} />}
          </div>
          {reset.isError && <ErrorNote>{errorMessage(reset.error)}</ErrorNote>}
          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full"
            loading={reset.isPending}
            disabled={code.length !== 6 || !passwordOk(password) || password !== confirm}
          >
            Reset password
          </Button>
          <p className="text-center text-sm text-muted">
            Didn't get it?{" "}
            <button type="button" onClick={() => request.mutate()} disabled={request.isPending} className="font-semibold text-ink underline underline-offset-2">
              Send a new code
            </button>
          </p>
        </form>
      )}

      {step === "done" && (
        <div className="flex flex-col items-center text-center">
          <CircleCheck className="size-12 text-ok" strokeWidth={1.5} />
          <p className="mt-4 text-[15px] text-muted">Your password has been changed. Use it to log in from now on.</p>
          <Link to="/login" className="mt-6 w-full">
            <Button variant="primary" size="lg" className="w-full">
              Log in
            </Button>
          </Link>
        </div>
      )}
    </AuthShell>
  );
}
