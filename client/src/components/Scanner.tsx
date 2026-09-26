import { clsx } from "clsx";
import { Camera, CameraOff, CircleAlert, CircleCheck, ScanLine } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Modal } from "./ui";

/** The browser's built-in barcode detector (Chrome/Edge on Android, ChromeOS, macOS). */
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;
const Detector = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
export const cameraScanSupported = !!Detector && !!navigator.mediaDevices?.getUserMedia;

export interface ScanResult {
  ok: boolean;
  message: string;
}

function beep(ok: boolean) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = ok ? 880 : 220;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.08 : 0.25));
    osc.onended = () => ctx.close();
  } catch {
    /* audio unavailable */
  }
}

/**
 * Scan dialog. Works with USB/Bluetooth barcode scanners (they type the code and press Enter)
 * and, where the browser supports it, the device camera. Stays open for continuous scanning.
 */
export function ScanDialog({
  open,
  onClose,
  onScan,
  title = "Scan",
  hint,
  continuous = true,
}: {
  open: boolean;
  onClose: () => void;
  onScan: (code: string) => ScanResult | Promise<ScanResult>;
  title?: string;
  hint?: string;
  continuous?: boolean;
}) {
  const [code, setCode] = useState("");
  const [log, setLog] = useState<(ScanResult & { code: string; at: number })[]>([]);
  const [camera, setCamera] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastRef = useRef<{ code: string; at: number } | null>(null);

  const submit = useCallback(
    async (raw: string, fromCamera = false) => {
      const value = raw.trim();
      if (!value) return;
      // A camera sees the same code many times a second, so ignore its repeats within 1.5s.
      // Hand scanners and typing are deliberate: scanning two identical boxes counts twice.
      if (fromCamera) {
        const last = lastRef.current;
        if (last && last.code === value && Date.now() - last.at < 1500) return;
        lastRef.current = { code: value, at: Date.now() };
      }
      const result = await onScan(value);
      beep(result.ok);
      setLog((l) => [{ ...result, code: value, at: Date.now() }, ...l].slice(0, 6));
      if (result.ok && !continuous) onClose();
    },
    [onScan, continuous, onClose],
  );

  useEffect(() => {
    if (!open) {
      setCamera(false);
      setLog([]);
      setCode("");
    }
  }, [open]);

  useEffect(() => {
    if (!open || !camera || !Detector) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const detector = new Detector({ formats: ["code_128", "qr_code", "ean_13", "ean_8", "code_39", "upc_a"] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const tick = async () => {
          if (stopped || !videoRef.current) return;
          try {
            const found = await detector.detect(videoRef.current);
            if (found[0]) await submit(found[0].rawValue, true);
          } catch {
            /* frame not ready */
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch (err) {
        setCameraError((err as Error).name === "NotAllowedError" ? "Camera permission was denied." : "Couldn't start the camera.");
        setCamera(false);
      }
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open, camera, submit]);

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(code);
          setCode("");
          inputRef.current?.focus();
        }}
      >
        <label className="flex h-14 items-center gap-3 rounded-xl border-2 border-ink px-4">
          <ScanLine className="size-5 shrink-0" />
          <input
            ref={inputRef}
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Scan a barcode or type a SKU / reference"
            aria-label="Barcode"
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent font-mono text-[15px] outline-none placeholder:font-sans placeholder:text-muted"
          />
        </label>
      </form>
      <p className="mt-2 text-[13px] text-muted">{hint ?? "USB and Bluetooth scanners work out of the box — they type the code and press Enter."}</p>

      {cameraScanSupported ? (
        <div className="mt-4">
          {camera && (
            <div className="relative mb-3 overflow-hidden rounded-xl bg-black">
              <video ref={videoRef} muted playsInline className="aspect-video w-full object-cover" />
              <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-brand/80 shadow-[0_0_12px_2px_rgba(255,56,92,.6)]" />
            </div>
          )}
          <Button variant="subtle" icon={camera ? CameraOff : Camera} onClick={() => setCamera((c) => !c)}>
            {camera ? "Stop camera" : "Use camera"}
          </Button>
          {cameraError && <p className="mt-2 text-sm text-bad">{cameraError}</p>}
        </div>
      ) : (
        <p className="mt-4 rounded-xl bg-canvas px-4 py-3 text-[13px] text-muted">
          Camera scanning needs Chrome or Edge on Android, ChromeOS or macOS. On this device, use a scanner or type the code.
        </p>
      )}

      {log.length > 0 && (
        <ul className="mt-5 divide-y divide-hairline rounded-xl border border-hairline" aria-live="polite">
          {log.map((l) => (
            <li key={l.at} className="flex items-start gap-3 px-4 py-2.5 text-sm">
              {l.ok ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-ok" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-bad" />}
              <span className="min-w-0 flex-1">
                <span className="font-mono text-xs text-muted">{l.code}</span>
                <span className={clsx("block", !l.ok && "text-bad")}>{l.message}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
