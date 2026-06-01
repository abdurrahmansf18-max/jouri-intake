import { useEffect, useState } from "react";
import {
  ArchiveRestore,
  Edit3,
  FolderOpen,
  ImagePlus,
  Images,
  Loader2,
  Plus,
  ReceiptText,
  RotateCcw,
  Save,
  ShoppingBag,
  Trash2,
  X,
} from "lucide-react";
import {
  addProductImages,
  deleteProduct,
  deleteProductImage,
  productImageUrl,
  resetSales,
  restoreProduct,
  sellProduct,
  updateProduct,
  updateStatus,
} from "../api";
import { useApp } from "../context";
import { COPY, cn, statusLabel } from "../i18n";
import { DARK, LIGHT, type ThemeStyles } from "../theme";
import type { ProductRecord, ProductStatus } from "../types";
import { statusActiveBadge, statusBadge } from "./ProductCard";

const ACTIVE_STATUSES: ProductStatus[] = ["pending", "ai_enhanced", "published"];

type Draft = {
  titleRaw: string;
  germanTitleSuggestion: string;
  categorySuggestion: string;
  productTypeSuggestion: string;
  priceAmount: string;
  currency: string;
  colorRaw: string;
  colorGermanSuggestion: string;
  sizesRaw: string;
  notes: string;
  description: string;
  stockQuantity: string;
  restoreStock: string;
  saleQuantity: string;
  saleNote: string;
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
  onClose: () => void;
  onReplace: (updated: ProductRecord) => void;
  onDelete: (id: string) => void;
}

