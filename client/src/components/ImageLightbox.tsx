import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Trash2, X } from "lucide-react";
import { productImageUrl } from "../api";
import { cn } from "../i18n";
import type { SavedImage } from "../types";

interface Props {
  images: SavedImage[];
  initialIndex: number;
  productId: string;
  onClose: () => void;
  onDelete?: (image: SavedImage) => Promise<void>;
  deletingFileName?: string | null;
}

export default function ImageLightbox({ images, initialIndex, productId, onClose, onDelete, deletingFileName }: Props) {
  const [idx, setIdx] = useState(Math.min(initialIndex, images.length - 1));

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft")  setIdx((i) => Math.max(0, i - 1));
      if (e.key === "ArrowRight") setIdx((i) => Math.min(images.length - 1, i + 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [images.length, onClose]);

  const img = images[idx];
  if (!img) return null;

  const isDeletingThis = deletingFileName === img.fileName;

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black/90"
      onClick={onClose}
    >
      {/* Kapat */}
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 end-4 flex size-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition"
      >
        <X className="size-5" />
      </button>

      {/* Sayaç */}
      {images.length > 1 && (
        <div className="absolute top-4 start-4 rounded-full bg-black/50 px-3 py-1 text-xs font-bold text-white">
          {idx + 1} / {images.length}
        </div>
      )}

      {/* Görsel */}
      <div
        className="relative flex max-h-[80vh] max-w-[90vw] items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          key={img.fileName}
          src={productImageUrl(productId, img.fileName, img.folder)}
          alt={img.originalName}
          className="max-h-[80vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
          draggable={false}
        />
      </div>

      {/* Sol / Sağ oklar */}
      {idx > 0 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setIdx((i) => i - 1); }}
          className="absolute start-4 top-1/2 -translate-y-1/2 flex size-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition"
        >
          <ChevronLeft className="size-6" />
        </button>
      )}
      {idx < images.length - 1 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setIdx((i) => i + 1); }}
          className="absolute end-4 top-1/2 -translate-y-1/2 flex size-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition"
        >
          <ChevronRight className="size-6" />
        </button>
      )}

      {/* Alt bar: dosya adı + sil */}
      <div
        className="absolute bottom-4 flex items-center gap-3 rounded-full bg-black/60 px-4 py-2 backdrop-blur-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="max-w-[200px] truncate text-xs font-semibold text-white/70" dir="ltr">
          {img.fileName}
        </span>
        {onDelete && (
          <button
            type="button"
            disabled={isDeletingThis}
            onClick={() => onDelete(img)}
            className={cn(
              "flex size-8 items-center justify-center rounded-full transition",
              "bg-red-500/20 text-red-400 hover:bg-red-500/40",
              isDeletingThis && "opacity-50",
            )}
          >
            {isDeletingThis
              ? <Loader2 className="size-4 animate-spin" />
              : <Trash2 className="size-4" />}
          </button>
        )}
      </div>
    </div>
  );
}
