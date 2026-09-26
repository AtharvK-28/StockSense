import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { AlertTriangle, Bell, CheckCheck, ClipboardCheck, PackageCheck, PackageX, RefreshCcw, ShieldCheck, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../lib/api";
import { fmtRelative } from "../lib/format";

interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

const ICONS: Record<string, { icon: typeof Bell; tone: string }> = {
  approval: { icon: ClipboardCheck, tone: "bg-brand-50 text-brand" },
  approved: { icon: ShieldCheck, tone: "bg-ok-50 text-ok" },
  low_stock: { icon: AlertTriangle, tone: "bg-warn-50 text-warn" },
  out_of_stock: { icon: PackageX, tone: "bg-bad-50 text-bad" },
  auto_reorder: { icon: RefreshCcw, tone: "bg-info-50 text-info" },
  ready: { icon: PackageCheck, tone: "bg-ok-50 text-ok" },
  canceled: { icon: XCircle, tone: "bg-bad-50 text-bad" },
  role: { icon: ShieldCheck, tone: "bg-info-50 text-info" },
};

/** Bell menu: approvals, low-stock crossings, auto-reorders, deliveries becoming ready. */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const data = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<{ items: Notification[]; unread: number }>("/notifications"),
    refetchInterval: 60_000,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["notifications"] });
  const readAll = useMutation({ mutationFn: () => api("/notifications/read-all", { method: "POST" }), onSuccess: refresh });
  const readOne = useMutation({ mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: "POST" }), onSuccess: refresh });

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const unread = data.data?.unread ?? 0;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        className="relative grid size-10 shrink-0 place-items-center rounded-full border border-line bg-white transition hover:shadow-card sm:size-11"
      >
        <Bell className="size-[18px]" strokeWidth={2} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 grid min-w-5 place-items-center rounded-full bg-brand px-1 text-[11px] leading-5 font-bold text-on-brand ring-2 ring-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="animate-rise-in absolute top-full right-0 z-40 mt-2 w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-hairline bg-white shadow-pop">
          <div className="flex items-center justify-between border-b border-hairline px-5 py-3.5">
            <p className="font-semibold">Notifications</p>
            {unread > 0 && (
              <button type="button" onClick={() => readAll.mutate()} className="flex items-center gap-1.5 text-sm font-semibold underline underline-offset-2">
                <CheckCheck className="size-4" /> Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-[420px] divide-y divide-hairline overflow-y-auto">
            {data.data?.items.length === 0 && <li className="px-5 py-10 text-center text-sm text-muted">You're all caught up.</li>}
            {data.data?.items.map((n) => {
              const meta = ICONS[n.kind] ?? { icon: Bell, tone: "bg-canvas text-ink" };
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!n.readAt) readOne.mutate(n.id);
                      setOpen(false);
                      if (n.link) navigate(n.link);
                    }}
                    className={clsx("flex w-full gap-3 px-5 py-3.5 text-left transition hover:bg-canvas", !n.readAt && "bg-brand-50/40")}
                  >
                    <span className={clsx("grid size-9 shrink-0 place-items-center rounded-full", meta.tone)}>
                      <meta.icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={clsx("block text-sm", !n.readAt && "font-semibold")}>{n.title}</span>
                      {n.body && <span className="mt-0.5 block text-xs text-muted">{n.body}</span>}
                      <span className="mt-1 block text-xs text-subtle">{fmtRelative(n.createdAt)}</span>
                    </span>
                    {!n.readAt && <span className="mt-2 size-2 shrink-0 rounded-full bg-brand" aria-label="Unread" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
