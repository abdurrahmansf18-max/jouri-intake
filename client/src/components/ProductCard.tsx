import { useState } from "react";
import { ArchiveRestore, Box, CalendarDays, Images, Palette, Ruler, ShoppingBag, Tag } from "lucide-react";
import { updateStatus } from "../api";
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
      className={cn("cursor-pointer rounded-xl border p-4 transition hover:-translate-y-0.5 select-none", s.subPanel)}
      onClick={onOpen}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Almanca ad — ana başlık */}
          {p.germanTitleSuggestion && (
            <h3 className={cn("line-clamp-1 text-sm font-extrabold leading-5", s.title)}>
              {p.germanTitleSuggestion}
            </h3>
          )}
          {/* Orijinal ad — ikincil */}
          {p.titleRaw && (
            <p className={cn(
              "line-clamp-1 text-xs font-semibold leading-5",
              p.germanTitleSuggestion ? s.muted : cn(s.title, "font-extrabold text-sm"),
            )} dir="auto">
              {p.titleRaw}
            </p>
          )}
          {/* Hiçbiri yoksa klasör adı */}
          {!p.germanTitleSuggestion && !p.titleRaw && (
            <h3 className={cn("line-clamp-1 text-sm font-extrabold", s.muted)}>{record.folderName}</h3>
          )}
          {/* Tarih + görsel sayısı — renkli badge'ler */}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-400">
              <CalendarDays className="size-3" />
              {new Date(record.createdAt).toLocaleDateString(dateLocale)}
            </span>
            <span className={cn("text-[11px]", s.muted)}>·</span>
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-sky-400">
              <Images className="size-3" />
              {record.images.length}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            <span className={cn("inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold ring-1", s.pill)}>
              <Box className="size-3" />
              {t.activeStock(record.stockQuantity)}
            </span>
            {record.soldQuantity > 0 && (
              <span className={cn("inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold ring-1", s.pill)}>
                <ShoppingBag className="size-3" />
                {record.soldQuantity}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {p.priceAmount && (
            <span className={cn("rounded-lg border px-2 py-1 text-xs font-black", s.success)}>
              {p.priceAmount} {p.currency}
            </span>
          )}
          <span className={cn("rounded-lg border px-2 py-0.5 text-[10px] font-black", statusBadge(record.status, s))}>
            {statusLabel(record.status, locale)}
          </span>
        </div>
      </div>

      {/* Tags */}
      {(p.categorySuggestion || p.colorRaw || p.sizesRaw) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {p.categorySuggestion && (
            <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold ring-1", s.pill)}>
              <Tag className="size-3" /> {p.categorySuggestion}
            </span>
          )}
          {p.colorRaw && (
            <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold ring-1", s.pill)}>
              <Palette className="size-3" /> {p.colorRaw}
            </span>
          )}
          {p.sizesRaw && (
            <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold ring-1", s.pill)}>
              <Ruler className="size-3" /> {p.sizesRaw}
            </span>
          )}
        </div>
      )}

      {/* Actions */}
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
                ? statusBadge(status, s)
                : cn(s.controlGroup, s.controlIdle, "cursor-pointer hover:opacity-80"),
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
    </article>
  );
}

export function statusBadge(status: ProductStatus, s: ThemeStyles) {
  if (status === "pending")      return s.statusPending;
  if (status === "ai_enhanced")  return s.statusAiEnhanced;
  if (status === "published")    return s.statusPublished;
  return s.statusSoldArchive;
}
