import { useState } from "react";
import { ArchiveRestore, Box, CalendarDays, ImageOff, Palette, Ruler, ShoppingBag, Tag } from "lucide-react";
import { productImageUrl, updateStatus } from "../api";
import { useApp } from "../context";
import { COPY, cn, statusLabel } from "../i18n";
import { DARK, LIGHT, type ThemeStyles } from "../theme";
import type { ProductRecord, ProductStatus } from "../types";

const ACTIVE_STATUSES: ProductStatus[] = ["pending", "ai_enhanced", "published"];

interface Props {
  record: ProductRecord;
  onOpen: () => void;
  onReplace: (updated: ProductRecord) => void;
  showRestoreBtn?: boolean;
}

export default function ProductCard({ record, onOpen, onReplace, showRestoreBtn }: Props) {
  const { locale, theme, showToast } = useApp();
  const t = COPY[locale];
  const s = theme === "dark" ? DARK : LIGHT;
  const [busy, setBusy] = useState(false);
  const dateLocale = locale === "ar" ? "ar" : "tr-TR";

  async function handleStatusChange(status: ProductStatus, e: React.MouseEvent) {
    e.stopPropagation();
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

  const p = record.parsed;

  return (
    <article
      className={cn(
        "cursor-pointer rounded-xl border overflow-hidden transition hover:-translate-y-0.5 select-none",
        s.subPanel,
      )}
      onClick={onOpen}
    >
      {/* ── Görsel şeridi ── */}
      {record.images.length > 0 ? (
        <div
          className="flex gap-1.5 overflow-x-auto p-2"
          style={{ scrollbarWidth: "none", background: "rgba(0,0,0,0.25)" }}
        >
          {record.images.map((img) => (
            <img
              key={img.fileName}
              src={productImageUrl(record.id, img.fileName, "originals")}
              alt={img.originalName}
              className="h-28 w-28 shrink-0 rounded-lg object-cover ring-1 ring-white/10"
              loading="lazy"
              draggable={false}
            />
          ))}
        </div>
      ) : (
        <div className="flex h-20 items-center justify-center" style={{ background: "rgba(0,0,0,0.15)" }}>
          <ImageOff className="size-7 opacity-30" />
        </div>
      )}

      {/* ── İçerik ── */}
      <div className="p-4">

        {/* Başlık + fiyat + durum */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {p.germanTitleSuggestion && (
              <h3 className={cn("line-clamp-1 text-sm font-extrabold leading-5", s.title)}>
                {p.germanTitleSuggestion}
              </h3>
            )}
            {p.titleRaw && (
              <p
                className={cn(
                  "line-clamp-1 text-xs font-semibold leading-5",
                  p.germanTitleSuggestion ? s.muted : cn(s.title, "font-extrabold text-sm"),
                )}
                dir="auto"
              >
                {p.titleRaw}
              </p>
            )}
            {!p.germanTitleSuggestion && !p.titleRaw && (
              <h3 className={cn("line-clamp-1 text-sm font-extrabold", s.muted)}>{record.folderName}</h3>
            )}
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1.5">
            {p.priceAmount && (
              <span className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-sm font-black text-emerald-300">
                {p.priceAmount} {p.currency}
              </span>
            )}
            <span className={cn("rounded-lg border px-2 py-0.5 text-[10px] font-black", statusBadge(record.status, s))}>
              {statusLabel(record.status, locale)}
            </span>
          </div>
        </div>

        {/* Meta: tarih · stok · satış */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-400">
            <CalendarDays className="size-3" />
            {new Date(record.createdAt).toLocaleDateString(dateLocale)}
          </span>
          <span className={cn("text-[11px]", s.muted)}>·</span>
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-400/10 px-2 py-0.5 text-[11px] font-bold text-emerald-300 ring-1 ring-emerald-400/25">
            <Box className="size-3" />
            {t.activeStock(record.stockQuantity)}
          </span>
          {record.soldQuantity > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-400/10 px-2 py-0.5 text-[11px] font-bold text-amber-300 ring-1 ring-amber-400/25">
              <ShoppingBag className="size-3" />
              {record.soldQuantity}
            </span>
          )}
        </div>

        {/* Etiketler: kategori · renk · beden */}
        {(p.categorySuggestion || p.colorRaw || p.sizesRaw) && (
          <div className="mt-2 flex flex-wrap gap-1">
            {p.categorySuggestion && (
              <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold bg-violet-400/10 text-violet-300 ring-1 ring-violet-400/25">
                <Tag className="size-3" /> {p.categorySuggestion}
              </span>
            )}
            {p.colorRaw && (
              <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold bg-fuchsia-400/10 text-fuchsia-300 ring-1 ring-fuchsia-400/25">
                <Palette className="size-3" /> {p.colorRaw}
              </span>
            )}
            {p.sizesRaw && (
              <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold bg-sky-400/10 text-sky-300 ring-1 ring-sky-400/25">
                <Ruler className="size-3" /> {p.sizesRaw}
              </span>
            )}
          </div>
        )}

        {/* Aksiyon butonları */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {!showRestoreBtn && ACTIVE_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              disabled={busy || record.status === "sold_archive"}
              onClick={(e) => handleStatusChange(status, e)}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-[11px] font-extrabold transition disabled:opacity-50",
                record.status === status
                  ? statusActiveBadge(status, s)
                  : cn(statusBadge(status, s), "cursor-pointer opacity-50 hover:opacity-100"),
              )}
            >
              {statusLabel(status, locale)}
            </button>
          ))}
          {showRestoreBtn && (
            <button
              type="button"
              disabled={busy}
              onClick={(e) => { e.stopPropagation(); onOpen(); }}
              className={cn("inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-extrabold transition", s.success)}
            >
              <ArchiveRestore className="size-3" />
              {t.restoreProduct}
            </button>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpen(); }}
            className={cn("rounded-lg border px-2.5 py-1 text-[11px] font-extrabold transition", s.controlGroup, s.controlIdle)}
          >
            {t.openDetail}
          </button>
        </div>
      </div>
    </article>
  );
}

export function statusBadge(status: ProductStatus, s: ThemeStyles) {
  if (status === "pending")      return s.statusPending;
  if (status === "ai_enhanced")  return s.statusAiEnhanced;
  if (status === "published")    return s.statusPublished;
  return s.statusSoldArchive;
}

export function statusActiveBadge(status: ProductStatus, s: ThemeStyles) {
  if (status === "pending")      return s.statusPendingActive;
  if (status === "ai_enhanced")  return s.statusAiEnhancedActive;
  if (status === "published")    return s.statusPublishedActive;
  return s.statusSoldArchiveActive;
}
