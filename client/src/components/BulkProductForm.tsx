import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, CheckCircle2, ClipboardList, Loader2, Package,
  Plus, Ruler, Save, Trash2, UploadCloud, X,
} from "lucide-react";
import { createProduct } from "../api";
import { useApp } from "../context";
import { COPY, cn } from "../i18n";
import { DARK, LIGHT, type ThemeStyles } from "../theme";
import { formatPrice } from "../format";
import SizeStockEditor, { type SizeStockRow } from "./SizeStockEditor";
import BarcodeScanButton from "./BarcodeScanButton";

// ── Tipler ───────────────────────────────────────────────────────────────────

type BulkDraft = {
  id: string;
  titleRaw: string;
  priceAmount: string;
  colorRaw: string;
  season: string;
  fabricType: string;
  categorySuggestion: string;
  productTypeSuggestion: string;
  barcode: string;
  description: string;
  notes: string;
  files: File[];
  previews: { name: string; url: string }[];
  sizeRows: SizeStockRow[];
  error?: string;
  submitted?: boolean;
};

function makeDraft(): BulkDraft {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    titleRaw: "",
    priceAmount: "",
    colorRaw: "",
    season: "",
    fabricType: "",
    categorySuggestion: "",
    productTypeSuggestion: "",
    barcode: "",
    description: "",
    notes: "",
    files: [],
    previews: [],
    sizeRows: [{ size: "", qty: "1" }],
  };
}

// ── Ana bileşen ───────────────────────────────────────────────────────────────

