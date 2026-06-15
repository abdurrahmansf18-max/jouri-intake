import { useState } from "react";
import { ArchiveRestore, ExternalLink, ImageOff, Pencil, Ruler } from "lucide-react";
import { productImageUrl, restoreProduct } from "../api";
import { useApp } from "../context";
import { COPY, cn, statusLabel } from "../i18n";
import { DARK, LIGHT, type ThemeStyles } from "../theme";
import type { ProductRecord, ProductStatus } from "../types";
import { formatPrice } from "../format";

interface Props {
  record: ProductRecord;
  onOpen: () => void;
  onEdit: () => void;
  onReplace: (updated: ProductRecord) => void;
  showRestoreBtn?: boolean;
  showSoldSizes?: boolean;
  searchQuery?: string;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string, selected: boolean) => void;
}

export default function ProductCard({ record, onOpen, onEdit, onReplace, showRestoreBtn, showSoldSizes, searchQuery, selectable, selected, onToggleSelect }: Props) {
  const { locale, theme, showToast } = useApp();
  const t = COPY[locale];
  const s = theme === "dark" ? DARK : LIGHT;
  const [busy, setBusy] = useState(false);

  async function handleRestore(e: React.MouseEvent) {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const updated = await restoreProduct(record.id, Math.max(1, record.stockQuantity || 1));
      onReplace(updated);
      showToast(t.toastRestored, "success");
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
        "group cursor-pointer rounded-xl border overflow-hidden",
        "transition-all duration-200 hover:-translate-y-1 hover:border-violet-400/50 hover:shadow-lg hover:shadow-violet-900/20",
        "select-none relative",
        s.subPanel,
      )}
      onClick={onOpen}
    >
      {/* ── Görsel şeridi ── */}
      {selectable && (
        <div className="absolute top-2 left-2 z-10" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onToggleSelect?.(record.id, e.target.checked)}
            className="size-5 rounded border-2 border-white cursor-pointer"
          />
        </div>
      )}
      {record.images.length > 0 ? (
        <div
          className="flex gap-1.5 overflow-x-auto p-2 relative"
          style={{ scrollbarWidth: "none", background: "rgba(0,0,0,0.25)" }}
        >
          {record.images.map((img) => (
            <img
              key={img.fileName}
              src={productImageUrl(record.id, img.fileName)}
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
      <div className="p-3">
        {/* Başlık — her zaman orijinal ad */}
        {p.titleRaw ? (
          <h3 className={cn("line-clamp-2 text-sm font-extrabold leading-5", s.title)} dir="auto">
            <Highlight text={p.titleRaw} query={searchQuery ?? ""} />
          </h3>
        ) : (
          <h3 className={cn("line-clamp-1 text-sm font-extrabold", s.muted)}>{record.folderName}</h3>
        )}

        {/* Satılan bedenler (arşiv görünümünde) */}
        {showSoldSizes && record.soldSizes.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {record.soldSizes.map((ss) => (
              <span key={ss.size}
                className="inline-flex items-center gap-1 rounded-md bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-extrabold text-amber-400 ring-1 ring-amber-400/25">
                <Ruler className="size-2.5" />
                {ss.size}
              </span>
            ))}
          </div>
        )}

        {/* Fiyat + Durum */}
        <div className="mt-2 flex items-center justify-between gap-2">
          {p.priceAmount ? (
            <span className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-sm font-black text-emerald-300">
              {formatPrice(p.priceAmount, p.currency)}
            </span>
          ) : <span />}
          <span className={cn("rounded-lg border px-2 py-0.5 text-[10px] font-black", statusBadge(record.status, s))}>
            {statusLabel(record.status, locale)}
          </span>
        </div>

        {/* Alt satır: detay göstergesi + düzenle/geri al butonu */}
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className={cn(
            "inline-flex items-center gap-1 text-[10px] font-bold text-violet-400",
            "opacity-0 transition-opacity group-hover:opacity-100",
          )}>
            <ExternalLink className="size-2.5" />
            {t.viewDetails}
          </span>
          {showRestoreBtn ? (
            <button
              type="button"
              disabled={busy}
              onClick={handleRestore}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-extrabold",
                "transition-all active:scale-95 disabled:opacity-50",
                s.success,
              )}
            >
              <ArchiveRestore className="size-3" />
              {t.restoreProduct}
            </button>
          ) : (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-extrabold",
                "transition-all active:scale-95",
                "border-violet-400/30 bg-violet-400/10 text-violet-300 hover:bg-violet-400/20",
              )}
            >
              <Pencil className="size-3" />
              {t.editBtn}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim() || !text) return <>{text}</>;
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return <>{text}</>;
  const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-sm bg-yellow-400/35 text-yellow-100 px-px not-italic">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
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
