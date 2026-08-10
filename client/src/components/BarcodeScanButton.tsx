import { Camera, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "../i18n";
import type { ThemeStyles } from "../theme";

interface Props {
  s: ThemeStyles;
  title: string;
  onDetected: (code: string) => void;
  disabled?: boolean;
  className?: string;
}

export default function BarcodeScanButton({ s, title, onDetected, disabled, className }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function scan(file: File | null) {
    if (!file) return;
    const detectorCtor = (window as any).BarcodeDetector;
    if (!detectorCtor) {
      return;
    }
    setBusy(true);
    try {
      const bitmap = await createImageBitmap(file);
      const detector = new detectorCtor({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "qr_code"] });
      const codes = await detector.detect(bitmap);
      const value = codes?.[0]?.rawValue;
      if (value) onDetected(value);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
        title={title}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-lg border transition active:scale-95 disabled:opacity-50",
          s.controlGroup,
          s.controlIdle,
          className || "size-10",
        )}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4 text-emerald-400" />}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(event) => {
          scan(event.currentTarget.files?.[0] ?? null);
          event.currentTarget.value = "";
        }}
      />
    </>
  );
}
