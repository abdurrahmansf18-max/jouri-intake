import { useEffect, useState } from "react";
import {
  ArchiveRestore, Box, CalendarDays, Edit3, FolderOpen,
  ImagePlus, Images, Lock, Loader2, Palette, Plus, ReceiptText,
  RotateCcw, Ruler, Save, ShoppingBag, Tag, Trash2, Unlock, X,
} from "lucide-react";
import {
  addProductImages, deleteProduct, deleteProductImage,
  productImageUrl, resetSales, restoreProduct,
  sellProduct, updateProduct, updateStatus, verifyEditLock,
} from "../api";
import { useApp } from "../context";
import { COPY, cn, statusLabel } from "../i18n";
import { DARK, LIGHT, type ThemeStyles } from "../theme";
import type { ProductRecord, ProductStatus, SizeStock } from "../types";
import { statusActiveBadge, statusBadge } from "./ProductCard";
import ImageLightbox from "./ImageLightbox";
import SizeStockEditor, { type SizeStockRow } from "./SizeStockEditor";

const ACTIVE_STATUSES: ProductStatus[] = ["pending", "ai_enhanced", "published"];

type Mode = "view" | "edit";

type Draft = {
  titleRaw: string;
  categorySuggestion: string; productTypeSuggestion: string;
  priceAmount: string;
  colorRaw: string; colorGermanSuggestion: string;
  notes: string; description: string;
  restoreStock: string;
  saleQuantity: string; saleNote: string;
  saleSize: string;
};

function recordToDraft(r: ProductRecord): Draft {
  return {
    titleRaw: r.parsed.titleRaw,
    categorySuggestion: r.parsed.categorySuggestion,
    productTypeSuggestion: r.parsed.productTypeSuggestion,
    priceAmount: r.parsed.priceAmount,
    colorRaw: r.parsed.colorRaw,
    colorGermanSuggestion: r.parsed.colorGermanSuggestion,
    notes: r.notes || "",
    description: r.description || "",
    restoreStock: String(Math.max(1, r.stockQuantity || 1)),
    saleQuantity: "1",
    saleNote: "",
    saleSize: "",
  };
}

function sizeStocksToRows(ss: SizeStock[]): SizeStockRow[] {
  return ss.map((s) => ({ size: s.size, qty: String(s.qty) }));
}

interface Props {
  record: ProductRecord;
  initialMode?: Mode;
  onClose: () => void;
  onReplace: (updated: ProductRecord) => void;
  onDelete: (id: string) => void;
}

