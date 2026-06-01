import { useEffect, useState } from "react";
import {
  ArchiveRestore, Box, CalendarDays, Edit3, FolderOpen,
  ImagePlus, Images, Loader2, Palette, Plus, ReceiptText,
  RotateCcw, Ruler, Save, ShoppingBag, Tag, Trash2, X,
} from "lucide-react";
import {
  addProductImages, deleteProduct, deleteProductImage,
  productImageUrl, resetSales, restoreProduct,
  sellProduct, updateProduct, updateStatus,
} from "../api";
import { useApp } from "../context";
import { COPY, cn, statusLabel } from "../i18n";
import { DARK, LIGHT, type ThemeStyles } from "../theme";
import type { ProductRecord, ProductStatus } from "../types";
import { statusActiveBadge, statusBadge } from "./ProductCard";
import ImageLightbox from "./ImageLightbox";

const ACTIVE_STATUSES: ProductStatus[] = ["pending", "ai_enhanced", "published"];

type Mode = "view" | "edit";

type Draft = {
  titleRaw: string; germanTitleSuggestion: string;
  categorySuggestion: string; productTypeSuggestion: string;
  priceAmount: string; currency: string;
  colorRaw: string; colorGermanSuggestion: string;
  sizesRaw: string; notes: string; description: string;
  stockQuantity: string; restoreStock: string;
  saleQuantity: string; saleNote: string;
};

