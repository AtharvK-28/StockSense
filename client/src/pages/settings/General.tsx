import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { RefreshCcw } from "lucide-react";
import { Card, PageHeader, Skeleton } from "../../components/ui";
import { api } from "../../lib/api";
import { useIsManager } from "../../lib/auth";
import { useAction } from "../../lib/queries";

interface Settings {
  autoReorder: boolean;
}

export function useSettings() {
  return useQuery({ queryKey: ["settings"], queryFn: () => api<{ settings: Settings }>("/settings").then((r) => r.settings) });
}

function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        "relative inline-flex h-8 w-[52px] shrink-0 items-center rounded-full transition disabled:opacity-50",
        checked ? "bg-ink" : "bg-line",
      )}
    >
      <span className={clsx("inline-block size-6 rounded-full bg-white shadow transition", checked ? "translate-x-[24px]" : "translate-x-1")} />
    </button>
  );
}

export function General() {
  const isManager = useIsManager();
  const settings = useSettings();
  const save = useAction((patch: Partial<Settings>) => api("/settings", { method: "PUT", body: patch }), { success: "Settings saved" });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Settings" title="General" subtitle="Company-wide behaviour of StockSense." />
      {!isManager && <p className="mb-6 rounded-xl bg-canvas px-4 py-3 text-sm text-muted">Only inventory managers can change these settings.</p>}
      <Card>
        <div className="flex items-start gap-4 p-6">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-info-50 text-info">
            <RefreshCcw className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Automatic reorders</p>
            <p className="mt-1 text-sm text-muted">
              When a validation drops a product to its reorder point, create a draft receipt that brings it back up to its max quantity and
              notify managers. Skipped if a receipt for that product is already open.
            </p>
          </div>
          {settings.data ? (
            <Toggle
              label="Automatic reorders"
              checked={settings.data.autoReorder}
              disabled={!isManager || save.isPending}
              onChange={(autoReorder) => save.mutate({ autoReorder })}
            />
          ) : (
            <Skeleton className="h-8 w-[52px] rounded-full" />
          )}
        </div>
      </Card>
    </div>
  );
}
