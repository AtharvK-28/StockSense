import { clsx } from "clsx";
import { ChevronDown, Loader2, type LucideIcon, X } from "lucide-react";
import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useEffect,
} from "react";
import { createPortal } from "react-dom";
import { STATUS_LABEL, initials } from "../lib/format";
import type { DocStatus, StockStatus } from "../lib/types";

/* ---------- Buttons ---------- */

type Variant = "primary" | "dark" | "outline" | "subtle" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const buttonVariants: Record<Variant, string> = {
  primary: "brand-gradient text-white shadow-sm hover:brightness-[.96]",
  dark: "bg-ink text-white hover:bg-black",
  outline: "border border-ink bg-white text-ink hover:bg-canvas",
  subtle: "border border-line bg-white text-ink hover:border-ink",
  ghost: "text-ink hover:bg-canvas",
  danger: "border border-line bg-white text-bad hover:border-bad hover:bg-bad-50",
};
const buttonSizes: Record<Size, string> = {
  sm: "h-9 gap-1.5 rounded-lg px-3.5 text-sm",
  md: "h-11 gap-2 rounded-lg px-5 text-[15px]",
  lg: "h-12 gap-2 rounded-lg px-6 text-base",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: LucideIcon;
}

export function Button({
  variant = "dark",
  size = "md",
  loading,
  icon: Icon,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={clsx(
        "inline-flex shrink-0 items-center justify-center font-semibold whitespace-nowrap transition active:scale-[.98]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
        "disabled:pointer-events-none disabled:opacity-40",
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : Icon ? <Icon className="size-4" strokeWidth={2.25} /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  icon: Icon,
  label,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={clsx(
        "grid size-9 shrink-0 place-items-center rounded-full text-ink transition hover:bg-canvas active:scale-95 disabled:opacity-40",
        "focus-visible:outline-2 focus-visible:outline-ink",
        className,
      )}
      {...props}
    >
      <Icon className="size-4" strokeWidth={2.25} />
    </button>
  );
}

/* ---------- Form controls ---------- */

const controlBase =
  "w-full rounded-lg border bg-white text-[15px] text-ink outline-none transition placeholder:text-subtle " +
  "focus:border-ink focus:ring-1 focus:ring-ink disabled:cursor-not-allowed disabled:bg-canvas disabled:text-muted";

export function Input({ className, invalid, ...props }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      className={clsx(controlBase, "h-12 px-3.5", invalid ? "border-bad" : "border-line hover:border-muted", className)}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx(controlBase, "min-h-24 border-line px-3.5 py-3 hover:border-muted", className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        className={clsx(controlBase, "h-12 cursor-pointer appearance-none border-line pr-10 pl-3.5 hover:border-muted", className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-muted" />
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  className,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={clsx("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-semibold text-ink">
        {label}
      </label>
      {children}
      {error ? <p className="text-[13px] text-bad">{error}</p> : hint ? <p className="text-[13px] text-muted">{hint}</p> : null}
    </div>
  );
}

/* ---------- Filters ---------- */

export function Chip({
  active,
  children,
  count,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; count?: number }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={clsx(
        "inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium transition active:scale-[.97]",
        active ? "border-ink bg-canvas text-ink ring-1 ring-ink ring-inset" : "border-line bg-white text-ink hover:border-ink",
        className,
      )}
      {...props}
    >
      {children}
      {count !== undefined && (
        <span className={clsx("rounded-full px-1.5 text-xs font-semibold", active ? "bg-ink text-white" : "bg-canvas text-muted")}>
          {count}
        </span>
      )}
    </button>
  );
}

export function SelectPill({
  icon: Icon,
  className,
  children,
  value,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { icon?: LucideIcon }) {
  const active = value !== "" && value !== undefined;
  return (
    <div className="relative shrink-0">
      {Icon && <Icon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink" />}
      <select
        value={value}
        className={clsx(
          "h-10 cursor-pointer appearance-none rounded-full border bg-white pr-9 text-sm font-medium text-ink outline-none transition",
          "focus-visible:ring-1 focus-visible:ring-ink",
          Icon ? "pl-9" : "pl-4",
          active ? "border-ink bg-canvas ring-1 ring-ink ring-inset" : "border-line hover:border-ink",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink" />
    </div>
  );
}

/** Airbnb-style icon category bar with an underline on the active item. */
export function CategoryBar<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { key: T; label: string; icon: LucideIcon; count?: number }[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <div className="scrollbar-none -mx-1 flex gap-8 overflow-x-auto px-1">
      {items.map(({ key, label, icon: Icon, count }) => {
        const active = key === value;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-pressed={active}
            className={clsx(
              "group flex shrink-0 flex-col items-center gap-2 border-b-2 pt-1 pb-3 text-xs font-semibold transition",
              active ? "border-ink text-ink" : "border-transparent text-muted hover:border-line hover:text-ink",
            )}
          >
            <Icon className={clsx("size-6 transition", active ? "opacity-100" : "opacity-70 group-hover:opacity-100")} strokeWidth={1.6} />
            <span className="flex items-center gap-1">
              {label}
              {count !== undefined && count > 0 && <span className="text-muted">· {count}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Display ---------- */

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx("rounded-2xl border border-hairline bg-white", className)}>{children}</div>;
}

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

const statusTone: Record<DocStatus, string> = {
  draft: "bg-canvas text-muted ring-line",
  waiting: "bg-warn-50 text-warn ring-warn/20",
  ready: "bg-info-50 text-info ring-info/20",
  done: "bg-ok-50 text-ok ring-ok/20",
  canceled: "bg-bad-50 text-bad ring-bad/20",
};

export function StatusBadge({ status, className }: { status: DocStatus; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ring-1 ring-inset",
        statusTone[status],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {STATUS_LABEL[status]}
    </span>
  );
}

const stockTone: Record<StockStatus, { label: string; className: string }> = {
  in: { label: "In stock", className: "text-ok" },
  low: { label: "Low stock", className: "text-warn" },
  out: { label: "Out of stock", className: "text-bad" },
};

export function StockBadge({ status, floating }: { status: StockStatus; floating?: boolean }) {
  const tone = stockTone[status];
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full text-xs font-semibold whitespace-nowrap",
        floating ? "bg-white px-3 py-1.5 text-ink shadow-card" : clsx("px-2.5 py-1 ring-1 ring-inset ring-current/20", tone.className),
      )}
    >
      <span className={clsx("size-1.5 rounded-full bg-current", floating && tone.className)} />
      {tone.label}
    </span>
  );
}

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span
      className={clsx(
        "grid shrink-0 place-items-center rounded-full bg-ink font-semibold text-white",
        size === "sm" && "size-8 text-xs",
        size === "md" && "size-10 text-sm",
        size === "lg" && "size-24 text-3xl",
      )}
    >
      {initials(name)}
    </span>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("flex flex-col items-center px-6 py-14 text-center", className)}>
      <span className="grid size-14 place-items-center rounded-full bg-canvas">
        <Icon className="size-6 text-ink" strokeWidth={1.75} />
      </span>
      <h3 className="mt-4 text-lg font-semibold">{title}</h3>
      {children && <p className="mt-1 max-w-sm text-[15px] text-muted">{children}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-lg bg-canvas", className)} />;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx("size-5 animate-spin text-muted", className)} />;
}

export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-2 text-sm text-muted">{eyebrow}</div>}
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight sm:text-[32px]">{title}</h1>
        {subtitle && <p className="mt-1.5 text-[15px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-bad/30 bg-bad-50 px-4 py-3 text-sm text-bad">{children}</div>;
}

/* ---------- Modal ---------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={clsx(
          "animate-rise-in flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-pop sm:rounded-2xl",
          wide ? "sm:max-w-[720px]" : "sm:max-w-[568px]",
        )}
      >
        <header className="relative flex h-16 shrink-0 items-center justify-center border-b border-hairline px-14">
          <IconButton icon={X} label="Close" onClick={onClose} className="absolute left-4" />
          <h2 className="truncate text-base font-bold">{title}</h2>
        </header>
        <div className="overflow-y-auto p-6">{children}</div>
        {footer && <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-hairline px-6 py-4">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