export default function ProductDetail({ record, initialMode = "view", onClose, onReplace, onDelete }: Props) {
  const { locale, theme, showToast } = useApp();
  const t = COPY[locale];
  const s = theme === "dark" ? DARK : LIGHT;

  const [mode, setMode] = useState<Mode>(initialMode);
  const [draft, setDraft] = useState<Draft>(() => recordToDraft(record));
  const [sizeRows, setSizeRows] = useState<SizeStockRow[]>(() => sizeStocksToRows(record.sizeStocks));
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [deletingImage, setDeletingImage] = useState<string | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<{ name: string; url: string }[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [editUnlocked, setEditUnlocked] = useState(false);
  const [unlockCode, setUnlockCode] = useState("");
  const [unlockError, setUnlockError] = useState(false);
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [sellError, setSellError] = useState("");

  useEffect(() => {
    setDraft(recordToDraft(record));
    setSizeRows(sizeStocksToRows(record.sizeStocks));
    setMode(initialMode);
    setDeleteConfirm(false);
    setImageFiles([]);
    setLightboxIdx(null);
    setEditUnlocked(false);
    setUnlockCode("");
    setUnlockError(false);
    setSellError("");
    setImagePreviews((c) => { c.forEach((p) => URL.revokeObjectURL(p.url)); return []; });
  }, [record.id, initialMode]);

  useEffect(() => () => { imagePreviews.forEach((p) => URL.revokeObjectURL(p.url)); }, [imagePreviews]);

  function patch(key: keyof Draft, val: string) { setDraft((d) => ({ ...d, [key]: val })); }
  function num(val: string, fb: number) { const n = parseInt(val, 10); return Number.isFinite(n) ? n : fb; }

  async function handleSave() {
    const validSizes = sizeRows
      .filter((r) => r.size.trim())
      .map((r) => ({ size: r.size.trim(), qty: Math.max(0, parseInt(r.qty, 10) || 0) }));

    if (validSizes.length === 0) {
      showToast(t.errSaveNeedSize, "error");
      return;
    }

    setBusy(true);
    try {

      const updated = await updateProduct(record.id, {
        notes: draft.notes,
        description: draft.description,
        sizeStocks: validSizes.length > 0 ? validSizes : undefined,
        parsed: {
          titleRaw: draft.titleRaw,
          categorySuggestion: draft.categorySuggestion,
          productTypeSuggestion: draft.productTypeSuggestion,
          priceAmount: draft.priceAmount,
          currency: "EUR",
          colorRaw: draft.colorRaw,
          colorGermanSuggestion: draft.colorGermanSuggestion,
        },
      });
      onReplace(updated);
      showToast(t.toastUpdated, "success");
      setMode("view");
    } catch (err) {
      const code = err instanceof Error ? err.message : "ERR_GENERAL";
      showToast(t.errors[code] ?? t.errors.ERR_GENERAL, "error");
    } finally { setBusy(false); }
  }

  async function handleStatusChange(status: ProductStatus) {
    if (busy || record.status === status) return;
    setBusy(true);
    try {
      const updated = await updateStatus(record.id, status);
      onReplace(updated);
      showToast(t.toastStatusUpdated, "success");
    } catch { showToast(t.errors.ERR_GENERAL, "error"); }
    finally { setBusy(false); }
  }

  async function handleSell() {
    const hasSizeStocks = record.sizeStocks.length > 0;
    if (hasSizeStocks && !draft.saleSize) {
      setSellError(t.errSizeSelectRequired);
      return;
    }
    setSellError("");
    setBusy(true);
    try {
      const updated = await sellProduct(record.id, num(draft.saleQuantity, 1), draft.saleSize, draft.saleNote);
      onReplace(updated);
      showToast(t.toastSold, "success");
      patch("saleQuantity", "1");
      patch("saleNote", "");
      patch("saleSize", "");
    } catch (err) {
      const code = err instanceof Error ? err.message : "ERR_GENERAL";
      showToast(t.errors[code] ?? t.errors.ERR_GENERAL, "error");
    }
    finally { setBusy(false); }
  }

  async function handleRestore() {
    setBusy(true);
    try {
      const updated = await restoreProduct(record.id, num(draft.restoreStock, 1));
      onReplace(updated);
      showToast(t.toastRestored, "success");
    } finally { setBusy(false); }
  }

  async function handleResetSales() {
    if (!window.confirm(t.resetSalesConfirm)) return;
    setBusy(true);
    try {
      const updated = await resetSales(record.id);
      onReplace(updated);
      showToast(t.toastSalesReset, "success");
    } finally { setBusy(false); }
  }

  async function handleUploadImages() {
    if (!imageFiles.length) return;
    setImageBusy(true);
    try {
      const updated = await addProductImages(record.id, imageFiles);
      onReplace(updated);
      setImageFiles([]);
      setImagePreviews((c) => { c.forEach((p) => URL.revokeObjectURL(p.url)); return []; });
      showToast(t.toastImagesAdded, "success");
    } catch { showToast(t.errors.ERR_GENERAL, "error"); }
    finally { setImageBusy(false); }
  }

  async function handleDeleteImage(fileName: string) {
    setDeletingImage(fileName);
    try {
      const updated = await deleteProductImage(record.id, "originals", fileName);
      onReplace(updated);
      if (lightboxIdx !== null) {
        const len = updated.images.length;
        if (len === 0) setLightboxIdx(null);
        else setLightboxIdx((i) => Math.min(i ?? 0, len - 1));
      }
    } catch { showToast(t.errors.ERR_GENERAL, "error"); }
    finally { setDeletingImage(null); }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      await deleteProduct(record.id);
      onDelete(record.id);
      showToast(t.toastDeleted, "success");
      onClose();
    } catch {
      showToast(t.errors.ERR_GENERAL, "error");
      setBusy(false);
    }
  }

  const p = record.parsed;
  const isArchive = record.status === "sold_archive";
  const dateLocale = locale === "ar" ? "ar" : "tr-TR";
  const isPublishedLocked = record.status === "published" && !editUnlocked;

  // Satış için geçerli bedenler (stok > 0)
  const availableSizes = record.sizeStocks.filter((ss) => ss.qty > 0);

  async function handleVerifyUnlock(e: React.FormEvent) {
    e.preventDefault();
    setUnlockBusy(true);
    setUnlockError(false);
    try {
      const ok = await verifyEditLock(unlockCode);
      if (ok) { setEditUnlocked(true); setUnlockCode(""); }
      else setUnlockError(true);
    } catch { setUnlockError(true); }
    finally { setUnlockBusy(false); }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60 p-0 sm:p-4" role="dialog" aria-modal="true">
        <div
          className={cn("ms-auto flex h-full w-full max-w-3xl flex-col overflow-hidden border shadow-2xl sm:rounded-2xl", s.panel)}
          dir={locale === "ar" ? "rtl" : "ltr"}
        >
          {/* ── Başlık ── */}
          <div className={cn("flex items-center gap-3 border-b px-4 py-3 sm:px-5", s.panelBorder)}>
            <div className="min-w-0 flex-1">
              <h2 className={cn("line-clamp-1 text-sm font-black tracking-tight", s.title)} dir="auto">
                {p.titleRaw || record.folderName}
              </h2>
            </div>
            {/* Masaüstü tab */}
            <div className={cn("hidden sm:inline-flex items-center gap-0.5 rounded-lg border p-0.5", s.controlGroup)}>
              <button type="button" onClick={() => setMode("view")}
                className={cn("rounded-md px-3 py-1.5 text-xs font-extrabold transition",
                  mode === "view" ? s.controlActive : s.controlIdle)}>
                {t.viewDetails}
              </button>
              <button type="button" onClick={() => setMode("edit")}
                className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-extrabold transition",
                  mode === "edit" ? s.controlActive : s.controlIdle)}>
                {isPublishedLocked && <Lock className="size-3" />}
                {t.editBtn}
              </button>
            </div>
            <button type="button" onClick={onClose}
              className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-lg border transition", s.controlGroup, s.controlIdle)}>
              <X className="size-4" />
            </button>
          </div>

          {/* Mobil tab */}
          <div className={cn("flex sm:hidden border-b", s.panelBorder)}>
            <button type="button" onClick={() => setMode("view")}
              className={cn("flex-1 py-2.5 text-xs font-extrabold transition border-b-2",
                mode === "view" ? "border-violet-400 text-violet-400" : cn("border-transparent", s.muted))}>
              {t.viewDetails}
            </button>
            <button type="button" onClick={() => setMode("edit")}
              className={cn("flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 text-xs font-extrabold transition border-b-2",
                mode === "edit" ? "border-violet-400 text-violet-400" : cn("border-transparent", s.muted))}>
              {isPublishedLocked && <Lock className="size-3" />}
              {t.editBtn}
            </button>
          </div>

          {/* ── İçerik ── */}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
            {mode === "view" ? (
              /* ────────────────── GÖRÜNTÜLEME MODU ────────────────── */
              <div className="grid gap-4">

                {/* Görseller */}
                {record.images.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {record.images.map((img, i) => (
                      <button key={img.fileName} type="button" onClick={() => setLightboxIdx(i)}
                        className="overflow-hidden rounded-xl ring-1 ring-white/10 active:scale-95 transition-transform">
                        <img src={productImageUrl(record.id, img.fileName)} alt={img.originalName}
                          className="aspect-square w-full object-cover" loading="lazy" />
                      </button>
                    ))}
                  </div>
                )}

                {/* Ürün bilgileri */}
                <section className={cn("rounded-xl border p-4", s.subPanel)}>
                  <div className={cn("divide-y", s.divider)}>
                    {/* Tarih + görsel sayısı */}
                    <InfoRow>
                      <span className={cn("inline-flex items-center gap-1 text-xs font-bold text-amber-400")}>
                        <CalendarDays className="size-3" />
                        {new Date(record.createdAt).toLocaleDateString(dateLocale)}
                      </span>
                      <span className={cn("text-xs", s.muted)}>·</span>
                      <span className={cn("inline-flex items-center gap-1 text-xs font-bold text-sky-400")}>
                        <Images className="size-3" />
                        {t.imageCount(record.images.length)}
                      </span>
                    </InfoRow>

                    {/* Fiyat */}
                    {p.priceAmount && <InfoRow label={t.price} s={s}>
                      <span className="font-black text-emerald-400">{p.priceAmount} {p.currency}</span>
                    </InfoRow>}

                    {/* Orijinal ad */}
                    {p.titleRaw && <InfoRow label={t.rawTitle} s={s}>
                      <span dir="auto">{p.titleRaw}</span>
                    </InfoRow>}


                    {/* Renk */}
                    {p.colorRaw && <InfoRow label={t.color} s={s}>
                      <span className="inline-flex items-center gap-1">
                        <Palette className="size-3 text-fuchsia-400" />
                        <span dir="auto">{p.colorRaw}</span>
                        {p.colorGermanSuggestion && <span className={cn("text-xs", s.muted)}>({p.colorGermanSuggestion})</span>}
                      </span>
                    </InfoRow>}

                    {/* Beden başına stok */}
                    {record.sizeStocks.length > 0 ? (
                      <InfoRow label={t.sizeStocksLabel} s={s}>
                        <div className="flex flex-wrap gap-1.5">
                          {record.sizeStocks.map((ss) => (
                            <span key={ss.size}
                              className={cn(
                                "inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs font-extrabold",
                                ss.qty > 0
                                  ? "bg-emerald-400/15 text-emerald-400 ring-1 ring-emerald-400/30"
                                  : "bg-slate-400/10 text-slate-400 line-through ring-1 ring-slate-400/20",
                              )}>
                              <Ruler className="size-2.5" />
                              {t.sizeStockDisplay(ss.size, ss.qty)}
                            </span>
                          ))}
                        </div>
                      </InfoRow>
                    ) : (
                      /* Eski sistem — beden metin + toplam stok */
                      <>
                        {p.sizesRaw && <InfoRow label={t.size} s={s}>
                          <span className="inline-flex items-center gap-1">
                            <Ruler className="size-3 text-sky-400" />
                            {p.sizesRaw}
                          </span>
                        </InfoRow>}
                        <InfoRow label={t.stockQuantity} s={s}>
                          <span className="inline-flex items-center gap-1">
                            <Box className="size-3 text-emerald-400" />
                            <span className="font-black text-emerald-400">{record.stockQuantity}</span>
                          </span>
                        </InfoRow>
                      </>
                    )}

                    {/* Toplam stok (sizeStocks varsa) */}
                    {record.sizeStocks.length > 0 && (
                      <InfoRow label={t.stockQuantity} s={s}>
                        <span className="inline-flex items-center gap-1">
                          <Box className="size-3 text-emerald-400" />
                          <span className="font-black text-emerald-400">{record.stockQuantity}</span>
                        </span>
                      </InfoRow>
                    )}

                    {/* Satılan */}
                    {record.soldQuantity > 0 && <InfoRow label={t.soldQuantity} s={s}>
                      <span className="inline-flex items-center gap-1 text-amber-400 font-bold">
                        <ShoppingBag className="size-3" />
                        {record.soldQuantity}
                      </span>
                    </InfoRow>}

                    {/* Kategori */}
                    {p.categorySuggestion && <InfoRow label={t.category} s={s}>
                      <span className="inline-flex items-center gap-1">
                        <Tag className="size-3 text-violet-400" />
                        {p.categorySuggestion}
                      </span>
                    </InfoRow>}

                    {/* Ürün tipi */}
                    {p.productTypeSuggestion && <InfoRow label={t.productType} s={s}>
                      <span>{p.productTypeSuggestion}</span>
                    </InfoRow>}
                  </div>
                </section>

                {/* Açıklama */}
                {record.description && (
                  <section className={cn("rounded-xl border p-4", s.subPanel)}>
                    <h3 className={cn("mb-2 text-xs font-black uppercase tracking-wide", s.muted)}>{t.description}</h3>
                    <p className={cn("text-sm leading-6 whitespace-pre-wrap", s.strong)} dir="auto">{record.description}</p>
                  </section>
                )}

                {/* Notlar */}
                {record.notes && (
                  <section className={cn("rounded-xl border p-4", s.subPanel)}>
                    <h3 className={cn("mb-2 text-xs font-black uppercase tracking-wide", s.muted)}>{t.notes}</h3>
                    <p className={cn("text-sm leading-6", s.strong)} dir="auto">{record.notes}</p>
                  </section>
                )}

                {/* Durum değiştirme */}
                {!isArchive && (
                  <section className={cn("rounded-xl border p-4", s.subPanel)}>
                    <h3 className={cn("mb-3 text-xs font-black uppercase tracking-wide", s.muted)}>{t.changeStatus}</h3>
                    {isPublishedLocked ? (
                      <div className={cn("flex items-center gap-2 text-xs font-semibold", s.muted)}>
                        <Lock className="size-3.5 text-emerald-400 shrink-0" />
                        {t.editLockedPublished}
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {ACTIVE_STATUSES.map((st) => (
                          <button key={st} type="button" disabled={busy} onClick={() => handleStatusChange(st)}
                            className={cn("rounded-lg border px-3 py-1.5 text-xs font-extrabold transition-all active:scale-95 disabled:opacity-50",
                              record.status === st ? statusActiveBadge(st, s) : cn(statusBadge(st, s), "opacity-60 hover:opacity-100"))}>
                            {statusLabel(st, locale)}
                          </button>
                        ))}
                      </div>
                    )}
                  </section>
                )}

                {/* Satış / Geri al */}
                {!isArchive ? (
                  <section className={cn("rounded-xl border p-4", s.subPanel)}>
                    <h3 className={cn("mb-3 flex items-center gap-2 text-sm font-extrabold", s.title)}>
                      <ReceiptText className="size-4 text-violet-400" /> {t.saleInfoTitle}
                    </h3>

                    <div className="grid gap-3">
                      {/* Beden seçimi (sizeStocks varsa) */}
                      {record.sizeStocks.length > 0 && (
                        availableSizes.length === 0 ? (
                          /* Tüm bedenler tükendi */
                          <div className={cn(
                            "flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold",
                            s.error,
                          )}>
                            <ShoppingBag className="size-4 shrink-0" />
                            {t.allSizesOutOfStock}
                          </div>
                        ) : (
                          <label className="grid gap-1.5">
                            <span className={cn("text-xs font-black", s.strong)}>{t.selectSizeForSale} *</span>
                            <select
                              value={draft.saleSize}
                              onChange={(e) => { patch("saleSize", e.target.value); setSellError(""); }}
                              className={cn(
                                "min-h-11 w-full rounded-xl border px-3 text-sm font-semibold outline-none focus:ring-4",
                                s.input,
                                sellError ? "border-red-400 focus:ring-red-500/15" : "",
                              )}
                            >
                              <option value="">— {t.selectSizeForSale} —</option>
                              {availableSizes.map((ss) => (
                                <option key={ss.size} value={ss.size}>
                                  {t.sizeStockDisplay(ss.size, ss.qty)}
                                </option>
                              ))}
                            </select>
                            {sellError && (
                              <p className={cn("text-xs font-semibold text-red-400")}>{sellError}</p>
                            )}
                          </label>
                        )
                      )}

                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="grid gap-1.5">
                          <span className={cn("text-xs font-black", s.strong)}>{t.saleQuantity}</span>
                          <input type="number" min={1}
                            max={draft.saleSize
                              ? record.sizeStocks.find((ss) => ss.size === draft.saleSize)?.qty ?? undefined
                              : undefined}
                            value={draft.saleQuantity}
                            onChange={(e) => patch("saleQuantity", e.target.value)}
                            className={cn("min-h-11 rounded-xl border px-3 text-sm font-semibold outline-none focus:ring-4", s.input)} />
                        </label>
                        <label className="grid gap-1.5">
                          <span className={cn("text-xs font-black", s.strong)}>{t.saleNote}</span>
                          <input value={draft.saleNote} onChange={(e) => patch("saleNote", e.target.value)}
                            placeholder={t.saleNotePlaceholder} dir="auto"
                            className={cn("min-h-11 rounded-xl border px-3 text-sm font-semibold outline-none focus:ring-4", s.input)} />
                        </label>
                      </div>
                    </div>

                    <button type="button" onClick={handleSell}
                      disabled={busy || (record.sizeStocks.length > 0 && availableSizes.length === 0)}
                      className={cn("mt-3 inline-flex w-full min-h-11 items-center justify-center gap-2 rounded-xl border text-sm font-extrabold transition disabled:opacity-60", s.error)}>
                      {busy ? <Loader2 className="size-4 animate-spin" /> : <ShoppingBag className="size-4" />}
                      {t.markSold}
                    </button>
                    {record.soldQuantity > 0 && (
                      <button type="button" onClick={handleResetSales} disabled={busy}
                        className={cn("mt-2 inline-flex w-full min-h-10 items-center justify-center gap-2 rounded-xl border text-xs font-extrabold transition disabled:opacity-60", s.controlGroup, s.controlIdle)}>
                        <RotateCcw className="size-3.5" /> {t.resetSales}
                      </button>
                    )}
                  </section>
                ) : (
                  <section className={cn("rounded-xl border p-4", s.subPanel)}>
                    <label className="grid gap-1.5 mb-2">
                      <span className={cn("text-xs font-black", s.strong)}>{t.restoreStock}</span>
                      <input type="number" min={1} value={draft.restoreStock} onChange={(e) => patch("restoreStock", e.target.value)}
                        className={cn("min-h-11 rounded-xl border px-3 text-sm font-semibold outline-none focus:ring-4", s.input)} />
                    </label>
                    {record.sizeStocks.length > 0 && (
                      <p className={cn("mb-3 text-xs font-semibold", s.muted)}>{t.restoreStockNote}</p>
                    )}
                    <button type="button" onClick={handleRestore} disabled={busy}
                      className={cn("inline-flex w-full min-h-11 items-center justify-center gap-2 rounded-xl border text-sm font-extrabold transition disabled:opacity-60", s.success)}>
                      <ArchiveRestore className="size-4" /> {t.restoreProduct}
                    </button>
                  </section>
                )}

                {/* Satış geçmişi */}
                {(record.saleHistory ?? []).length > 0 && (
                  <section className={cn("rounded-xl border p-4", s.subPanel)}>
                    <h3 className={cn("mb-3 text-sm font-extrabold", s.title)}>{t.saleHistory}</h3>
                    <div className="grid gap-2">
                      {[...record.saleHistory].reverse().map((sale, i) => (
                        <div key={`${sale.soldAt}-${i}`} className={cn("rounded-lg border px-3 py-2 text-xs", s.panelBorder)}>
                          <div className={cn("font-extrabold flex flex-wrap items-center gap-1", s.title)}>
                            {new Date(sale.soldAt).toLocaleString(dateLocale)}
                            <span className="text-violet-400">·</span>
                            <span>{sale.quantity} {t.soldQuantity.toLowerCase()}</span>
                            {sale.size && (
                              <>
                                <span className="text-violet-400">·</span>
                                <span className="inline-flex items-center gap-0.5 text-sky-400">
                                  <Ruler className="size-2.5" />{sale.size}
                                </span>
                              </>
                            )}
                          </div>
                          {sale.note && <div className={cn("mt-0.5", s.muted)} dir="auto">{sale.note}</div>}
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            ) : isPublishedLocked ? (
              /* ────────────────── KİLİT EKRANI ────────────────── */
              <div className="flex flex-col items-center justify-center py-16 gap-5 text-center">
                <div className={cn("flex size-16 items-center justify-center rounded-2xl border", s.subPanel)}>
                  <Lock className="size-8 text-emerald-400" />
                </div>
                <div>
                  <h3 className={cn("text-base font-black mb-1", s.title)}>{t.editLocked}</h3>
                  <p className={cn("text-sm leading-6 max-w-xs", s.muted)}>{t.editLockedPublished}</p>
                </div>
                <form onSubmit={handleVerifyUnlock} className="grid gap-3 w-full max-w-xs">
                  <input
                    type="password"
                    inputMode="numeric"
                    value={unlockCode}
                    onChange={(e) => { setUnlockCode(e.target.value); setUnlockError(false); }}
                    placeholder={t.unlockCodePlaceholder}
                    autoComplete="off"
                    className={cn(
                      "min-h-11 rounded-xl border px-3 text-center text-sm font-extrabold tracking-widest outline-none focus:ring-4",
                      s.input,
                      unlockError && "border-red-400 focus:ring-red-500/15",
                    )}
                  />
                  {unlockError && (
                    <p className={cn("rounded-xl border px-3 py-2 text-xs font-semibold text-center", s.error)}>
                      {t.unlockWrongCode}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={unlockBusy || !unlockCode}
                    className={cn(
                      "inline-flex items-center justify-center gap-2 rounded-xl border px-5 py-3 text-sm font-extrabold transition",
                      "border-amber-400/30 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 active:scale-95 disabled:opacity-50",
                    )}
                  >
                    {unlockBusy ? <Loader2 className="size-4 animate-spin" /> : <Unlock className="size-4" />}
                    {t.unlockSubmit}
                  </button>
                </form>
              </div>
            ) : (
              /* ────────────────── DÜZENLEME MODU ────────────────── */
              <div className="grid gap-5">

                {/* Kaydet */}
                <button type="button" onClick={handleSave} disabled={busy}
                  className={cn("inline-flex w-full min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-extrabold transition disabled:opacity-60", s.primary)}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  {t.saveChanges}
                </button>

                {/* Form */}
                <section className={cn("rounded-xl border p-4", s.subPanel)}>
                  <h3 className={cn("mb-3 flex items-center gap-2 text-sm font-extrabold", s.title)}>
                    <Edit3 className="size-4 text-violet-400" /> {t.editProduct}
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <DetailField label={t.rawTitle}            s={s} value={draft.titleRaw}              onChange={(v) => patch("titleRaw", v)} />
                    <DetailField label={t.price}               s={s} value={draft.priceAmount}            onChange={(v) => patch("priceAmount", v)} />
                    <DetailField label={t.color}               s={s} value={draft.colorRaw}               onChange={(v) => patch("colorRaw", v)} />
                    <DetailField label={t.category}            s={s} value={draft.categorySuggestion}     onChange={(v) => patch("categorySuggestion", v)} />
                    <DetailField label={t.productType}         s={s} value={draft.productTypeSuggestion}  onChange={(v) => patch("productTypeSuggestion", v)} />
                  </div>

                  {/* Beden + stok editörü */}
                  <div className="mt-3 grid gap-1.5">
                    <span className={cn("flex items-center gap-2 text-xs font-black", s.strong)}>
                      <Ruler className="size-3.5 text-sky-400" />
                      {t.sizeStocksLabel}
                    </span>
                    <SizeStockEditor
                      value={sizeRows}
                      onChange={setSizeRows}
                      s={s}
                      sizeNamePlaceholder={t.sizeNamePlaceholder}
                      sizeQtyPlaceholder={t.sizeQtyPlaceholder}
                      addRowLabel={t.addSizeRow}
                    />
                  </div>

                  <label className="mt-3 grid gap-1.5">
                    <span className={cn("text-xs font-black", s.strong)}>{t.description}</span>
                    <textarea className={cn("min-h-24 rounded-xl border px-3 py-3 text-sm leading-6 outline-none focus:ring-4", s.input)}
                      value={draft.description} onChange={(e) => patch("description", e.target.value)} dir="auto" />
                  </label>
                  <label className="mt-3 grid gap-1.5">
                    <span className={cn("text-xs font-black", s.strong)}>{t.notes}</span>
                    <textarea className={cn("min-h-20 rounded-xl border px-3 py-3 text-sm leading-6 outline-none focus:ring-4", s.input)}
                      value={draft.notes} onChange={(e) => patch("notes", e.target.value)}
                      placeholder={t.notesPlaceholder} dir="auto" />
                  </label>
                </section>

                {/* Görseller */}
                <section className={cn("rounded-xl border p-4", s.subPanel)}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className={cn("flex items-center gap-2 text-sm font-extrabold", s.title)}>
                      <Images className="size-4 text-violet-400" /> {t.images}
                    </h3>
                    {imageFiles.length > 0 && (
                      <button type="button" onClick={handleUploadImages} disabled={imageBusy}
                        className={cn("inline-flex min-h-9 items-center gap-2 rounded-xl px-3 text-xs font-extrabold transition disabled:opacity-60", s.primary)}>
                        {imageBusy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                        {t.uploadSelectedImages}
                      </button>
                    )}
                  </div>

                  {record.images.length > 0 && (
                    <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {record.images.map((img, i) => (
                        <div key={img.fileName} className="relative overflow-hidden rounded-xl">
                          <button type="button" onClick={() => setLightboxIdx(i)} className="block w-full">
                            <img src={productImageUrl(record.id, img.fileName)} alt={img.originalName}
                              className="aspect-square w-full object-cover" loading="lazy" />
                          </button>
                          <button type="button" disabled={deletingImage === img.fileName}
                            onClick={() => handleDeleteImage(img.fileName)}
                            className={cn("absolute bottom-1 end-1 flex size-7 items-center justify-center rounded-full",
                              "bg-black/60 text-red-400 hover:bg-red-500/80 hover:text-white transition active:scale-95",
                              deletingImage === img.fileName && "opacity-50")}>
                            {deletingImage === img.fileName
                              ? <Loader2 className="size-3.5 animate-spin" />
                              : <Trash2 className="size-3.5" />}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <label className={cn("mb-3 grid cursor-pointer place-items-center rounded-xl border border-dashed px-4 py-4 text-center transition", s.dropzone)}>
                    <input className="sr-only" type="file" accept="image/*" multiple
                      onChange={(e) => {
                        const sel = Array.from(e.currentTarget.files ?? []);
                        setImageFiles(sel);
                        setImagePreviews((c) => { c.forEach((p) => URL.revokeObjectURL(p.url)); return sel.map((f) => ({ name: f.name, url: URL.createObjectURL(f) })); });
                      }} />
                    <span className={cn("mb-2 flex size-10 items-center justify-center rounded-xl ring-1", s.dropIcon)}>
                      <ImagePlus className="size-4" />
                    </span>
                    <span className={cn("text-sm font-extrabold", s.title)}>{t.addImages}</span>
                    <span className={cn("mt-0.5 text-xs", s.muted)}>{t.addImagesHelp}</span>
                  </label>
                  {imagePreviews.length > 0 && (
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {imagePreviews.map((prev) => (
                        <figure key={prev.name} className={cn("overflow-hidden rounded-xl border", s.panelBorder)}>
                          <img src={prev.url} alt={prev.name} className="aspect-square w-full object-cover" />
                        </figure>
                      ))}
                    </div>
                  )}
                </section>

                {/* Klasörler */}
                <section className={cn("rounded-xl border p-4", s.subPanel)}>
                  <h3 className={cn("mb-3 flex items-center gap-2 text-sm font-extrabold", s.title)}>
                    <FolderOpen className="size-4 text-violet-400" /> {t.folders}
                  </h3>
                  {[[t.originalFolder, record.imageFolders.originals.relativePath],
                    [t.aiFolderLabel,  record.imageFolders.enhanced.relativePath]].map(([label, val]) => (
                    <div key={label} className={cn("flex min-w-0 items-start gap-2 border-t py-2 first:border-t-0 first:pt-0 text-xs", s.folderLine)}>
                      <FolderOpen className={cn("mt-0.5 size-4 shrink-0", s.folderIcon)} />
                      <span className={cn("shrink-0 font-black", s.strong)}>{label}:</span>
                      <span className={cn("min-w-0 break-all", s.muted)} dir="ltr">{val}</span>
                    </div>
                  ))}
                </section>

                {/* Sil */}
                <section className={cn("rounded-xl border p-4", s.subPanel)}>
                  {!deleteConfirm ? (
                    <button type="button" onClick={() => setDeleteConfirm(true)}
                      className={cn("inline-flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-extrabold transition", s.error)}>
                      <Trash2 className="size-4" /> {t.deleteProduct}
                    </button>
                  ) : (
                    <div className="grid gap-3">
                      <p className={cn("text-sm font-bold", s.title)}>{t.deleteConfirmTitle}</p>
                      <p className={cn("text-xs leading-5", s.muted)}>{t.deleteConfirmText}</p>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setDeleteConfirm(false)}
                          className={cn("flex-1 rounded-xl border px-4 py-2.5 text-sm font-extrabold transition", s.controlGroup, s.controlIdle)}>
                          {t.deleteCancel}
                        </button>
                        <button type="button" onClick={handleDelete} disabled={busy}
                          className={cn("flex-1 inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-extrabold transition disabled:opacity-60", s.error)}>
                          {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                          {t.deleteConfirm}
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Lightbox */}
      {lightboxIdx !== null && record.images.length > 0 && (
        <ImageLightbox
          images={record.images}
          initialIndex={lightboxIdx}
          productId={record.id}
          onClose={() => setLightboxIdx(null)}
          onDelete={mode === "edit" ? handleDeleteImage : undefined}
          deletingFileName={deletingImage}
        />
      )}
    </>
  );
}

// ── Yardımcı bileşenler ───────────────────────────────────────────────────────

function InfoRow({ label, s, children }: { label?: string; s?: ThemeStyles; children: React.ReactNode }) {
  if (!label) {
    return <div className="flex items-center gap-2 py-2">{children}</div>;
  }
  return (
    <div className="flex items-start gap-2 py-2">
      <span className={cn("w-28 shrink-0 text-xs font-black pt-0.5", s?.strong ?? "text-slate-400")}>{label}</span>
      <span className={cn("min-w-0 flex-1 text-sm font-semibold", s?.title ?? "text-white")}>{children}</span>
    </div>
  );
}

function DetailField({ label, onChange, s, type = "text", value }: {
  label: string; onChange: (v: string) => void; s: ThemeStyles; type?: "number" | "text"; value: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className={cn("text-xs font-black", s.strong)}>{label}</span>
      <input className={cn("min-h-11 rounded-xl border px-3 text-sm font-semibold outline-none focus:ring-4", s.input)}
        type={type} min={type === "number" ? 0 : undefined}
        value={value} onChange={(e) => onChange(e.target.value)} dir="auto" />
    </label>
  );
}
