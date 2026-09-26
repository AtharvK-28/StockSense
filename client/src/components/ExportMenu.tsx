import { ChevronDown, Download, FileJson, FileSpreadsheet } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { download, errorMessage, qs } from "../lib/api";
import { useToast } from "./toast";
import { Button } from "./ui";

type Params = Record<string, string | undefined | null>;

/**
 * "Export" button for a dataset from /api/export. Passes the page's current filters, so the file
 * matches what's on screen. CSV opens in Excel / Google Sheets; JSON is for other tools.
 */
export function ExportMenu({
  dataset,
  params = {},
  label = "Export",
  disabled,
  sets,
}: {
  dataset?: string;
  params?: Params;
  label?: string;
  disabled?: boolean;
  /** Several datasets in one menu, each with its own heading. */
  sets?: { dataset: string; label: string; params?: Params }[];
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const groups = sets ?? [{ dataset: dataset!, label: "", params }];

  const run = async (set: (typeof groups)[number], format: "csv" | "json") => {
    setOpen(false);
    setBusy(true);
    try {
      await download(`/export/${set.dataset}${qs({ ...set.params, format })}`);
    } catch (err) {
      toast({ title: errorMessage(err), tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const item = "flex w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] hover:bg-canvas";
  return (
    <div ref={ref} className="relative print:hidden">
      <Button variant="subtle" icon={Download} loading={busy} disabled={disabled} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        {label}
        <ChevronDown className="-mr-1 ml-1 size-3.5" />
      </Button>
      {open && (
        <div role="menu" className="animate-rise-in absolute top-full right-0 z-40 mt-2 w-60 overflow-hidden rounded-xl border border-hairline bg-white py-2 shadow-pop">
          {groups.map((set, i) => (
            <div key={set.dataset} className={i > 0 ? "mt-1 border-t border-hairline pt-1" : undefined}>
              {set.label && <p className="px-4 pt-2 pb-1 text-xs font-semibold text-muted">{set.label}</p>}
              <button type="button" role="menuitem" className={item} onClick={() => run(set, "csv")}>
                <FileSpreadsheet className="size-4 shrink-0" />
                <span>
                  CSV <span className="block text-xs text-muted">Excel, Google Sheets</span>
                </span>
              </button>
              <button type="button" role="menuitem" className={item} onClick={() => run(set, "json")}>
                <FileJson className="size-4 shrink-0" />
                <span>
                  JSON <span className="block text-xs text-muted">For other software</span>
                </span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