export default function ProductDetail({ record, onClose, onReplace, onDelete }: Props) {
  const { locale, theme, showToast } = useApp();
  const t = COPY[locale];
  const s = theme === "dark" ? DARK : LIGHT;
  const dateLocale = locale === "ar" ? "ar" : "tr-TR";

  const [draft, setDraft] = useState<Draft>(() => recordToDraft(record));
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [deletingImage, setDeletingImage] = useState<string | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<{ name: string; url: string }[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  useEffect(() => {
    setDraft(recordToDraft(record));
    setDeleteConfirm(false);
    setImageFiles([]);
    setImagePreviews((curr) => { curr.forEach((p) => URL.revokeObjectURL(p.url)); return []; });
  }, [record.id]);

  useEffect(() => () => {
    imagePreviews.forEach((p) => URL.revokeObjectURL(p.url));
  }, [imagePreviews]);

  function patch(key: keyof Draft, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function num(val: string, fallback: number) {
    const n = parseInt(val, 10);
    return Number.isFinite(n) ? n : fallback;
  }

  async function handleSave() {
    setBusy(true);
    try {
      const updated = await updateProduct(record.id, {
        notes: draft.notes,
        description: draft.description,
        stockQuantity: num(draft.stockQuantity, 1),
        parsed: {
          titleRaw: draft.titleRaw,
          germanTitleSuggestion: draft.germanTitleSuggestion,
          categorySuggestion: draft.categorySuggestion,
          productTypeSuggestion: draft.productTypeSuggestion,
          priceAmount: draft.priceAmount,
          currency: draft.currency,
          colorRaw: draft.colorRaw,
          colorGermanSuggestion: draft.colorGermanSuggestion,
          sizesRaw: draft.sizesRaw,
        },
      });
      onReplace(updated);
      showToast(t.toastUpdated, "success");
    } catch (err: unknown) {
      const code = err instanceof Error ? err.message : "ERR_GENERAL";
      showToast(t.errors[code] ?? t.errors.ERR_GENERAL, "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleStatusChange(status: ProductStatus) {
    if (busy || record.status === status) return;
    setBusy(true);
    try {
      const updated = await updateStatus(record.id, status);
      onReplace(updated);
      showToast(t.toastStatusUpdated, "success");
    } catch {
      showToast(t.errors.ERR_GENERAL, "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleSell() {
    setBusy(true);
    try {
      const updated = await sellProduct(record.id, num(draft.saleQuantity, 1), draft.saleNote);
      onReplace(updated);
      showToast(t.toastSold, "success");
    } catch {
      showToast(t.errors.ERR_GENERAL, "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleRestore() {
    setBusy(true);
    try {
      const updated = await restoreProduct(record.id, num(draft.restoreStock, 1));
      onReplace(updated);
      showToast(t.toastRestored, "success");
    } finally {
      setBusy(false);
    }
  }

  async function handleResetSales() {
    if (!window.confirm(t.resetSalesConfirm)) return;
    setBusy(true);
    try {
      const updated = await resetSales(record.id);
      onReplace(updated);
      showToast(t.toastSalesReset, "success");
    } finally {
      setBusy(false);
    }
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
    } catch {
      showToast(t.errors.ERR_GENERAL, "error");
    } finally {
      setImageBusy(false);
    }
  }

  async function handleDeleteImage(fileName: string) {
    if (!window.confirm(t.deleteImage + "?")) return;
    setDeletingImage(fileName);
    try {
      const updated = await deleteProductImage(record.id, "originals", fileName);
      onReplace(updated);
    } catch {
      showToast(t.errors.ERR_GENERAL, "error");
    } finally {
      setDeletingImage(null);
    }
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
    <div className="fixed inset-0 z-50 bg-black/60 p-0 sm:p-4" role="dialog" aria-modal="true">
      <div
        className={cn(
          "ms-auto flex h-full w-full max-w-3xl flex-col overflow-hidden border shadow-2xl sm:rounded-2xl",
          s.panel,
        )}
        dir={locale === "ar" ? "rtl" : "ltr"}
      >
        {/* Header */}
        <div className={cn("flex items-center justify-between gap-3 border-b px-4 py-4 sm:px-5", s.panelBorder)}>
          <div className="min-w-0">
            <h2 className={cn("text-lg font-black tracking-tight", s.title)}>{t.productDetail}</h2>
            <p className={cn("mt-0.5 truncate text-xs font-semibold", s.muted)} dir="ltr">{record.folderName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={cn("inline-flex size-9 items-center justify-center rounded-lg border transition", s.controlGroup, s.controlIdle)}
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <div className="grid gap-5">

            {/* Ürün başlığı + fiyat */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className={cn("text-base font-extrabold", s.title)}>
                  {p.germanTitleSuggestion || p.titleRaw || record.folderName}
                </h3>
                {p.titleRaw && p.germanTitleSuggestion && (
                  <p className={cn("mt-0.5 text-sm font-semibold", s.muted)} dir="auto">{p.titleRaw}</p>
                )}
                <p className={cn("mt-1 text-xs", s.muted)}>
                  {new Date(record.createdAt).toLocaleString(dateLocale)} · {t.imageCount(record.images.length)}
                </p>
              </div>
              {p.priceAmount && (
                <span className={cn("rounded-lg border px-2.5 py-1 text-sm font-black shrink-0", s.success)}>
                  {p.priceAmount} {p.currency}
                </span>
              )}
            </div>

            {/* Durum değiştirme */}
            {record.status !== "sold_archive" && (
              <section className={cn("rounded-xl border p-4", s.subPanel)}>
                <h3 className={cn("mb-3 text-xs font-black uppercase tracking-wide", s.muted)}>
                  {t.changeStatus}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {ACTIVE_STATUSES.map((status) => (
                    <button
                      key={status}
                      type="button"
                      disabled={busy}
                      onClick={() => handleStatusChange(status)}
                      className={cn(
                        "rounded-lg border px-3 py-1.5 text-xs font-extrabold",
                        "transition-all active:scale-95 disabled:opacity-50",
                        record.status === status
                          ? statusActiveBadge(status, s)
                          : cn(statusBadge(status, s), "opacity-60 hover:opacity-100"),
                      )}
                    >
                      {statusLabel(status, locale)}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Satış bölümü */}
            {record.status !== "sold_archive" ? (
              <section className={cn("rounded-xl border p-4", s.subPanel)}>
                <h3 className={cn("mb-3 flex items-center gap-2 text-sm font-extrabold", s.title)}>
                  <ReceiptText className="size-4 text-violet-400" />
                  {t.saleInfoTitle}
                </h3>
                <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
                  <DetailField label={t.saleQuantity} s={s} value={draft.saleQuantity} type="number" onChange={(v) => patch("saleQuantity", v)} />
                  <label className="grid gap-1.5">
                    <span className={cn("text-xs font-black", s.strong)}>{t.saleNote}</span>
                    <input
                      className={cn("min-h-11 rounded-xl border px-3 text-sm font-semibold outline-none focus:ring-4", s.input)}
                      value={draft.saleNote}
                      onChange={(e) => patch("saleNote", e.target.value)}
                      placeholder={t.saleNotePlaceholder}
                      dir="auto"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={handleSell}
                  disabled={busy}
                  className={cn("mt-3 inline-flex w-full min-h-11 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-extrabold transition disabled:opacity-60", s.error)}
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <ShoppingBag className="size-4" />}
                  {t.markSold}
                </button>
                {record.soldQuantity > 0 && (
                  <button
                    type="button"
                    onClick={handleResetSales}
                    disabled={busy}
                    className={cn("mt-2 inline-flex w-full min-h-10 items-center justify-center gap-2 rounded-xl border px-4 text-xs font-extrabold transition disabled:opacity-60", s.controlGroup, s.controlIdle)}
                  >
                    <RotateCcw className="size-3.5" />
                    {t.resetSales}
                  </button>
                )}
              </section>
            ) : (
              <section className={cn("rounded-xl border p-4", s.subPanel)}>
                <div className="grid gap-2">
                  <DetailField label={t.restoreStock} s={s} value={draft.restoreStock} type="number" onChange={(v) => patch("restoreStock", v)} />
                  <button
                    type="button"
                    onClick={handleRestore}
                    disabled={busy}
                    className={cn("inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-extrabold transition disabled:opacity-60", s.success)}
                  >
                    <ArchiveRestore className="size-4" />
                    {t.restoreProduct}
                  </button>
                </div>
              </section>
            )}

            {/* Kaydet butonu */}
            <button
              type="button"
              onClick={handleSave}
              disabled={busy}
              className={cn("inline-flex w-full min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-extrabold transition disabled:opacity-60", s.primary)}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {t.saveChanges}
            </button>

            {/* Düzenleme alanları */}
            <section className={cn("rounded-xl border p-4", s.subPanel)}>
              <h3 className={cn("mb-3 flex items-center gap-2 text-sm font-extrabold", s.title)}>
                <Edit3 className="size-4 text-violet-400" />
                {t.editProduct}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <DetailField label={t.germanTitle}    s={s} value={draft.germanTitleSuggestion} onChange={(v) => patch("germanTitleSuggestion", v)} />
                <DetailField label={t.rawTitle}       s={s} value={draft.titleRaw}              onChange={(v) => patch("titleRaw", v)} />
                <DetailField label={t.price}          s={s} value={draft.priceAmount}           onChange={(v) => patch("priceAmount", v)} />
                <DetailField label={t.currency}       s={s} value={draft.currency}              onChange={(v) => patch("currency", v)} />
                <DetailField label={t.color}          s={s} value={draft.colorRaw}              onChange={(v) => patch("colorRaw", v)} />
                <DetailField label={t.size}           s={s} value={draft.sizesRaw}              onChange={(v) => patch("sizesRaw", v)} />
                <DetailField label={t.category}       s={s} value={draft.categorySuggestion}    onChange={(v) => patch("categorySuggestion", v)} />
                <DetailField label={t.productType}    s={s} value={draft.productTypeSuggestion} onChange={(v) => patch("productTypeSuggestion", v)} />
                <DetailField label={t.stockQuantity}  s={s} value={draft.stockQuantity} type="number" onChange={(v) => patch("stockQuantity", v)} />
              </div>
              <label className="mt-3 grid gap-1.5">
                <span className={cn("text-xs font-black", s.strong)}>{t.description}</span>
                <textarea
                  className={cn("min-h-24 rounded-xl border px-3 py-3 text-sm leading-6 outline-none focus:ring-4", s.input)}
                  value={draft.description}
                  onChange={(e) => patch("description", e.target.value)}
                  dir="auto"
                />
              </label>
              <label className="mt-3 grid gap-1.5">
                <span className={cn("text-xs font-black", s.strong)}>{t.notes}</span>
                <textarea
                  className={cn("min-h-20 rounded-xl border px-3 py-3 text-sm leading-6 outline-none focus:ring-4", s.input)}
                  value={draft.notes}
                  onChange={(e) => patch("notes", e.target.value)}
                  placeholder={t.notesPlaceholder}
                  dir="auto"
                />
              </label>
            </section>

            {/* Görseller */}
            <section className={cn("rounded-xl border p-4", s.subPanel)}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className={cn("flex items-center gap-2 text-sm font-extrabold", s.title)}>
                  <Images className="size-4 text-violet-400" />
                  {t.images}
                </h3>
                {imageFiles.length > 0 && (
                  <button
                    type="button"
                    onClick={handleUploadImages}
                    disabled={imageBusy}
                    className={cn("inline-flex min-h-9 items-center gap-2 rounded-xl px-3 text-xs font-extrabold transition disabled:opacity-60", s.primary)}
                  >
                    {imageBusy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                    {t.uploadSelectedImages}
                  </button>
                )}
              </div>

              {/* Mevcut görseller — silme butonu ile */}
              <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {record.images.map((img) => (
                  <figure key={img.fileName} className={cn("group/img relative overflow-hidden rounded-xl border", s.panelBorder)}>
                    <img
                      src={productImageUrl(record.id, img.fileName)}
                      alt={img.originalName}
                      className="aspect-square w-full object-cover"
                      loading="lazy"
                    />
                    <button
                      type="button"
                      disabled={deletingImage === img.fileName}
                      onClick={() => handleDeleteImage(img.fileName)}
                      className={cn(
                        "absolute inset-0 flex items-center justify-center",
                        "bg-black/0 opacity-0 transition-all",
                        "group-hover/img:bg-black/50 group-hover/img:opacity-100",
                      )}
                    >
                      {deletingImage === img.fileName
                        ? <Loader2 className="size-5 animate-spin text-white" />
                        : <Trash2 className="size-5 text-red-400" />}
                    </button>
                  </figure>
                ))}
              </div>

              {/* Yeni görsel ekleme */}
              <label className={cn("mb-3 grid cursor-pointer place-items-center rounded-xl border border-dashed px-4 py-4 text-center transition", s.dropzone)}>
                <input
                  className="sr-only"
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => {
                    const selected = Array.from(e.currentTarget.files ?? []);
                    setImageFiles(selected);
                    setImagePreviews((curr) => {
                      curr.forEach((p2) => URL.revokeObjectURL(p2.url));
                      return selected.map((f) => ({ name: f.name, url: URL.createObjectURL(f) }));
                    });
                  }}
                />
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

            {/* Satış geçmişi */}
            {(record.saleHistory ?? []).length > 0 && (
              <section className={cn("rounded-xl border p-4", s.subPanel)}>
                <h3 className={cn("mb-3 text-sm font-extrabold", s.title)}>{t.saleHistory}</h3>
                <div className="grid gap-2">
                  {[...record.saleHistory].reverse().map((sale, i) => (
                    <div key={`${sale.soldAt}-${i}`} className={cn("rounded-lg border px-3 py-2 text-xs", s.panelBorder)}>
                      <div className={cn("font-extrabold", s.title)}>
                        {new Date(sale.soldAt).toLocaleString(dateLocale)} · {sale.quantity} {t.soldQuantity.toLowerCase()}
                      </div>
                      {sale.note && <div className={cn("mt-0.5", s.muted)} dir="auto">{sale.note}</div>}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Klasör bilgisi */}
            <section className={cn("rounded-xl border p-4", s.subPanel)}>
              <h3 className={cn("mb-3 flex items-center gap-2 text-sm font-extrabold", s.title)}>
                <FolderOpen className="size-4 text-violet-400" />
                {t.folders}
              </h3>
              {[
                [t.originalFolder, record.imageFolders.originals.relativePath],
                [t.aiFolderLabel,  record.imageFolders.enhanced.relativePath],
              ].map(([label, val]) => (
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
                <button
                  type="button"
                  onClick={() => setDeleteConfirm(true)}
                  className={cn("inline-flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-extrabold transition", s.error)}
                >
                  <Trash2 className="size-4" />
                  {t.deleteProduct}
                </button>
              ) : (
                <div className="grid gap-3">
                  <p className={cn("text-sm font-bold", s.title)}>{t.deleteConfirmTitle}</p>
                  <p className={cn("text-xs leading-5", s.muted)}>{t.deleteConfirmText}</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setDeleteConfirm(false)}
                      className={cn("flex-1 rounded-xl border px-4 py-2.5 text-sm font-extrabold transition", s.controlGroup, s.controlIdle)}
                    >
                      {t.deleteCancel}
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={busy}
                      className={cn("flex-1 inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-extrabold transition disabled:opacity-60", s.error)}
                    >
                      {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                      {t.deleteConfirm}
                    </button>
                  </div>
                </div>
              )}
            </section>

          </div>
        </div>
      </div>
    </div>
  );
}

function DetailField({
  label, onChange, s, type = "text", value,
}: {
  label: string; onChange: (v: string) => void;
  s: ThemeStyles; type?: "number" | "text"; value: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className={cn("text-xs font-black", s.strong)}>{label}</span>
      <input
        className={cn("min-h-11 rounded-xl border px-3 text-sm font-semibold outline-none focus:ring-4", s.input)}
        type={type}
        min={type === "number" ? 0 : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        dir="auto"
      />
    </label>
  );
}
