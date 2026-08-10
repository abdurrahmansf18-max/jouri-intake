import { useState } from "react";
import { ArchiveRestore, Box, CalendarDays, Copy, ExternalLink, ImageOff, Images, PackageCheck, Palette, Pencil, Ruler, Tag } from "lucide-react";
import { productImageUrl, restoreProduct } from "../api";
import { useApp } from "../context";
import { COPY, cn, statusLabel } from "../i18n";
import { DARK, LIGHT, type ThemeStyles } from "../theme";
import type { ProductRecord, ProductStatus } from "../types";
import { formatPrice } from "../format";
import type { ProductSearchMatch } from "../search";

interface Props {
  record: ProductRecord;
  onOpen: () => void;
  onEdit: () => void;
  onReplace: (updated: ProductRecord) => void;
  showRestoreBtn?: boolean;
  showSoldSizes?: boolean;
  searchQuery?: string;
  searchMatches?: ProductSearchMatch[];
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string, selected: boolean) => void;
}

export default function ProductCard({ record, onOpen, onEdit, onReplace, showRestoreBtn, showSoldSizes, searchQuery, searchMatches = [], selectable, selected, onToggleSelect }: Props) {
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

  function handleCopyCode(e: React.MouseEvent, code: string) {
    e.stopPropagation();
    navigator.clipboard.writeText(code);
    showToast((t as any).copied || "Kopyalandı!", "success");
  }

  const p = record.parsed;
  const category = p.categorySuggestion?.trim();
  const productType = p.productTypeSuggestion?.trim();
  const season = p.season?.trim();
  const color = (p.colorRaw || p.colorGermanSuggestion)?.trim();
  const stockTotal = record.sizeStocks.length
    ? record.sizeStocks.reduce((sum, item) => sum + Math.max(0, item.qty), 0)
    : Math.max(0, record.stockQuantity || 0);
  const sizeSummary = formatSizeSummary(record.sizeStocks);
  const hasShopifyLink = Boolean(record.shopify?.productId);
  const hasCampaign = record.isDiscounted || record.isLimitedTimeDeal || record.isFinalSale;
  const isPartialSoldArchive = Boolean(showSoldSizes && record.status !== "sold_archive" && record.soldSizes.length > 0);
  const statusText = isPartialSoldArchive ? t.partiallySold : statusLabel(record.status, locale);
  const statusClass = isPartialSoldArchive
    ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
    : statusBadge(record.status, s);

  return (
    <article
      className={cn(
        "motion-card group cursor-pointer rounded-2xl border overflow-hidden bg-clip-padding",
        "transition-all duration-300 ease-out hover:-translate-y-1 hover:border-emerald-400/50 hover:shadow-2xl hover:shadow-black/25",
        "focus-within:border-emerald-400/50",
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
            className="size-5 cursor-pointer rounded border-2 border-white accent-emerald-500 shadow-sm"
          />
        </div>
      )}
      {record.images.length > 0 ? (
        <div
          className={cn(
            "flex gap-1.5 overflow-x-auto p-2 relative",
            theme === "dark" ? "bg-black/[0.24]" : "bg-emerald-950/[0.04]",
          )}
          style={{ scrollbarWidth: "none" }}
        >
          {record.images.map((img) => (
            <img
              key={img.fileName}
              src={productImageUrl(record.id, img.fileName)}
              alt={img.originalName}
              className="h-28 w-28 shrink-0 rounded-xl object-cover ring-1 ring-white/10 transition-transform duration-300 group-hover:scale-[1.02]"
              loading="lazy"
              draggable={false}
            />
          ))}
          <span
            className={cn(
              "absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black shadow-sm backdrop-blur-md",
              theme === "dark"
                ? "border-emerald-300/20 bg-stone-950/[0.72] text-emerald-100"
                : "border-emerald-700/10 bg-white/80 text-emerald-800",
            )}
          >
            <Images className="size-3" />
            {record.images.length}
          </span>
        </div>
      ) : (
        <div className={cn("flex h-20 items-center justify-center", theme === "dark" ? "bg-black/20" : "bg-emerald-950/[0.04]")}>
          <ImageOff className="size-7 opacity-30" />
        </div>
      )}

      {/* ── İçerik ── */}
      <div className="p-3.5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <button type="button" onClick={(e) => handleCopyCode(e, record.productCode)} className={cn(
            "inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-xs font-black tracking-wide transition active:scale-95",
            theme === "dark"
              ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20"
              : "border-emerald-700/15 bg-emerald-700/10 text-emerald-800 hover:bg-emerald-700/15",
          )}>
            {record.productCode}
            <Copy className="size-3" />
          </button>
        </div>
        {/* Başlık — her zaman orijinal ad */}
        {p.titleRaw ? (
          <h3 className={cn("line-clamp-2 text-sm font-extrabold leading-5", s.title)} dir="auto">
            <Highlight text={p.titleRaw} query={searchQuery ?? ""} />
          </h3>
        ) : (
          <h3 className={cn("line-clamp-1 text-sm font-extrabold", s.muted)}>{record.folderName}</h3>
        )}

        {searchQuery?.trim() && searchMatches.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {searchMatches.map((match) => (
              <span
                key={match.key}
                className={cn(
                  "inline-flex max-w-full items-center gap-1 rounded-lg border border-emerald-300/20 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-extrabold",
                  theme === "dark" ? "text-emerald-100" : "text-emerald-800",
                )}
                title={`${searchMatchLabel(match.key, t)}: ${match.value}`}
                dir="auto"
              >
                <span className={cn("shrink-0", theme === "dark" ? "text-emerald-300" : "text-emerald-700")}>{searchMatchLabel(match.key, t)}:</span>
                <span className="min-w-0 truncate">
                  <Highlight text={compactMatchValue(match.value)} query={searchQuery} />
                </span>
              </span>
            ))}
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-1.5">
          {(category || productType) && (
            <MetaChip theme={theme} icon={<Tag className="size-3" />} title={[category, productType].filter(Boolean).join(" / ")}>
              {[category, productType].filter(Boolean).join(" / ")}
            </MetaChip>
          )}
          {season && (
            <MetaChip theme={theme} icon={<CalendarDays className="size-3" />} title={season}>
              {season}
            </MetaChip>
          )}
          {color && (
            <MetaChip theme={theme} icon={<Palette className="size-3" />} title={color}>
              {color}
            </MetaChip>
          )}
          {sizeSummary && (
            <MetaChip theme={theme} icon={<Ruler className="size-3" />} title={sizeSummary}>
              {sizeSummary}
            </MetaChip>
          )}
          {record.sizeStocks.slice(0, 2).map((item) => item.code ? (
            <button
              key={`${item.size}-${item.code}`}
              type="button"
              onClick={(e) => handleCopyCode(e, item.code || "")}
              className={cn(
                "smart-chip inline-flex min-w-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] font-extrabold transition active:scale-95",
                theme === "dark"
                  ? "border-emerald-300/15 bg-emerald-300/10 text-emerald-100"
                  : "border-emerald-700/10 bg-emerald-700/[0.06] text-emerald-900",
              )}
              title={item.code}
              dir="ltr"
            >
              <Copy className={cn("size-3 shrink-0", theme === "dark" ? "text-emerald-300" : "text-emerald-700")} />
              <span className="min-w-0 truncate">{item.size}: {item.code}</span>
            </button>
          ) : null)}
          <MetaChip theme={theme} icon={<Box className="size-3" />} title={`${t.stockQuantity}: ${stockTotal}`}>
            {t.stockQuantity}: {stockTotal}
          </MetaChip>
          {hasShopifyLink && (
            <MetaChip theme={theme} icon={<PackageCheck className="size-3" />} title="Shopify">
              Shopify
            </MetaChip>
          )}
        </div>

        {/* Satılan bedenler (arşiv görünümünde) */}
        {showSoldSizes && record.soldSizes.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {record.soldSizes.map((ss) => (
              <span key={ss.size}
                className="inline-flex items-center gap-1 rounded-md bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-extrabold text-amber-400 ring-1 ring-amber-400/25">
                <Ruler className="size-2.5" />
                {t.soldSizeChip(ss.size)}
              </span>
            ))}
          </div>
        )}

        {/* Fiyat + Durum */}
        <div className="mt-2 flex items-center justify-between gap-2">
          {p.priceAmount ? (
            <span className="inline-flex flex-wrap items-center gap-1.5 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-sm font-black text-emerald-300">
              {record.compareAtPriceAmount && (
                <span className="text-[11px] text-slate-400 line-through">
                  {formatPrice(record.compareAtPriceAmount, p.currency)}
                </span>
              )}
              <span>{formatPrice(p.priceAmount, p.currency)}</span>
              {hasCampaign && (
                <span className="rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-amber-400">
                  {record.isFinalSale ? t.finalSaleShort : t.discountedProduct}
                </span>
              )}
            </span>
          ) : <span />}
          <span className={cn("rounded-lg border px-2 py-0.5 text-[10px] font-black", statusClass)}>
            {statusText}
          </span>
        </div>

        {/* Yayında ama Shopify'e gönderilmemiş ürün uyarısı */}
        {record.status === "published" && !record.shopify?.productId && (
          <div className="mt-2 flex flex-wrap gap-1">
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-extrabold text-amber-400 ring-1 ring-amber-400/25">
              {t.cardNotOnShopify}
            </span>
          </div>
        )}

        {/* Alt satır: detay göstergesi + düzenle/geri al butonu */}
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className={cn(
            "inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400",
            "opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100",
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
                "border-emerald-400/30 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20",
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

function MetaChip({ icon, children, title, theme }: { icon: React.ReactNode; children: React.ReactNode; title?: string; theme: "dark" | "light" }) {
  return (
    <span
      className={cn(
        "smart-chip inline-flex min-w-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] font-extrabold",
        theme === "dark"
          ? "border-emerald-300/15 bg-emerald-300/10 text-emerald-100"
          : "border-emerald-700/10 bg-emerald-700/[0.06] text-emerald-900",
      )}
      title={title}
      dir="auto"
    >
      <span className={theme === "dark" ? "text-emerald-300" : "text-emerald-700"}>{icon}</span>
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

function formatSizeSummary(sizeStocks: ProductRecord["sizeStocks"]): string | null {
  const available = sizeStocks.filter((item) => item.size.trim() && item.qty > 0);
  if (!available.length) return null;
  const visible = available.slice(0, 2).map((item) => `${item.size} x${item.qty}`);
  const hidden = available.length - visible.length;
  return hidden > 0 ? `${visible.join(" • ")} +${hidden}` : visible.join(" • ");
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
          <mark key={i} className="rounded-sm bg-yellow-400/45 px-px text-inherit not-italic">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

function compactMatchValue(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 80) return normalized;
  return `${normalized.slice(0, 77)}...`;
}

function searchMatchLabel(key: string, t: Record<string, any>): string {
  if (key === "barcode") return t.barcode || "Barkod";
  if (key === "visual") return t.visualMatch || "Görsel";
  if (key === "product_code") return t.productCode || "Ürün kodu";
  if (key === "title") return t.logFieldTitle;
  if (key === "season") return (t as any).season || "Mevsim";
  if (key === "category") return t.logFieldCategory;
  if (key === "product_type") return t.logFieldProductType;
  if (key === "color") return t.logFieldColor;
  if (key === "german_color") return t.logFieldColor;
  if (key === "sizes") return t.logFieldSize;
  if (key === "price") return t.logFieldPrice;
  if (key === "notes") return t.logFieldNotes;
  if (key === "description") return t.description;
  if (key === "sold_sizes") return t.logFieldSize;
  return key;
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
