import { clsx } from "clsx";
import { CircleAlert, CircleCheck, X } from "lucide-react";
import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from "react";

type Tone = "success" | "error" | "info";
interface Toast {
  id: number;
  title: string;
  description?: string;
  tone: Tone;
}

const ToastContext = createContext<((t: Omit<Toast, "id" | "tone"> & { tone?: Tone }) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (t: Omit<Toast, "id" | "tone"> & { tone?: Tone }) => {
      const id = Date.now() + Math.random();
      setToasts((all) => [...all.slice(-2), { tone: "success", ...t, id }]);
      setTimeout(() => dismiss(id), t.tone === "error" ? 6000 : 3500);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={useMemo(() => push, [push])}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:left-6 sm:items-start">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="animate-rise-in pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl bg-ink px-4 py-3.5 text-white shadow-lift"
          >
            {t.tone === "error" ? (
              <CircleAlert className="mt-0.5 size-5 shrink-0 text-brand" />
            ) : (
              <CircleCheck className={clsx("mt-0.5 size-5 shrink-0", t.tone === "success" ? "text-[#4ade80]" : "text-white")} />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t.title}</p>
              {t.description && <p className="mt-0.5 text-sm text-white/70">{t.description}</p>}
            </div>
            <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="text-white/60 hover:text-white">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  if (!push) throw new Error("useToast must be used inside ToastProvider");
  return push;
}
