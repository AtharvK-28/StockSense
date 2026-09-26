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
type BarcodeDetectorCtor = (new (opts?: { formats?: string[] }) => BarcodeDetectorLike) & { getSupportedFormats?: () => Promise<string[]> };
const Detector = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
/** Camera access needs a secure page (HTTPS or localhost). */
export const cameraAvailable = !!navigator.mediaDevices?.getUserMedia;

type Decoder = (video: HTMLVideoElement) => Promise<string | null>;
const FORMATS = ["code_128", "ean_13", "ean_8", "upc_a", "code_39", "qr_code"];

/**
 * Picks a barcode reader: the built-in detector where the platform has one, otherwise the bundled
 * ZXing decoder (Windows/Linux laptops, Firefox, Safari). ZXing is loaded only when the camera opens.
 */
async function createDecoder(): Promise<Decoder> {
  if (Detector) {
    try {
      const supported = (await Detector.getSupportedFormats?.()) ?? FORMATS;
      const formats = FORMATS.filter((f) => supported.includes(f));
      if (formats.length) {
        const detector = new Detector({ formats });
        return async (video) => (await detector.detect(video))[0]?.rawValue ?? null;
      }
    } catch {
      /* declared but unusable on this platform: fall through */
    }
  }
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
  const hints = new Map<number, unknown>([
    [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.CODE_39, BarcodeFormat.QR_CODE]],
    [DecodeHintType.TRY_HARDER, true],
  ]);
  const reader = new BrowserMultiFormatReader(hints);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  return async (video) => {
    if (!video.videoWidth) return null;
    // Decode a downscaled frame: plenty of pixels for a label held up to the camera, and fast.
    const scale = Math.min(1, 960 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    try {
      return reader.decodeFromCanvas(canvas).getText();
    } catch {
      return null; // nothing readable in this frame
    }
  };
}

function cameraErrorMessage(err: unknown) {
  switch ((err as Error).name) {
    case "NotAllowedError":
      return "Camera access was blocked. Allow it from the camera icon in the address bar, then try again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera was found on this device.";
    case "NotReadableError":
      return "The camera is in use by another app. Close it and try again.";
    default:
      return "Couldn't start the camera.";
  }
}

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
  const [cameraState, setCameraState] = useState<"starting" | "scanning">("starting");
  const [mirrored, setMirrored] = useState(false);
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

  // The camera loop reads the latest handler through a ref, so parent re-renders don't restart the camera.
  const submitRef = useRef(submit);
  submitRef.current = submit;

  useEffect(() => {
    if (!open) {
      setCamera(false);
      setLog([]);
      setCode("");
    }
  }, [open]);

  useEffect(() => {
    if (!open || !camera) return;
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    setCameraError(null);
    setCameraState("starting");
    (async () => {
      try {
        // This is what makes the browser ask for camera permission.
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        const decode = await createDecoder();
        const video = videoRef.current;
        if (stopped || !video) return;
        // Laptop webcams face the user: mirror the preview so aiming feels natural (frames are decoded unmirrored).
        setMirrored(stream.getVideoTracks()[0]?.getSettings().facingMode !== "environment");
        video.srcObject = stream;
        await video.play();
        setCameraState("scanning");
        const tick = async () => {
          if (stopped) return;
          try {
            const code = await decode(video);
            if (code) await submitRef.current(code, true);
          } catch {
            /* frame not ready */
          }
          timer = window.setTimeout(tick, 120);
        };
        tick();
      } catch (err) {
        if (stopped) return;
        setCameraError(cameraErrorMessage(err));
        setCamera(false);
      }
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open, camera]);

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

      {cameraAvailable ? (
        <div className="mt-4">
          {camera && (
            <div className="relative mb-3 overflow-hidden rounded-xl bg-black">
              <video ref={videoRef} muted playsInline className={clsx("aspect-video w-full object-cover", mirrored && "-scale-x-100")} />
              <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-brand/80 shadow-[0_0_12px_2px_rgba(255,56,92,.6)]" />
              <p className="absolute inset-x-0 bottom-0 bg-black/55 px-4 py-2 text-center text-xs text-white">
                {cameraState === "starting" ? "Starting camera…" : "Hold the barcode flat, filling about half the frame"}
              </p>
            </div>
          )}
          <Button variant="subtle" icon={camera ? CameraOff : Camera} onClick={() => setCamera((c) => !c)}>
            {camera ? "Stop camera" : "Use camera"}
          </Button>
          {cameraError && (
            <p role="alert" className="mt-2 text-sm text-bad">
              {cameraError}
            </p>
          )}
        </div>
      ) : (
        <p className="mt-4 rounded-xl bg-canvas px-4 py-3 text-[13px] text-muted">
          The camera needs a secure connection (HTTPS or localhost). On this connection, use a scanner or type the code.
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