export default function BulkProductForm({ initialCards }: { initialCards?: BulkDraft[] }) {
  const { locale, theme, showToast } = useApp();
  const t = COPY[locale];
  const s = theme === "dark" ? DARK : LIGHT;
  const navigate = useNavigate();

  const [cards, setCards] = useState<BulkDraft[]>(() => initialCards || [makeDraft(), makeDraft()]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [quickCount, setQuickCount] = useState(1);

  useEffect(() => {
    if (initialCards && initialCards.length > 0) {
      setCards(initialCards);
    }
  }, [initialCards]);

  // Unmount'ta blob URL'leri temizle
  const cardsRef = useRef<BulkDraft[]>(cards);
  useEffect(() => { cardsRef.current = cards; }, [cards]);
  useEffect(() => {
    return () => { cardsRef.current.forEach((c) => c.previews.forEach((p) => URL.revokeObjectURL(p.url))); };
  }, []);

  // ── State güncellemeleri ──────────────────────────────────────────────────

  function patch(id: string, update: Partial<BulkDraft>) {
    setCards((prev) => prev.map((c) => c.id === id ? { ...c, ...update, error: undefined } : c));
  }

  function addCard() {
    setCards((prev) => [...prev, makeDraft()]);
  }

  function addCards(n: number) {
    setCards((prev) => [...prev, ...Array.from({ length: n }, makeDraft)]);
  }

  function removeCard(id: string) {
    setCards((prev) => {
      const card = prev.find((c) => c.id === id);
      if (card) card.previews.forEach((p) => URL.revokeObjectURL(p.url));
      return prev.filter((c) => c.id !== id);
    });
  }

  function handleFiles(id: string, newFiles: File[]) {
    setCards((prev) => prev.map((c) => {
      if (c.id !== id) return c;
      const combined = [...c.files, ...newFiles].slice(0, 5);
      c.previews.forEach((p) => URL.revokeObjectURL(p.url));
      return {
        ...c,
        files: combined,
        previews: combined.map((f) => ({ name: f.name, url: URL.createObjectURL(f) })),
        error: undefined,
      };
    }));
  }

  function removeFile(id: string, idx: number) {
    setCards((prev) => prev.map((c) => {
      if (c.id !== id) return c;
      URL.revokeObjectURL(c.previews[idx]?.url ?? "");
      return {
        ...c,
        files: c.files.filter((_, i) => i !== idx),
        previews: c.previews.filter((_, i) => i !== idx),
      };
    }));
  }

  // ── Doğrulama ─────────────────────────────────────────────────────────────
  // NOT: setCards(fn) içinde closure mutation güvenilir değil (React 18).
  // Bunun yerine cards.map() ile senkron hesapla, sonra setCards çağır.

  function validate(): boolean {
    const checked = cards.map((c) => {
      if (c.submitted) return c;
      if (!c.files.length) return { ...c, error: t.emptyImg };
      if (!c.titleRaw.trim()) return { ...c, error: t.errTitleRequired };
      if (!c.priceAmount.trim()) return { ...c, error: t.errPriceRequired };
      if (!c.colorRaw.trim()) return { ...c, error: t.errColorRequired };
      const validSizes = c.sizeRows.filter((r) => r.size.trim() && parseInt(r.qty, 10) >= 1);
      if (!validSizes.length) return { ...c, error: t.errSizeRequired };
      return { ...c, error: undefined };
    });
    const hasErrors = checked.some((c) => !!c.error);
    if (hasErrors) setCards(checked);
    return !hasErrors;
  }

  // ── Gönderim ──────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!validate()) return;

    const pending = cards.filter((c) => !c.submitted);
    setBusy(true);
    setProgress({ done: 0, total: pending.length });

    const results: { id: string; ok: boolean }[] = [];

    for (const card of pending) {
      try {
        const validSizes = card.sizeRows
          .filter((r) => r.size.trim())
          .map((r) => ({ size: r.size.trim(), qty: Math.max(0, parseInt(r.qty, 10) || 0), barcode: r.barcode?.trim() || "" }));

        const description = card.description.trim() ||
          [card.titleRaw, card.colorRaw, card.priceAmount && formatPrice(card.priceAmount, "EUR")]
            .filter(Boolean).join(" · ");

        await createProduct(description, card.files, {
          notes: card.notes,
          barcodes: card.barcode.trim() ? [card.barcode.trim()] : [],
          sizeStocks: validSizes,
          parsed: {
            titleRaw: card.titleRaw,
            categorySuggestion: card.categorySuggestion,
            productTypeSuggestion: card.productTypeSuggestion,
            priceAmount: card.priceAmount,
            currency: "EUR",
            colorRaw: card.colorRaw,
            season: card.season,
            fabricType: card.fabricType,
          },
        }, "bulk");
        results.push({ id: card.id, ok: true });
      } catch {
        results.push({ id: card.id, ok: false });
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }

    const ok = results.filter((r) => r.ok).length;
    const fail = results.filter((r) => !r.ok).length;
    const failedIds = new Set(results.filter((r) => !r.ok).map((r) => r.id));

    // Başarılıları temizle, başarısızları hata ile bırak
    setCards((prev) => {
      prev.forEach((c) => {
        if (!failedIds.has(c.id) && !c.submitted) {
          c.previews.forEach((p) => URL.revokeObjectURL(p.url));
        }
      });
      return prev
        .filter((c) => failedIds.has(c.id) || c.submitted)
        .map((c) => failedIds.has(c.id) ? { ...c, error: t.errors.ERR_GENERAL } : c);
    });

    setBusy(false);

    if (fail === 0) {
      showToast(t.bulkDone(ok), "success");
      navigate("/products");
    } else {
      showToast(t.bulkPartialFail(ok, fail), "error");
    }
  }

  const pendingCount = cards.filter((c) => !c.submitted).length;

  return (
    <div className="grid gap-4">

      {/* ── Kontrol çubuğu ── */}
      <div className={cn("flex items-center gap-3 rounded-xl border px-4 py-3", s.subPanel)}>
        {/* Kart sayacı */}
        <div className="flex items-center gap-2">
          <Package className="size-4 text-emerald-400 shrink-0" />
          <span className={cn("text-sm font-extrabold", s.title)}>
            {t.bulkCardCount(cards.length)}
          </span>
        </div>

        {/* Hızlı ekle */}
        {!busy && (
          <div className="flex items-center gap-2 ms-auto">
            <input
              type="number"
              min={1}
              max={20}
              value={quickCount}
              onChange={(e) => setQuickCount(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
              className={cn(
                "w-14 rounded-lg border px-2 py-1.5 text-center text-sm font-extrabold outline-none focus:ring-2",
                s.input,
              )}
            />
            <button
              type="button"
              onClick={() => addCards(quickCount)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-extrabold transition active:scale-95",
                s.controlGroup, s.controlIdle,
              )}
            >
              <Plus className="size-3.5" />
              {t.bulkQuickAdd(quickCount)}
            </button>
          </div>
        )}
      </div>

      {cards.map((card, idx) => (
        <BulkCard
          key={card.id}
          card={card}
          index={idx}
          busy={busy}
          canRemove={cards.length > 1 && !card.submitted}
          onPatch={(u) => patch(card.id, u)}
          onRemove={() => removeCard(card.id)}
          onFiles={(files) => handleFiles(card.id, files)}
          onRemoveFile={(i) => removeFile(card.id, i)}
        />
      ))}

      {/* Tekli ekle butonu */}
      {!busy && (
        <button
          type="button"
          onClick={addCard}
          className={cn(
            "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed text-sm font-extrabold transition active:scale-95",
            s.dropzone,
          )}
        >
          <Plus className="size-4" /> {t.bulkAddCard}
        </button>
      )}

      {/* Yapışkan gönder çubuğu */}
      <div className={cn("sticky bottom-20 md:bottom-4 z-10 rounded-xl border p-3 shadow-xl", s.panel)}>
        {busy ? (
          <div className="flex items-center justify-center gap-3 py-0.5">
            <Loader2 className="size-5 animate-spin text-emerald-400" />
            <span className={cn("text-sm font-extrabold", s.title)}>
              {t.bulkProgress(progress.done, progress.total)}
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={pendingCount === 0}
            className={cn(
              "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-extrabold transition active:scale-95 disabled:opacity-50",
              s.primary,
            )}
          >
            <Save className="size-4" />
            {t.bulkSubmit(pendingCount)}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Ürün kartı ────────────────────────────────────────────────────────────────

function BulkCard({ card, index, busy, canRemove, onPatch, onRemove, onFiles, onRemoveFile }: {
  card: BulkDraft;
  index: number;
  busy: boolean;
  canRemove: boolean;
  onPatch: (u: Partial<BulkDraft>) => void;
  onRemove: () => void;
  onFiles: (files: File[]) => void;
  onRemoveFile: (idx: number) => void;
}) {
  const { locale, theme } = useApp();
  const t = COPY[locale];
  const s = theme === "dark" ? DARK : LIGHT;

  if (card.submitted) {
    return (
      <div className={cn("flex items-center gap-3 rounded-xl border px-4 py-3", s.success)}>
        <CheckCircle2 className="size-4 shrink-0" />
        <span className="text-sm font-bold">{t.bulkProductNum(index + 1)} — {card.titleRaw}</span>
      </div>
    );
  }

  return (
    <div className={cn(
      "rounded-xl border",
      card.error ? "border-red-400/50" : "",
      s.panel,
    )}>
      {/* Kart başlığı */}
      <div className={cn("flex items-center justify-between gap-2 border-b px-4 py-3", s.panelBorder)}>
        <div className="flex min-w-0 items-center gap-2">
          <Package className="size-4 shrink-0 text-emerald-400" />
          <span className={cn("shrink-0 text-sm font-extrabold", s.title)}>
            {t.bulkProductNum(index + 1)}
          </span>
          {card.titleRaw && (
            <span className={cn("truncate text-xs font-semibold", s.muted)} dir="auto">
              {card.titleRaw}
            </span>
          )}
        </div>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className={cn(
              "inline-flex size-7 shrink-0 items-center justify-center rounded-lg border transition active:scale-95",
              s.error,
            )}
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>

      <div className="grid gap-3 p-4">
        {/* Hata */}
        {card.error && (
          <div className={cn("flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-semibold", s.error)}>
            <AlertTriangle className="size-3.5 shrink-0" />
            {card.error}
          </div>
        )}

        {/* Görsel yükleme */}
        <div>
          <label className={cn(
            "flex cursor-pointer items-center gap-2 rounded-xl border border-dashed px-3 py-2.5 transition",
            busy ? "cursor-default opacity-60" : "",
            s.dropzone,
          )}>
            <input
              className="sr-only"
              type="file"
              accept="image/*"
              multiple
              disabled={busy}
              onChange={(e) => {
                onFiles(Array.from(e.currentTarget.files ?? []));
                e.currentTarget.value = "";
              }}
            />
            <UploadCloud className="size-4 shrink-0 text-emerald-400" />
            <span className={cn("flex-1 text-xs font-semibold", s.muted)}>
              {card.files.length > 0 ? t.imageCount(card.files.length) : t.chooseGallery}
            </span>
            {card.files.length > 0 && (
              <span className="text-[10px] font-bold text-emerald-400">{card.files.length}/5</span>
            )}
          </label>

          {card.previews.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {card.previews.map((p, i) => (
                <div key={p.name} className="relative">
                  <img
                    src={p.url}
                    alt={p.name}
                    className="size-14 rounded-lg object-cover ring-1 ring-white/10"
                  />
                  {!busy && (
                    <button
                      type="button"
                      onClick={() => onRemoveFile(i)}
                      className="absolute -end-1 -top-1 flex size-5 items-center justify-center rounded-full bg-black/70 text-red-400 transition hover:bg-red-500 hover:text-white"
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Alanlar — 2 kolonlu grid */}
        <div className="grid grid-cols-2 gap-2">
          <BulkField
            label={`${t.rawTitle} *`}
            value={card.titleRaw}
            onChange={(v) => onPatch({ titleRaw: v })}
            s={s} disabled={busy}
          />
          <BulkField
            label={`${t.price} *`}
            value={card.priceAmount}
            onChange={(v) => onPatch({ priceAmount: v })}
            s={s} disabled={busy} prefix="€" inputDir="ltr"
          />
          <BulkField
            label={`${t.color} *`}
            value={card.colorRaw}
            onChange={(v) => onPatch({ colorRaw: v })}
            s={s} disabled={busy}
          />
          <BulkField
            label={t.category}
            value={card.categorySuggestion}
            onChange={(v) => onPatch({ categorySuggestion: v })}
            s={s} disabled={busy}
          />
          <BulkSeasonField
            label={t.season}
            value={card.season}
            onChange={(v) => onPatch({ season: v })}
            s={s} disabled={busy}
          />
          <BulkField
            label={(t as any).fabricType || "Kumaş"}
            value={card.fabricType}
            onChange={(v) => onPatch({ fabricType: v })}
            s={s} disabled={busy}
          />
          <BulkField
            label={t.productType}
            value={card.productTypeSuggestion}
            onChange={(v) => onPatch({ productTypeSuggestion: v })}
            s={s} disabled={busy}
            className="col-span-2"
          />
          <BulkField
            label={t.barcodeOptional}
            value={card.barcode}
            onChange={(v) => onPatch({ barcode: v })}
            s={s} disabled={busy}
            placeholder={t.barcodeManualPlaceholder}
            inputDir="ltr"
            barcodeScanTitle={t.openCameraScanBarcode}
            className="col-span-2"
          />
          <BulkField
            label={t.notes}
            value={card.notes}
            onChange={(v) => onPatch({ notes: v })}
            s={s} disabled={busy}
            placeholder={t.notesPlaceholder}
            className="col-span-2"
          />
        </div>

        {/* Açıklama */}
        <label className="grid gap-1">
          <span className={cn("flex items-center gap-1.5 text-[10px] font-black", s.strong)}>
            <ClipboardList className="size-3 text-emerald-400" />
            {t.description}
          </span>
          <textarea
            value={card.description}
            onChange={(e) => onPatch({ description: e.target.value })}
            disabled={busy}
            placeholder={t.sampleDesc || t.descriptionHelp(0).split("·")[0].trim()}
            dir="auto"
            rows={3}
            className={cn(
              "w-full rounded-lg border px-2.5 py-2 text-xs font-semibold leading-5 outline-none focus:ring-2 resize-none",
              s.input,
            )}
          />
        </label>

        {/* Bedenler */}
        <div>
          <span className={cn("mb-1.5 flex items-center gap-1.5 text-xs font-black", s.strong)}>
            <Ruler className="size-3 text-sky-400" /> {t.sizeStocksLabel} *
          </span>
          <SizeStockEditor
            value={card.sizeRows}
            onChange={(rows) => onPatch({ sizeRows: rows })}
            s={s}
            sizeNamePlaceholder={t.sizeNamePlaceholder}
            sizeQtyPlaceholder={t.sizeQtyPlaceholder}
            addRowLabel={t.addSizeRow}
            barcodePlaceholder={t.sizeBarcodePlaceholder}
            barcodeScanTitle={t.openCameraScanBarcode}
          />
        </div>
      </div>
    </div>
  );
}

// ── Yardımcı alan bileşeni ────────────────────────────────────────────────────

function BulkField({ label, value, onChange, s, disabled, inputDir = "auto", placeholder, prefix, className, barcodeScanTitle }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  s: ThemeStyles;
  disabled: boolean;
  inputDir?: "auto" | "ltr" | "rtl";
  placeholder?: string;
  prefix?: string;
  className?: string;
  barcodeScanTitle?: string;
}) {
  return (
    <label className={cn("grid gap-1", className)}>
      <span className={cn("text-[10px] font-black leading-none", s.strong)}>{label}</span>
      <span className={cn("relative flex gap-2", barcodeScanTitle ? "items-center" : "block")}>
        {prefix ? (
          <span className={cn("pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-black", s.muted)}>
            {prefix}
          </span>
        ) : null}
        <input
          className={cn(
            "min-h-9 min-w-0 flex-1 rounded-lg border px-2.5 text-xs font-semibold outline-none focus:ring-2",
            prefix && "pl-7",
            s.input,
          )}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          dir={inputDir}
        />
        {barcodeScanTitle && (
          <BarcodeScanButton
            s={s}
            title={barcodeScanTitle}
            onDetected={onChange}
            disabled={disabled}
            className="size-9 rounded-lg"
          />
        )}
      </span>
    </label>
  );
}

function BulkSeasonField({ label, value, onChange, s, disabled }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  s: ThemeStyles;
  disabled: boolean;
}) {
  const seasons = ["Summer", "Winter", "Spring"];
  return (
    <label className="grid gap-1">
      <span className={cn("text-[10px] font-black leading-none", s.strong)}>{label}</span>
      <select
        className={cn("min-h-9 w-full rounded-lg border px-2.5 text-xs font-semibold outline-none focus:ring-2", s.input)}
        value={seasons.includes(value) ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        <option value="">-</option>
        {seasons.map((season) => (
          <option key={season} value={season}>{season}</option>
        ))}
      </select>
    </label>
  );
}
