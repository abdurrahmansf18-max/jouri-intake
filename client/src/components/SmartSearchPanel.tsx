import { Barcode, Camera, ImageUp, Loader2, Search, X } from "lucide-react";
import { useRef, useState } from "react";
import { visualSearchProducts } from "../api";
import { cn, COPY } from "../i18n";
import { productImageUrl } from "../api";
import type { ProductRecord } from "../types";
import type { ProductSearchResult } from "../search";
import type { ThemeStyles } from "../theme";

type SmartSearchCopy = (typeof COPY)[keyof typeof COPY];

interface Props {
  s: ThemeStyles;
  t: SmartSearchCopy;
  onBarcode: (code: string) => void;
  onOpenProduct: (record: ProductRecord) => void;
}

export default function SmartSearchPanel({ s, t, onBarcode, onOpenProduct }: Props) {
  const [barcodeOpen, setBarcodeOpen] = useState(false);
  const [manualBarcode, setManualBarcode] = useState("");
  const [visualOpen, setVisualOpen] = useState(false);
  const [visualBusy, setVisualBusy] = useState(false);
  const [visualResults, setVisualResults] = useState<ProductSearchResult[]>([]);
  const visualInputRef = useRef<HTMLInputElement>(null);

  async function handleVisualFile(file: File | null) {
    if (!file) return;
    setVisualOpen(true);
    setVisualBusy(true);
    try {
      setVisualResults(await visualSearchProducts(file));
    } finally {
      setVisualBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setBarcodeOpen(true)}
        className={cn("grid size-10 shrink-0 place-items-center rounded-xl border transition active:scale-95", s.controlGroup, s.controlIdle)}
        title={t.searchByBarcode}>
        <Barcode className="size-4 text-emerald-400" />
      </button>
      <button type="button" onClick={() => visualInputRef.current?.click()}
        className={cn("grid size-10 shrink-0 place-items-center rounded-xl border transition active:scale-95", s.controlGroup, s.controlIdle)}
        title={t.searchByImage}>
        <Camera className="size-4 text-emerald-400" />
      </button>
      <input
        ref={visualInputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => {
          handleVisualFile(e.currentTarget.files?.[0] ?? null);
          e.currentTarget.value = "";
        }}
      />

      {barcodeOpen && (
        <div className="fixed inset-0 z-[70] grid place-items-end bg-black/60 p-3 sm:place-items-center" onClick={() => setBarcodeOpen(false)}>
          <div className={cn("smart-pop w-full max-w-md rounded-2xl border p-4 shadow-2xl", s.panel)} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className={cn("flex items-center gap-2 text-sm font-black", s.title)}><Barcode className="size-4 text-emerald-400" /> {t.searchByBarcode}</h3>
              <button type="button" onClick={() => setBarcodeOpen(false)} className={cn("grid size-8 place-items-center rounded-lg border", s.controlGroup, s.controlIdle)}>
                <X className="size-4" />
              </button>
            </div>
            <BarcodeCamera onDetected={(code) => { onBarcode(code); setBarcodeOpen(false); }} s={s} t={t} />
            <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (manualBarcode.trim()) { onBarcode(manualBarcode.trim()); setBarcodeOpen(false); } }}>
              <input value={manualBarcode} onChange={(e) => setManualBarcode(e.target.value)} placeholder={t.barcodeManualPlaceholder} className={cn("min-h-11 min-w-0 flex-1 rounded-xl border px-3 font-mono text-sm outline-none focus:ring-4", s.input)} dir="ltr" />
              <button type="submit" className={cn("grid size-11 place-items-center rounded-xl", s.primary)}><Search className="size-4" /></button>
            </form>
          </div>
        </div>
      )}

      {visualOpen && (
        <div className="fixed inset-0 z-[70] grid place-items-end bg-black/60 p-3 sm:place-items-center" onClick={() => setVisualOpen(false)}>
          <div className={cn("smart-pop max-h-[86dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border p-4 shadow-2xl", s.panel)} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className={cn("flex items-center gap-2 text-sm font-black", s.title)}><ImageUp className="size-4 text-emerald-400" /> {t.visualSearchResultsTitle}</h3>
              <button type="button" onClick={() => setVisualOpen(false)} className={cn("grid size-8 place-items-center rounded-lg border", s.controlGroup, s.controlIdle)}>
                <X className="size-4" />
              </button>
            </div>
            {visualBusy ? (
              <div className="grid place-items-center py-12"><Loader2 className="size-8 animate-spin text-emerald-400" /></div>
            ) : (
              <div className="grid gap-2">
                {visualResults.map((result) => {
                  const image = result.record.images[0];
                  return (
                    <button key={result.record.id} type="button" onClick={() => { onOpenProduct(result.record); setVisualOpen(false); }}
                      className={cn("flex items-center gap-3 rounded-xl border p-2 text-start transition active:scale-[0.99]", s.controlGroup, s.controlIdle)}>
                      {image ? <img src={productImageUrl(result.record.id, image.fileName, undefined, image.folder)} className="size-16 rounded-lg object-cover" /> : <div className={cn("size-16 rounded-lg", s.subPanel)} />}
                      <span className="min-w-0 flex-1">
                        <span className={cn("block truncate text-sm font-black", s.title)}>{result.record.parsed.titleRaw}</span>
                        <span className="mt-1 block font-mono text-xs font-black text-emerald-400">{result.record.productCode}</span>
                      </span>
                      <span className="rounded-lg bg-emerald-400/15 px-2 py-1 text-xs font-black text-emerald-400">{result.score}%</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function BarcodeCamera({ onDetected, s, t }: { onDetected: (code: string) => void; s: ThemeStyles; t: SmartSearchCopy }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function scan(file: File | null) {
    if (!file) return;
    const detectorCtor = (window as any).BarcodeDetector;
    if (!detectorCtor) return;
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
    <div className={cn("rounded-xl border p-3", s.subPanel)}>
      <button type="button" onClick={() => inputRef.current?.click()} className={cn("inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-black", s.primary)}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
        {t.openCameraScanBarcode}
      </button>
      <input ref={inputRef} type="file" accept="image/*" className="sr-only" onChange={(e) => { scan(e.currentTarget.files?.[0] ?? null); e.currentTarget.value = ""; }} />
      <p className={cn("mt-2 text-xs leading-5", s.muted)}>{t.barcodeScanHelp}</p>
    </div>
  );
}