function recordToDraft(r: ProductRecord): Draft {
  return {
    titleRaw: r.parsed.titleRaw,
    germanTitleSuggestion: r.parsed.germanTitleSuggestion,
    categorySuggestion: r.parsed.categorySuggestion,
    productTypeSuggestion: r.parsed.productTypeSuggestion,
    priceAmount: r.parsed.priceAmount,
    currency: r.parsed.currency || "EUR",
    colorRaw: r.parsed.colorRaw,
    colorGermanSuggestion: r.parsed.colorGermanSuggestion,
    sizesRaw: r.parsed.sizesRaw,
    notes: r.notes || "",
    description: r.description || "",
    stockQuantity: String(Math.max(0, r.stockQuantity)),
    restoreStock: String(Math.max(1, r.stockQuantity || 1)),
    saleQuantity: String(Math.max(1, r.stockQuantity)),
    saleNote: "",
  };
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
  const dateLocale = locale === "ar" ? "ar" : "tr-TR";

  const [mode, setMode] = useState<Mode>(initialMode);
  const [draft, setDraft] = useState<Draft>(() => recordToDraft(record));
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [deletingImage, setDeletingImage] = useState<string | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<{ name: string; url: string }[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  useEffect(() => {
    setDraft(recordToDraft(record));
    setMode(initialMode);
    setDeleteConfirm(false);
    setImageFiles([]);
    setLightboxIdx(null);
    setImagePreviews((curr) => { curr.forEach((p) => URL.revokeObjectURL(p.url)); return []; });
  }, [record.id, initialMode]);

  useEffect(() => () => { imagePreviews.forEach((p) => URL.revokeObjectURL(p.url)); }, [imagePreviews]);

  function patch(key: keyof Draft, val: string) { setDraft((d) => ({ ...d, [key]: val })); }
  function num(val: string, fb: number) { const n = parseInt(val, 10); return Number.isFinite(n) ? n : fb; }

  async function handleSave() {
    setBusy(true);
    try {
      const updated = await updateProduct(record.id, {
        notes: draft.notes, description: draft.description,
        stockQuantity: num(draft.stockQuantity, 1),
        parsed: {
          titleRaw: draft.titleRaw, germanTitleSuggestion: draft.germanTitleSuggestion,
          categorySuggestion: draft.categorySuggestion, productTypeSuggestion: draft.productTypeSuggestion,
          priceAmount: draft.priceAmount, currency: draft.currency,
          colorRaw: draft.colorRaw, colorGermanSuggestion: draft.colorGermanSuggestion,
          sizesRaw: draft.sizesRaw,
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
    setBusy(true);
    try {
      const updated = await sellProduct(record.id, num(draft.saleQuantity, 1), draft.saleNote);
      onReplace(updated);
      showToast(t.toastSold, "success");
      patch("saleQuantity", String(Math.max(1, updated.stockQuantity)));
      patch("saleNote", "");
    } catch { showToast(t.errors.ERR_GENERAL, "error"); }
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
      setImagePreviews((curr) => { curr.forEach((p2) => URL.revokeObjectURL(p2.url)); return []; });
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
        const newLen = updated.images.length;
        if (newLen === 0) setLightboxIdx(null);
        else setLightboxIdx((i) => Math.min(i ?? 0, newLen - 1));
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

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60 p-0 sm:p-4" role="dialog" aria-modal="true">
        <div
          className={cn("ms-auto flex h-full w-full max-w-3xl flex-col overflow-hidden border shadow-2xl sm:rounded-2xl", s.panel)}
          dir={locale === "ar" ? "rtl" : "ltr"}
        >
          {/* Header */}
          <div className={cn("flex items-center gap-3 border-b px-4 py-3 sm:px-5", s.panelBorder)}>
            <div className="min-w-0 flex-1">
              <h2 className={cn("text-base font-black tracking-tight", s.title)}>
                {p.germanTitleSuggestion || p.titleRaw || record.folderName}
              </h2>
              {p.titleRaw && p.germanTitleSuggestion && (
                <p className={cn("truncate text-xs font-semibold", s.muted)} dir="auto">{p.titleRaw}</p>
              )}
            </div>

            {/* Mod butonları */}
            <div className={cn("hidden sm:inline-flex items-center gap-0.5 rounded-lg border p-0.5", s.controlGroup)}>
              <button type="button" onClick={() => setMode("view")}
                className={cn("rounded-md px-3 py-1.5 text-xs font-extrabold transition", mode === "view" ? s.controlActive : s.controlIdle)}>
                {t.viewDetails}
              </button>
              <button type="button" onClick={() => setMode("edit")}
                className={cn("rounded-md px-3 py-1.5 text-xs font-extrabold transition", mode === "edit" ? s.controlActive : s.controlIdle)}>
                {t.editBtn}
              </button>
            </div>

            <button type="button" onClick={onClose}
              className={cn("inline-flex size-9 items-center justify-center rounded-lg border transition shrink-0", s.controlGroup, s.controlIdle)}>
              <X className="size-4" />
            </button>
          </div>

          {/* Mobil mod toggle */}
          <div className={cn("flex sm:hidden border-b", s.panelBorder)}>
            {(["view", "edit"] as Mode[]).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)}
                className={cn("flex-1 py-2.5 text-xs font-extrabold transition border-b-2",
                  mode === m ? "border-violet-400 text-violet-400" : cn("border-transparent", s.muted))}>
                {m === "view" ? t.viewDetails : t.editBtn}
              </button>
            ))}
          </div>

          {/* Body */}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
            {mode === "view" ? (
              <ViewBody
                record={record} s={s} t={t} locale={locale} dateLocale={dateLocale}
                busy={busy} draft={draft}
                onStatusChange={handleStatusChange}
                onSell={handleSell}
                onRestore={handleRestore}
                onResetSales={handleResetSales}
                onImageClick={(i) => setLightboxIdx(i)}
                patch={patch}
              />
            ) : (
              <EditBody
                record={record} s={s} t={t}
                busy={busy} imageBusy={imageBusy} draft={draft}
                deletingImage={deletingImage} imagePreviews={imagePreviews}
                imageFiles={imageFiles} deleteConfirm={deleteConfirm}
                onSave={handleSave}
                onDeleteImage={handleDeleteImage}
                onUploadImages={handleUploadImages}
                onImageClick={(i) => setLightboxIdx(i)}
                onDelete={handleDelete}
                onDeleteConfirmChange={setDeleteConfirm}
                onImageFilesChange={(files) => {
                  setImageFiles(files);
                  setImagePreviews((curr) => {
                    curr.forEach((p2) => URL.revokeObjectURL(p2.url));
                    return files.map((f) => ({ name: f.name, url: URL.createObjectURL(f) }));
                  });
                }}
                patch={patch}
              />
            )}
          </div>
        </div>
      </div>

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

// ── Görüntüleme modu ──────────────────────────────────────────────────────────

function ViewBody({ record, s, t, locale, dateLocale, busy, draft, onStatusChange, onSell, onRestore, onResetSales, onImageClick, patch }: {
  record: ProductRecord; s: ReturnType<typeof Object.assign>; t: ReturnType<typeof Object.assign>;
  locale: string; dateLocale: string; busy: boolean; draft: { saleQuantity: string; saleNote: string; restoreStock: string };
  onStatusChange: (s: ProductStatus) => void; onSell: () => void; onRestore: () => void;
  onResetSales: () => void; onImageClick: (i: number) => void;
  patch: (k: "saleQuantity" | "saleNote" | "restoreStock", v: string) => void;
}) {
  const p = record.parsed;
  const isArchive = record.status === "sold_archive";

  return (
    <div className="grid gap-5">
      {/* Görseller */}
      {record.images.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {record.images.map((img, i) => (
            <button key={img.fileName} type="button" onClick={() => onImageClick(i)}
              className="relative overflow-hidden rounded-xl ring-1 ring-white/10 active:scale-95 transition-transform">
              <img src={productImageUrl(record.id, img.fileName)}
                alt={img.originalName} className="aspect-square w-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}

      {/* Ürün özellikleri */}
      <div className={cn("rounded-xl border p-4 grid gap-3", s.subPanel)}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={cn("text-xs", s.muted)}>
              {new Date(record.createdAt).toLocaleDateString(dateLocale)} · {(t as Record<string,unknown>).imageCount instanceof Function ? (t as Record<string,CallableFunction>).imageCount(record.images.length) : `${record.images.length}`}
            </p>
          </div>
          {p.priceAmount && (
            <span className={cn("rounded-lg border px-2.5 py-1 text-sm font-black shrink-0", s.success)}>
              {p.priceAmount} {p.currency}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {p.categorySuggestion && (
            <span className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-bold bg-violet-400/10 text-violet-300 ring-1 ring-violet-400/25">
              <Tag className="size-3" /> {p.categorySuggestion}
            </span>
          )}
          {p.colorRaw && (
            <span className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-bold bg-fuchsia-400/10 text-fuchsia-300 ring-1 ring-fuchsia-400/25">
              <Palette className="size-3" /> {p.colorRaw}
            </span>
          )}
          {p.sizesRaw && (
            <span className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-bold bg-sky-400/10 text-sky-300 ring-1 ring-sky-400/25">
              <Ruler className="size-3" /> {p.sizesRaw}
            </span>
          )}
          <span className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-bold bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/25">
            <Box className="size-3" /> {(t as Record<string,CallableFunction>).activeStock(record.stockQuantity)}
          </span>
          {record.soldQuantity > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-bold bg-amber-400/10 text-amber-300 ring-1 ring-amber-400/25">
              <ShoppingBag className="size-3" /> {record.soldQuantity}
            </span>
          )}
        </div>
        {record.notes && (
          <p className={cn("text-sm leading-6", s.muted)} dir="auto">{record.notes}</p>
        )}
      </div>

      {/* Durum değiştirme */}
      {!isArchive && (
        <section className={cn("rounded-xl border p-4", s.subPanel)}>
          <p className={cn("mb-2 text-xs font-black uppercase tracking-wide", s.muted)}>{(t as Record<string,string>).changeStatus}</p>
          <div className="flex flex-wrap gap-2">
            {ACTIVE_STATUSES.map((st) => (
              <button key={st} type="button" disabled={busy} onClick={() => onStatusChange(st)}
                className={cn("rounded-lg border px-3 py-1.5 text-xs font-extrabold transition-all active:scale-95 disabled:opacity-50",
                  record.status === st ? statusActiveBadge(st, s as Parameters<typeof statusActiveBadge>[1]) : cn(statusBadge(st, s as Parameters<typeof statusBadge>[1]), "opacity-60 hover:opacity-100"))}>
                {statusLabel(st, locale as "tr" | "ar")}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Satış / Geri al */}
      {!isArchive ? (
        <section className={cn("rounded-xl border p-4", s.subPanel)}>
          <h3 className={cn("mb-3 flex items-center gap-2 text-sm font-extrabold", s.title)}>
            <ReceiptText className="size-4 text-violet-400" />
            {(t as Record<string,string>).saleInfoTitle}
          </h3>
          <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <ViewField label={(t as Record<string,string>).saleQuantity} s={s}>
              <input type="number" min={1} value={draft.saleQuantity} onChange={(e) => patch("saleQuantity", e.target.value)}
                className={cn("min-h-11 w-full rounded-xl border px-3 text-sm font-semibold outline-none focus:ring-4", s.input)} />
            </ViewField>
            <ViewField label={(t as Record<string,string>).saleNote} s={s}>
              <input value={draft.saleNote} onChange={(e) => patch("saleNote", e.target.value)}
                placeholder={(t as Record<string,string>).saleNotePlaceholder} dir="auto"
                className={cn("min-h-11 w-full rounded-xl border px-3 text-sm font-semibold outline-none focus:ring-4", s.input)} />
            </ViewField>
          </div>
          <button type="button" onClick={onSell} disabled={busy}
            className={cn("mt-3 inline-flex w-full min-h-11 items-center justify-center gap-2 rounded-xl border text-sm font-extrabold transition disabled:opacity-60", s.error)}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ShoppingBag className="size-4" />}
            {(t as Record<string,string>).markSold}
          </button>
          {record.soldQuantity > 0 && (
            <button type="button" onClick={onResetSales} disabled={busy}
              className={cn("mt-2 inline-flex w-full min-h-10 items-center justify-center gap-2 rounded-xl border text-xs font-extrabold transition disabled:opacity-60", s.controlGroup, s.controlIdle)}>
              <RotateCcw className="size-3.5" /> {(t as Record<string,string>).resetSales}
            </button>
          )}
        </section>
      ) : (
        <section className={cn("rounded-xl border p-4", s.subPanel)}>
          <ViewField label={(t as Record<string,string>).restoreStock} s={s}>
            <input type="number" min={1} value={draft.restoreStock} onChange={(e) => patch("restoreStock", e.target.value)}
              className={cn("min-h-11 w-full rounded-xl border px-3 text-sm font-semibold outline-none focus:ring-4", s.input)} />
          </ViewField>
          <button type="button" onClick={onRestore} disabled={busy}
            className={cn("mt-3 inline-flex w-full min-h-11 items-center justify-center gap-2 rounded-xl border text-sm font-extrabold transition disabled:opacity-60", s.success)}>
            <ArchiveRestore className="size-4" /> {(t as Record<string,string>).restoreProduct}
          </button>
        </section>
      )}

      {/* Satış geçmişi */}
      {(record.saleHistory ?? []).length > 0 && (
        <section className={cn("rounded-xl border p-4", s.subPanel)}>
          <h3 className={cn("mb-3 text-sm font-extrabold", s.title)}>{(t as Record<string,string>).saleHistory}</h3>
          <div className="grid gap-2">
            {[...record.saleHistory].reverse().map((sale, i) => (
              <div key={`${sale.soldAt}-${i}`} className={cn("rounded-lg border px-3 py-2 text-xs", s.panelBorder)}>
                <div className={cn("font-extrabold", s.title)}>
                  <span className="inline-flex items-center gap-1"><CalendarDays className="size-3" />
                    {new Date(sale.soldAt).toLocaleString(dateLocale)}
                  </span>
                  {" · "}{sale.quantity} {(t as Record<string,string>).soldQuantity?.toLowerCase()}
                </div>
                {sale.note && <div className={cn("mt-0.5", s.muted)} dir="auto">{sale.note}</div>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ViewField({ label, s, children }: { label: string; s: ReturnType<typeof Object.assign>; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className={cn("text-xs font-black", s.strong)}>{label}</span>
      {children}
    </label>
  );
}

// ── Düzenleme modu ────────────────────────────────────────────────────────────

function EditBody({ record, s, t, busy, imageBusy, draft, deletingImage, imagePreviews, imageFiles, deleteConfirm,
  onSave, onDeleteImage, onUploadImages, onImageClick, onDelete, onDeleteConfirmChange, onImageFilesChange, patch }: {
  record: ProductRecord; s: ReturnType<typeof Object.assign>; t: Record<string, unknown>;
  busy: boolean; imageBusy: boolean; draft: Draft; deletingImage: string | null;
  imagePreviews: { name: string; url: string }[]; imageFiles: File[]; deleteConfirm: boolean;
  onSave: () => void; onDeleteImage: (f: string) => void; onUploadImages: () => void;
  onImageClick: (i: number) => void; onDelete: () => void;
  onDeleteConfirmChange: (v: boolean) => void;
  onImageFilesChange: (files: File[]) => void;
  patch: (k: keyof Draft, v: string) => void;
}) {
  return (
    <div className="grid gap-5">
      {/* Kaydet */}
      <button type="button" onClick={onSave} disabled={busy}
        className={cn("inline-flex w-full min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-extrabold transition disabled:opacity-60", s.primary)}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
        {t.saveChanges as string}
      </button>

      {/* Form alanları */}
      <section className={cn("rounded-xl border p-4", s.subPanel)}>
        <h3 className={cn("mb-3 flex items-center gap-2 text-sm font-extrabold", s.title)}>
          <Edit3 className="size-4 text-violet-400" /> {t.editProduct as string}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <DetailField label={t.germanTitle as string} s={s} value={draft.germanTitleSuggestion} onChange={(v) => patch("germanTitleSuggestion", v)} />
          <DetailField label={t.rawTitle as string} s={s} value={draft.titleRaw} onChange={(v) => patch("titleRaw", v)} />
          <DetailField label={t.price as string} s={s} value={draft.priceAmount} onChange={(v) => patch("priceAmount", v)} />
          <DetailField label={t.currency as string} s={s} value={draft.currency} onChange={(v) => patch("currency", v)} />
          <DetailField label={t.color as string} s={s} value={draft.colorRaw} onChange={(v) => patch("colorRaw", v)} />
          <DetailField label={t.size as string} s={s} value={draft.sizesRaw} onChange={(v) => patch("sizesRaw", v)} />
          <DetailField label={t.category as string} s={s} value={draft.categorySuggestion} onChange={(v) => patch("categorySuggestion", v)} />
          <DetailField label={t.productType as string} s={s} value={draft.productTypeSuggestion} onChange={(v) => patch("productTypeSuggestion", v)} />
          <DetailField label={t.stockQuantity as string} s={s} value={draft.stockQuantity} type="number" onChange={(v) => patch("stockQuantity", v)} />
        </div>
        <label className="mt-3 grid gap-1.5">
          <span className={cn("text-xs font-black", s.strong)}>{t.description as string}</span>
          <textarea className={cn("min-h-24 rounded-xl border px-3 py-3 text-sm leading-6 outline-none focus:ring-4", s.input)}
            value={draft.description} onChange={(e) => patch("description", e.target.value)} dir="auto" />
        </label>
        <label className="mt-3 grid gap-1.5">
          <span className={cn("text-xs font-black", s.strong)}>{t.notes as string}</span>
          <textarea className={cn("min-h-20 rounded-xl border px-3 py-3 text-sm leading-6 outline-none focus:ring-4", s.input)}
            value={draft.notes} onChange={(e) => patch("notes", e.target.value)}
            placeholder={t.notesPlaceholder as string} dir="auto" />
        </label>
      </section>

      {/* Görseller */}
      <section className={cn("rounded-xl border p-4", s.subPanel)}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className={cn("flex items-center gap-2 text-sm font-extrabold", s.title)}>
            <Images className="size-4 text-violet-400" /> {t.images as string}
          </h3>
          {imageFiles.length > 0 && (
            <button type="button" onClick={onUploadImages} disabled={imageBusy}
              className={cn("inline-flex min-h-9 items-center gap-2 rounded-xl px-3 text-xs font-extrabold transition disabled:opacity-60", s.primary)}>
              {imageBusy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {t.uploadSelectedImages as string}
            </button>
          )}
        </div>

        {/* Mevcut görseller — tıkla önizle, çöp ikon her zaman görünür */}
        <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {record.images.map((img, i) => (
            <div key={img.fileName} className="relative overflow-hidden rounded-xl">
              <button type="button" onClick={() => onImageClick(i)} className="block w-full">
                <img src={productImageUrl(record.id, img.fileName)} alt={img.originalName}
                  className="aspect-square w-full object-cover" loading="lazy" />
              </button>
              <button type="button" disabled={deletingImage === img.fileName}
                onClick={() => onDeleteImage(img.fileName)}
                className={cn("absolute bottom-1 end-1 flex size-7 items-center justify-center rounded-full",
                  "bg-black/60 text-red-400 hover:bg-red-500/80 hover:text-white transition",
                  deletingImage === img.fileName && "opacity-50")}>
                {deletingImage === img.fileName
                  ? <Loader2 className="size-3.5 animate-spin" />
                  : <Trash2 className="size-3.5" />}
              </button>
            </div>
          ))}
        </div>

        {/* Yeni görsel ekle */}
        <label className={cn("mb-3 grid cursor-pointer place-items-center rounded-xl border border-dashed px-4 py-4 text-center transition", s.dropzone)}>
          <input className="sr-only" type="file" accept="image/*" multiple
            onChange={(e) => onImageFilesChange(Array.from(e.currentTarget.files ?? []))} />
          <span className={cn("mb-2 flex size-10 items-center justify-center rounded-xl ring-1", s.dropIcon)}>
            <ImagePlus className="size-4" />
          </span>
          <span className={cn("text-sm font-extrabold", s.title)}>{t.addImages as string}</span>
          <span className={cn("mt-0.5 text-xs", s.muted)}>{t.addImagesHelp as string}</span>
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
          <FolderOpen className="size-4 text-violet-400" /> {t.folders as string}
        </h3>
        {[[t.originalFolder, record.imageFolders.originals.relativePath],
          [t.aiFolderLabel, record.imageFolders.enhanced.relativePath]].map(([label, val]) => (
          <div key={label as string} className={cn("flex min-w-0 items-start gap-2 border-t py-2 first:border-t-0 first:pt-0 text-xs", s.folderLine)}>
            <FolderOpen className={cn("mt-0.5 size-4 shrink-0", s.folderIcon)} />
            <span className={cn("shrink-0 font-black", s.strong)}>{label as string}:</span>
            <span className={cn("min-w-0 break-all", s.muted)} dir="ltr">{val as string}</span>
          </div>
        ))}
      </section>

      {/* Sil */}
      <section className={cn("rounded-xl border p-4", s.subPanel)}>
        {!deleteConfirm ? (
          <button type="button" onClick={() => onDeleteConfirmChange(true)}
            className={cn("inline-flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-extrabold transition", s.error)}>
            <Trash2 className="size-4" /> {t.deleteProduct as string}
          </button>
        ) : (
          <div className="grid gap-3">
            <p className={cn("text-sm font-bold", s.title)}>{t.deleteConfirmTitle as string}</p>
            <p className={cn("text-xs leading-5", s.muted)}>{t.deleteConfirmText as string}</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => onDeleteConfirmChange(false)}
                className={cn("flex-1 rounded-xl border px-4 py-2.5 text-sm font-extrabold transition", s.controlGroup, s.controlIdle)}>
                {t.deleteCancel as string}
              </button>
              <button type="button" onClick={onDelete} disabled={busy}
                className={cn("flex-1 inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-extrabold transition disabled:opacity-60", s.error)}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                {t.deleteConfirm as string}
              </button>
            </div>
          </div>
        )}
      </section>
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
