import { useQuery } from "@tanstack/react-query";
import { FileArchive, FileJson, FileSpreadsheet } from "lucide-react";
import { useState } from "react";
import { useToast } from "../../components/toast";
import { Button, Card, Field, Input, PageHeader, Skeleton } from "../../components/ui";
import { api, download, errorMessage, qs } from "../../lib/api";
import { useIsManager } from "../../lib/auth";

interface DatasetInfo {
  key: string;
  label: string;
  description: string;
}

/** Datasets that grow over time and honour the date range. */
const DATED = new Set(["documents", "document-lines", "moves", "audit"]);

export function DataExport() {
  const isManager = useIsManager();
  const toast = useToast();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const datasets = useQuery({ queryKey: ["export-datasets"], queryFn: () => api<{ items: DatasetInfo[] }>("/export").then((r) => r.items) });

  const run = async (key: string, path: string) => {
    setBusy(key);
    try {
      await download(path);
    } catch (err) {
      toast({ title: errorMessage(err), tone: "error" });
    } finally {
      setBusy(null);
    }
  };
  const range = { from, to };
  const rangeInvalid = !!from && !!to && from > to;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Settings"
        title="Data export"
        subtitle="Download your data whenever you need it. CSV opens in Excel or Google Sheets; JSON is for other software. Every download is recorded in the audit log."
      />

      <Card className="mb-6 p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand">
            <FileArchive className="size-6" strokeWidth={1.6} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight">Everything, in one ZIP</h2>
            <p className="mt-1 text-sm text-muted">
              One CSV per dataset below{isManager ? ", including the team and audit log" : ""}. Use it as a backup or to move your data elsewhere.
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Operations and moves from" hint="Optional">
                <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="Up to and including" hint="Optional" error={rangeInvalid ? "End date is before the start date" : null}>
                <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
              </Field>
            </div>
            <p className="mt-2 text-[13px] text-muted">The date range applies to operations, the stock ledger and the audit log. Products, stock and settings are always current.</p>
            <Button className="mt-5" variant="primary" icon={FileArchive} loading={busy === "all"} disabled={rangeInvalid} onClick={() => run("all", `/export/all${qs(range)}`)}>
              Download ZIP
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="px-6 pt-6 pb-2 text-lg font-semibold tracking-tight">Single datasets</h2>
        {!datasets.data ? (
          <div className="space-y-3 p-6">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {datasets.data.map((d) => {
              const params = DATED.has(d.key) ? range : {};
              return (
                <li key={d.key} className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{d.label}</p>
                    <p className="text-sm text-muted">
                      {d.description}
                      {DATED.has(d.key) && (from || to) ? " · date range applied" : ""}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="subtle" icon={FileSpreadsheet} loading={busy === `${d.key}.csv`} disabled={rangeInvalid} onClick={() => run(`${d.key}.csv`, `/export/${d.key}${qs({ ...params, format: "csv" })}`)}>
                      CSV
                    </Button>
                    <Button size="sm" variant="subtle" icon={FileJson} loading={busy === `${d.key}.json`} disabled={rangeInvalid} onClick={() => run(`${d.key}.json`, `/export/${d.key}${qs({ ...params, format: "json" })}`)}>
                      JSON
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
