import { clsx } from "clsx";
import { Eye, EyeOff } from "lucide-react";
import { type InputHTMLAttributes, type ReactNode, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { Logo } from "../../components/Layout";

export function AuthShell({ title, heading, children, footer }: { title: string; heading: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="flex h-20 items-center border-b border-hairline bg-white px-6 lg:px-10">
        <Link to="/login">
          <Logo />
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 py-10 sm:items-center">
        <div className="animate-rise-in w-full max-w-[568px] rounded-2xl border border-hairline bg-white shadow-pop">
          <div className="flex h-16 items-center justify-center border-b border-hairline">
            <h1 className="text-base font-bold">{title}</h1>
          </div>
          <div className="p-6 sm:p-8">
            <h2 className="mb-6 text-[22px] font-semibold tracking-tight">{heading}</h2>
            {children}
          </div>
        </div>
      </main>
      {footer && <div className="pb-10 text-center text-sm text-muted">{footer}</div>}
    </div>
  );
}

/** Airbnb-style stacked inputs: shared borders, the focused one gets a strong outline. */
export function InputStack({ children, invalid }: { children: ReactNode; invalid?: boolean }) {
  return (
    <div
      className={clsx(
        "flex flex-col rounded-lg border",
        invalid ? "border-bad" : "border-muted/60",
        "[&>*+*]:border-t [&>*+*]:border-muted/60",
      )}
    >
      {children}
    </div>
  );
}

export function FloatingInput({
  label,
  className,
  type = "text",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = useId();
  const [reveal, setReveal] = useState(false);
  const isPassword = type === "password";
  return (
    <div className={clsx("relative first:rounded-t-lg last:rounded-b-lg focus-within:z-10 focus-within:rounded-lg focus-within:ring-2 focus-within:ring-ink", className)}>
      <input
        id={id}
        placeholder=" "
        type={isPassword && reveal ? "text" : type}
        className={clsx("peer h-14 w-full rounded-[inherit] bg-transparent px-3 pt-5 pb-1.5 text-[15px] text-ink outline-none", isPassword && "pr-16")}
        {...props}
      />
      <label
        htmlFor={id}
        className="pointer-events-none absolute top-1/2 left-3 origin-left -translate-y-1/2 text-[15px] text-muted transition-all peer-focus:top-[18px] peer-focus:text-xs peer-[:not(:placeholder-shown)]:top-[18px] peer-[:not(:placeholder-shown)]:text-xs"
      >
        {label}
      </label>
      {isPassword && (
        <button
          type="button"
          onClick={() => setReveal((r) => !r)}
          aria-label={reveal ? "Hide password" : "Show password"}
          className="absolute top-1/2 right-3 -translate-y-1/2 rounded-md p-1.5 text-muted hover:text-ink"
        >
          {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      )}
    </div>
  );
}

export function OtpInput({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? "");

  const setAt = (index: number, digit: string) => {
    const next = digits.slice();
    next[index] = digit;
    onChange(next.join("").slice(0, 6));
  };

  return (
    <div className="flex justify-between gap-2" onPaste={(e) => {
      const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
      if (pasted) {
        e.preventDefault();
        onChange(pasted);
        refs.current[Math.min(pasted.length, 5)]?.focus();
      }
    }}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`Digit ${i + 1}`}
          maxLength={1}
          onChange={(e) => {
            const digit = e.target.value.replace(/\D/g, "").slice(-1);
            setAt(i, digit);
            if (digit) refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !digits[i]) refs.current[i - 1]?.focus();
            if (e.key === "ArrowLeft") refs.current[i - 1]?.focus();
            if (e.key === "ArrowRight") refs.current[i + 1]?.focus();
          }}
          className="h-14 w-full min-w-0 rounded-lg border border-muted/60 text-center text-xl font-semibold outline-none focus:border-ink focus:ring-1 focus:ring-ink"
        />
      ))}
    </div>
  );
}

export function PasswordRules({ password }: { password: string }) {
  const rules = [
    { ok: password.length >= 8, label: "At least 8 characters" },
    { ok: /[A-Za-z]/.test(password), label: "Contains a letter" },
    { ok: /\d/.test(password), label: "Contains a number" },
  ];
  return (
    <ul className="mt-3 space-y-1 text-[13px]">
      {rules.map((r) => (
        <li key={r.label} className={clsx("flex items-center gap-2", r.ok ? "text-ok" : "text-muted")}>
          <span className={clsx("size-1.5 rounded-full", r.ok ? "bg-ok" : "bg-line")} />
          {r.label}
        </li>
      ))}
    </ul>
  );
}

export const passwordOk = (p: string) => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
