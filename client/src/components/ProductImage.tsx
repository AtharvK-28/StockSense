import { clsx } from "clsx";
import { ImagePlus, Trash2 } from "lucide-react";
import { type CSSProperties, useRef, useState } from "react";
import { categoryVisual } from "../lib/visual";
import { Button } from "./ui";

interface Pictured {
  name: string;
  imageUrl?: string | null;
  category?: { name: string } | null;
}

/**
 * A product's photo, or its category tile when it has none. Fills its box: size it with className
 * (e.g. "size-10 rounded-lg"); `iconClassName` sizes the fallback icon.
 */
export function ProductImage({
  product,
  className,
  iconClassName = "size-5",
  style,
  imgClassName,
}: {
  product: Pictured;
  className?: string;
  iconClassName?: string;
  style?: CSSProperties;
  imgClassName?: string;
}) {
  const [broken, setBroken] = useState(false);
  const visual = categoryVisual(product.category?.name);
  if (product.imageUrl && !broken) {
    return (
      <span className={clsx("block shrink-0 overflow-hidden bg-canvas", className)} style={style}>
        <img src={product.imageUrl} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} className={clsx("size-full object-cover", imgClassName)} />
      </span>
    );
  }
  return (
    <span className={clsx("grid shrink-0 place-items-center", className)} style={{ background: visual.bg, ...style }}>
      <visual.icon className={clsx(iconClassName, imgClassName)} style={{ color: visual.fg }} strokeWidth={1.5} />
    </span>
  );
}

const MAX_SIDE = 800;

/** Shrinks a photo to at most 800px and re-encodes it (WebP, or JPEG where WebP isn't available). */
export async function preparePhoto(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("This browser can't read that image. Try a JPEG or PNG.");
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff"; // transparent PNGs get a white background, like a catalog photo
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const encode = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
  const webp = await encode("image/webp");
  const blob = webp?.type === "image/webp" ? webp : await encode("image/jpeg");
  if (!blob) throw new Error("Couldn't process that image");
  return blob;
}

/**
 * Photo area with add / replace / remove. Accepts a click (file picker, or the camera on phones)
 * or a dropped file. `onPick` receives the resized image.
 */
export function PhotoPicker({
  product,
  previewUrl,
  editable,
  busy,
  onPick,
  onRemove,
  className,
  aspect = "aspect-square",
}: {
  aspect?: string;
  product: Pictured;
  previewUrl?: string | null;
  editable: boolean;
  busy?: boolean;
  onPick: (photo: Blob) => void;
  onRemove?: () => void;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = { ...product, imageUrl: previewUrl ?? product.imageUrl };
  const hasPhoto = !!shown.imageUrl;

  const take = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      onPick(await preparePhoto(file));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className={className}>
      <div
        className={clsx("relative overflow-hidden rounded-xl", dragging && "ring-2 ring-ink ring-offset-2")}
        onDragOver={(e) => {
          if (!editable) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (!editable) return;
          e.preventDefault();
          setDragging(false);
          take(e.dataTransfer.files[0]);
        }}
      >
        <ProductImage product={shown} className={clsx(aspect, "w-full")} iconClassName="size-16" />
        {editable && !hasPhoto && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="absolute inset-0 flex flex-col items-center justify-end gap-1 pb-4 text-sm font-semibold text-ink/80 transition hover:bg-black/5"
          >
            <span className="rounded-full bg-white/90 px-3 py-1.5 shadow-card">Add a photo</span>
          </button>
        )}
      </div>
      {editable && (
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="subtle" icon={ImagePlus} loading={busy} onClick={() => input.current?.click()} className="flex-1">
            {hasPhoto ? "Replace photo" : "Upload photo"}
          </Button>
          {hasPhoto && onRemove && (
            <Button size="sm" variant="ghost" icon={Trash2} disabled={busy} onClick={onRemove}>
              Remove
            </Button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-bad">
          {error}
        </p>
      )}
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/*"
        className="hidden"
        aria-label="Product photo"
        onChange={(e) => {
          take(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
