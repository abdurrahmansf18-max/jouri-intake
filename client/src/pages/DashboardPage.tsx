import { useEffect, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, ArchiveIcon, Box,
  CheckCircle2, Clock, DollarSign, Images, Loader2,
  LogIn, PackageCheck, PackageX, ShoppingBag, Tag, Trash2,
} from "lucide-react";
import { deleteLog, fetchLogs, fetchProducts, productImageUrl } from "../api";
import { useProductSync } from "../hooks/useProductSync";
import { useApp } from "../context";
import { COPY, cn, logActionLabel, statusLabel } from "../i18n";
import { DARK, LIGHT, type ThemeStyles } from "../theme";
import { statusBadge } from "../components/ProductCard";
import type { ActivityLog, ProductRecord } from "../types";

type NamedCount = { label: string; count: number };

function hasEnhancedImage(product: ProductRecord): boolean {
  return product.images.some((img) => img.folder === "enhanced");
}

function isMissingValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return !normalized || normalized === "-" || normalized === "—" || normalized === "unknown";
}

function topCounts(
  products: ProductRecord[],
  read: (product: ProductRecord) => string,
  limit = 5,
): NamedCount[] {
  const counts = new Map<string, number>();
  for (const product of products) {
    const label = read(product).trim();
    if (isMissingValue(label)) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export default function DashboardPage() {
  const { locale, theme } = useApp();
  const t = COPY[locale];
  const s = theme === "dark" ? DARK : LIGHT;

  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useProductSync({
    onProductUpdated: (updated) => {
      setProducts((prev) => {
        const exists = prev.find((p) => p.id === updated.id);
        return exists ? prev.map((p) => p.id === updated.id ? updated : p) : [updated, ...prev];
      });
    },
    onProductCreated: (created) => {
      setProducts((prev) => [created, ...prev.filter((p) => p.id !== created.id)]);
    },
    onProductDeleted: (id) => {
      setProducts((prev) => prev.filter((p) => p.id !== id));
    },
  });

  useEffect(() => {
    Promise.all([fetchProducts(), fetchLogs(50)])
      .then(([prods, activity]) => { setProducts(prods); setLogs(activity); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // ── Hesaplamalar ──────────────────────────────────────────────────────────

  const active = useMemo(() => products.filter((p) => p.status !== "sold_archive"), [products]);

  const counts = {
    pending:      products.filter((p) => p.status === "pending").length,
    ai_enhanced:  products.filter((p) => p.status === "ai_enhanced").length,
    published:    products.filter((p) => p.status === "published").length,
    sold_archive: products.filter((p) => p.status === "sold_archive").length,
    // Sadece aktif ürünlerin stok toplamı (satıldı-arşiv = 0 zaten ama tutarlılık için)
    activeStock: active.reduce((n, p) => n + Math.max(0, p.stockQuantity), 0),
    totalImages: active.reduce((n, p) => n + p.images.length, 0),
    // Toplam satış adedi
    totalSold: products.reduce((n, p) => n + Math.max(0, p.soldQuantity), 0),
  };

  const imageStats = active.reduce(
    (stats, product) => {
      for (const image of product.images) {
        if (image.folder === "enhanced") stats.ai += 1;
        else stats.original += 1;
      }
      return stats;
    },
    { original: 0, ai: 0 },
  );

  const smart = {
    aiReadyPending: active.filter((p) => p.status === "pending" && hasEnhancedImage(p)).length,
    aiImageProducts: active.filter(hasEnhancedImage).length,
    noCategory: active.filter((p) => isMissingValue(p.parsed.categorySuggestion)).length,
    noProductType: active.filter((p) => isMissingValue(p.parsed.productTypeSuggestion)).length,
    lowStock: active.filter((p) => p.stockQuantity > 0 && p.stockQuantity <= 2).length,
    outOfStock: active.filter((p) => p.stockQuantity === 0).length,
  };

  const avgImages = active.length > 0 ? (counts.totalImages / active.length).toFixed(1) : "0";
  const aiImagePct = percent(imageStats.ai, counts.totalImages);
  const originalImagePct = percent(imageStats.original, counts.totalImages);
  const aiProductPct = percent(smart.aiImageProducts, active.length);
  const topCategories = topCounts(active, (p) => p.parsed.categorySuggestion);
  const topProductTypes = topCounts(active, (p) => p.parsed.productTypeSuggestion);

  // Stok değeri: sadece fiyatı girilmiş ve stoku olan aktif ürünler
  const stockValue = active.reduce((sum, p) => {
    const price = parseFloat(p.parsed.priceAmount);
    if (!isNaN(price) && p.stockQuantity > 0) return sum + price * p.stockQuantity;
    return sum;
  }, 0);

  // İnceleme gerektiren ürünler
  const attention = {
    noPrice:  active.filter((p) => !p.parsed.priceAmount).length,
    noImages: active.filter((p) => p.images.length === 0).length,
  };
  const hasAttention = attention.noPrice > 0 || attention.noImages > 0
    || smart.noCategory > 0 || smart.noProductType > 0
    || smart.lowStock > 0 || smart.outOfStock > 0
    || smart.aiReadyPending > 0;

  // Son eklenen ürünler (arşiv hariç, en yeni 6)
  const recentProducts = [...active]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 6);

  // İş akışı ilerlemesi
  const activeTotal = counts.pending + counts.ai_enhanced + counts.published;
  const workflowSteps = [
    { label: t.dashPending,    count: counts.pending,     color: "bg-amber-400",   border: "border-amber-400/40",  text: "text-amber-400" },
    { label: t.dashAiEnhanced, count: counts.ai_enhanced, color: "bg-blue-400",    border: "border-blue-400/40",   text: "text-blue-400" },
    { label: t.dashPublished,  count: counts.published,   color: "bg-emerald-400", border: "border-emerald-400/40",text: "text-emerald-400" },
  ];

  const dateLocale = locale === "ar" ? "ar" : "tr-TR";

  function timeAgo(iso: string): string {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60)    return locale === "ar" ? "الآن" : "az önce";
    if (diff < 3600)  { const m = Math.floor(diff / 60);   return locale === "ar" ? `منذ ${m} دقيقة` : `${m} dk önce`; }
    if (diff < 86400) { const h = Math.floor(diff / 3600); return locale === "ar" ? `منذ ${h} ساعة`  : `${h} sa önce`; }
    return new Date(iso).toLocaleDateString(dateLocale);
  }

  async function handleDeleteLog(id: number) {
    setDeletingId(id);
    try { await deleteLog(id); setLogs((prev) => prev.filter((l) => l.id !== id)); }
    catch { /* ignore */ } finally { setDeletingId(null); }
  }

  function fieldLabel(field: string): string {
    const map: Record<string, string> = {
      title: t.logFieldTitle,
      price: t.logFieldPrice, color: t.logFieldColor, size: t.logFieldSize,
      stock: t.logFieldStock, category: t.logFieldCategory,
      product_type: t.logFieldProductType, notes: t.logFieldNotes,
      currency: t.logFieldCurrency, description: t.logFieldDescription,
    };
    return map[field] || field;
  }

  function actionIcon(action: string) {
    const cls = "size-4";
    switch (action) {
      case "login":        return <LogIn        className={cn(cls, "text-violet-400")} />;
      case "create":       return <PackageCheck className={cn(cls, "text-emerald-400")} />;
      case "update":       return <Activity     className={cn(cls, "text-blue-400")} />;
      case "delete":       return <Trash2       className={cn(cls, "text-red-400")} />;
      case "sell":         return <ShoppingBag  className={cn(cls, "text-amber-400")} />;
      case "restore":      return <ArchiveIcon  className={cn(cls, "text-violet-400")} />;
      case "status_change":return <CheckCircle2 className={cn(cls, "text-indigo-400")} />;
      case "add_images":   return <Images       className={cn(cls, "text-sky-400")} />;
      case "reset_sales":  return <PackageX     className={cn(cls, "text-slate-400")} />;
      default:             return <Activity     className={cn(cls, s.muted)} />;
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-8 animate-spin text-violet-400" />
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <h1 className={cn("text-2xl font-black tracking-tight", s.title)}>{t.dashTitle}</h1>

      {/* ── 1. İş Akışı Boru Hattı ── */}
      <div className={cn("rounded-xl border p-3 sm:p-4", s.panel)}>
        <div className={cn("mb-3 flex items-center gap-2", s.muted)}>
          <Tag className="size-4" />
          <span className="text-xs font-black uppercase tracking-wide">{t.dashWorkflow}</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {workflowSteps.map((step, i) => {
            const pct = activeTotal > 0 ? Math.round((step.count / activeTotal) * 100) : 0;
            return (
              <div key={step.label} className={cn("rounded-xl border p-2.5 sm:p-4", step.border, "bg-white/2")}>
                <div className={cn("text-xl sm:text-3xl font-black", step.text)}>{step.count}</div>
                <div className={cn("mt-0.5 truncate text-[10px] sm:text-xs font-bold", s.muted)}>{step.label}</div>
                <div className="mt-2 h-1 w-full rounded-full bg-white/5">
                  <div
                    className={cn("h-1 rounded-full transition-all", step.color)}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className={cn("mt-1 text-[10px] font-bold", s.muted)}>{pct}%</div>
                {i < workflowSteps.length - 1 && (
                  <div className={cn("mt-1.5 text-[10px] font-bold", s.muted)}>
                    {locale === "ar" ? "←" : "→"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 2. Metrikler ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <MetricCard
          icon={<Box className="size-4 text-emerald-400" />}
          label={t.dashActiveStock}
          value={counts.activeStock}
          color="text-emerald-400"
          bg="bg-emerald-400/10 border-emerald-400/20"
        />
        <MetricCard
          icon={<DollarSign className="size-4 text-violet-400" />}
          label={t.dashStockValue}
          value={`${stockValue.toFixed(0)} EUR`}
          color="text-violet-400"
          bg="bg-violet-400/10 border-violet-400/20"
          small
        />
        <MetricCard
          icon={<Images className="size-4 text-sky-400" />}
          label={t.dashTotalImages}
          value={counts.totalImages}
          color="text-sky-400"
          bg="bg-sky-400/10 border-sky-400/20"
        />
        <MetricCard
          icon={<ShoppingBag className="size-4 text-amber-400" />}
          label={t.dashTotalSold}
          value={counts.totalSold}
          color="text-amber-400"
          bg="bg-amber-400/10 border-amber-400/20"
        />
        <MetricCard
          icon={<Images className="size-4 text-blue-400" />}
          label={t.dashAiImages}
          value={imageStats.ai}
          color="text-blue-400"
          bg="bg-blue-400/10 border-blue-400/20"
        />
        <MetricCard
          icon={<Activity className="size-4 text-fuchsia-400" />}
          label={t.dashAvgImages}
          value={avgImages}
          color="text-fuchsia-400"
          bg="bg-fuchsia-400/10 border-fuchsia-400/20"
        />
      </div>

      {/* ── 3. Akıllı özet ── */}
      <div className="grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
        <div className={cn("rounded-xl border", s.panel)}>
          <PanelHeader icon={<Images className="size-5 text-sky-400" />} title={t.dashImageHealth} s={s} />
          <div className="grid gap-4 p-4 sm:grid-cols-3">
            <ImageStat
              label={t.dashOriginalImages}
              value={imageStats.original}
              pct={originalImagePct}
              color="bg-sky-400"
              s={s}
            />
            <ImageStat
              label={t.dashAiImages}
              value={imageStats.ai}
              pct={aiImagePct}
              color="bg-blue-400"
              s={s}
            />
            <ImageStat
              label={t.dashAiCoverage}
              value={`${smart.aiImageProducts}/${active.length}`}
              pct={aiProductPct}
              color="bg-violet-400"
              s={s}
            />
          </div>
        </div>

        <div className={cn("rounded-xl border", s.panel)}>
          <PanelHeader icon={<AlertTriangle className="size-5 text-amber-400" />} title={t.dashSmartCheck} s={s} />
          <div className="grid divide-y" style={{ borderColor: "inherit" }}>
            <SmartRow label={t.dashAiReadyPending} value={smart.aiReadyPending} tone="blue" s={s} />
            <SmartRow label={t.dashLowStock} value={smart.lowStock} tone="amber" s={s} />
            <SmartRow label={t.dashOutOfStock} value={smart.outOfStock} tone="red" s={s} />
          </div>
        </div>
      </div>

      {/* ── 4. Arşiv sayacı ── */}
      {counts.sold_archive > 0 && (
        <div className={cn("flex items-center gap-3 rounded-xl border px-4 py-3", "bg-slate-400/5 border-slate-400/20")}>
          <ArchiveIcon className="size-4 text-slate-400 shrink-0" />
          <span className={cn("text-sm font-bold", s.muted)}>
            {locale === "ar"
              ? `${counts.sold_archive} منتج في أرشيف المبيعات`
              : `${counts.sold_archive} ürün satıldı-arşivde`}
          </span>
        </div>
      )}

      {/* ── 5. İnceleme Gerekiyor — sadece sorun varsa göster ── */}
      {hasAttention && (
      <div className={cn("rounded-xl border", s.panel)}>
        <div className={cn("flex items-center gap-3 border-b px-4 sm:px-5 py-3 sm:py-4", s.panelBorder)}>
          <AlertTriangle className="size-5 text-amber-400" />
          <h2 className={cn("text-base font-extrabold", s.title)}>{t.dashNeedsAttention}</h2>
        </div>
        <div className="grid divide-y" style={{ borderColor: "inherit" }}>
          {attention.noPrice > 0 && (
            <AttentionRow
              icon={<DollarSign className="size-4 text-amber-400" />}
              text={t.dashNoPrice(attention.noPrice)}
              s={s}
            />
          )}
          {attention.noImages > 0 && (
            <AttentionRow
              icon={<Images className="size-4 text-red-400" />}
              text={t.dashNoImages(attention.noImages)}
              s={s}
            />
          )}
          {smart.noCategory > 0 && (
            <AttentionRow
              icon={<Tag className="size-4 text-violet-400" />}
              text={t.dashNoCategory(smart.noCategory)}
              s={s}
            />
          )}
          {smart.noProductType > 0 && (
            <AttentionRow
              icon={<Box className="size-4 text-sky-400" />}
              text={t.dashNoProductType(smart.noProductType)}
              s={s}
            />
          )}
          {smart.aiReadyPending > 0 && (
            <AttentionRow
              icon={<PackageCheck className="size-4 text-blue-400" />}
              text={t.dashAiReadyPendingText(smart.aiReadyPending)}
              s={s}
            />
          )}
          {smart.lowStock > 0 && (
            <AttentionRow
              icon={<Box className="size-4 text-amber-400" />}
              text={t.dashLowStockText(smart.lowStock)}
              s={s}
            />
          )}
          {smart.outOfStock > 0 && (
            <AttentionRow
              icon={<PackageX className="size-4 text-red-400" />}
              text={t.dashOutOfStockText(smart.outOfStock)}
              s={s}
            />
          )}
        </div>
      </div>
      )}

      {/* ── 6. Kategori ve tip özeti ── */}
      <div className="grid gap-3 lg:grid-cols-2">
        <TopListPanel
          title={t.dashTopCategories}
          items={topCategories}
          emptyText={t.dashNoCategoryData}
          icon={<Tag className="size-5 text-violet-400" />}
          s={s}
        />
        <TopListPanel
          title={t.dashTopProductTypes}
          items={topProductTypes}
          emptyText={t.dashNoProductTypeData}
          icon={<Box className="size-5 text-sky-400" />}
          s={s}
        />
      </div>

      {/* ── 7. Son Eklenen Ürünler ── */}
      {recentProducts.length > 0 && (
        <div className={cn("rounded-xl border", s.panel)}>
          <div className={cn("flex items-center gap-3 border-b px-4 sm:px-5 py-3 sm:py-4", s.panelBorder)}>
            <PackageCheck className="size-5 text-violet-400" />
            <h2 className={cn("text-base font-extrabold", s.title)}>{t.dashRecentProducts}</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">
            {recentProducts.map((p) => {
              const firstImg = p.images[0];
              return (
                <div key={p.id} className={cn("overflow-hidden rounded-xl border", s.subPanel)}>
                  {firstImg ? (
                    <img
                      src={productImageUrl(p.id, firstImg.fileName, undefined, firstImg.folder)}
                      alt={firstImg.originalName}
                      className="aspect-video w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex aspect-video items-center justify-center bg-black/10">
                      <Images className="size-6 opacity-20" />
                    </div>
                  )}
                  <div className="p-2.5">
                    <p className={cn("line-clamp-1 text-xs font-extrabold", s.title)} dir="auto">
                      {p.parsed.titleRaw || p.folderName}
                    </p>
                    <div className="mt-1 flex items-center justify-between gap-1">
                      {p.parsed.priceAmount && (
                        <span className="text-[10px] font-black text-emerald-400">
                          {p.parsed.priceAmount} {p.parsed.currency}
                        </span>
                      )}
                      <span className={cn("rounded-md border px-1.5 py-0.5 text-[9px] font-black", statusBadge(p.status, s))}>
                        {statusLabel(p.status, locale)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 8. Son İşlemler ── */}
      <div className={cn("rounded-xl border", s.panel)}>
        <div className={cn("flex items-center gap-3 border-b px-4 sm:px-5 py-3 sm:py-4", s.panelBorder)}>
          <Activity className="size-5 text-violet-400" />
          <h2 className={cn("text-base font-extrabold", s.title)}>{t.dashRecentActivity}</h2>
        </div>

        {logs.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12">
            <Clock className={cn("size-10", s.emptyIcon)} />
            <p className={cn("text-sm font-semibold", s.muted)}>{t.dashNoActivity}</p>
          </div>
        ) : (
          <div className="max-h-[28rem] overflow-y-auto">
            {logs.map((log) => {
              const changed = log.action === "update" && log.details?.changed
                ? log.details.changed as Record<string, { from: string; to: string }>
                : null;
              return (
                <div
                  key={log.id}
                  className={cn("flex items-start gap-2 sm:gap-3 border-b px-3 sm:px-5 py-3 last:border-b-0", s.panelBorder)}
                >
                  <div className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", s.subPanel)}>
                    {actionIcon(log.action)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={cn("text-sm font-bold", s.title)}>
                      {logActionLabel(log.action, locale, log.details)}
                    </div>
                    {log.product_title && (
                      <div className={cn("mt-0.5 truncate text-xs font-semibold", s.muted)}>
                        {log.product_title}
                      </div>
                    )}
                    {changed && Object.keys(changed).length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        <span className={cn("text-[10px] font-bold", s.muted)}>{t.logChanged}:</span>
                        {Object.entries(changed).map(([field, ch]) => (
                          <span
                            key={field}
                            className="inline-flex max-w-full items-center gap-1 rounded-md bg-blue-400/10 px-1.5 py-0.5 text-[10px] font-bold text-blue-300 ring-1 ring-blue-400/20"
                          >
                            <span className="shrink-0">{fieldLabel(field)}:</span>
                            <span className="truncate max-w-[60px] opacity-60 line-through">{ch.from}</span>
                            <span className="shrink-0">→</span>
                            <span className="truncate max-w-[60px]">{ch.to}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className={cn("text-xs font-semibold", s.muted)}>{timeAgo(log.created_at)}</span>
                    <button
                      type="button"
                      title={t.logDeleteEntry}
                      disabled={deletingId === log.id}
                      onClick={() => handleDeleteLog(log.id)}
                      className={cn(
                        "flex size-6 items-center justify-center rounded-md transition hover:bg-red-400/15 hover:text-red-400",
                        s.muted, deletingId === log.id && "opacity-40",
                      )}
                    >
                      {deletingId === log.id
                        ? <Loader2 className="size-3 animate-spin" />
                        : <Trash2 className="size-3" />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Yardımcı bileşenler ───────────────────────────────────────────────────────

function MetricCard({
  icon, label, value, color, bg, small = false,
}: {
  icon: React.ReactNode; label: string;
  value: string | number; color: string; bg: string; small?: boolean;
}) {
  return (
    <div className={cn("rounded-xl border p-3 sm:p-4", bg)}>
      <div className="mb-1 flex items-center gap-1.5">{icon}</div>
      <div className={cn("font-black leading-none", small ? "text-base sm:text-xl" : "text-2xl sm:text-3xl", color)}>{value}</div>
      <div className="mt-1.5 text-[10px] sm:text-xs font-bold text-slate-400 leading-snug">{label}</div>
    </div>
  );
}

function PanelHeader({ icon, title, s }: {
  icon: React.ReactNode; title: string; s: ThemeStyles;
}) {
  return (
    <div className={cn("flex items-center gap-3 border-b px-4 sm:px-5 py-3 sm:py-4", s.panelBorder)}>
      {icon}
      <h2 className={cn("text-base font-extrabold", s.title)}>{title}</h2>
    </div>
  );
}

function ImageStat({ label, value, pct, color, s }: {
  label: string; value: string | number; pct: number; color: string; s: ThemeStyles;
}) {
  return (
    <div className={cn("rounded-xl border p-3", s.subPanel)}>
      <div className={cn("text-xs font-black", s.muted)}>{label}</div>
      <div className={cn("mt-2 flex items-end justify-between gap-3", s.title)}>
        <span className="text-2xl font-black">{value}</span>
        <span className={cn("text-xs font-extrabold", s.muted)}>{pct}%</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/10">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function SmartRow({ label, value, tone, s }: {
  label: string; value: number; tone: "blue" | "amber" | "red"; s: ThemeStyles;
}) {
  const color = tone === "blue" ? "text-blue-400" : tone === "amber" ? "text-amber-400" : "text-red-400";
  const bg = tone === "blue" ? "bg-blue-400/10" : tone === "amber" ? "bg-amber-400/10" : "bg-red-400/10";
  return (
    <div className={cn("flex items-center justify-between gap-3 px-4 sm:px-5 py-3", s.panelBorder)}>
      <span className={cn("min-w-0 text-sm font-semibold", s.muted)}>{label}</span>
      <span className={cn("rounded-lg px-2.5 py-1 text-sm font-black", bg, color)}>{value}</span>
    </div>
  );
}

function TopListPanel({ title, items, emptyText, icon, s }: {
  title: string; items: NamedCount[]; emptyText: string; icon: React.ReactNode; s: ThemeStyles;
}) {
  const max = Math.max(1, ...items.map((item) => item.count));
  return (
    <div className={cn("rounded-xl border", s.panel)}>
      <PanelHeader icon={icon} title={title} s={s} />
      {items.length === 0 ? (
        <div className={cn("px-4 py-6 text-sm font-semibold", s.muted)}>{emptyText}</div>
      ) : (
        <div className="grid gap-3 p-4">
          {items.map((item) => {
            const pct = Math.max(6, Math.round((item.count / max) * 100));
            return (
              <div key={item.label} className="grid gap-1.5">
                <div className="flex items-center justify-between gap-3">
                  <span className={cn("min-w-0 truncate text-sm font-extrabold", s.title)}>{item.label}</span>
                  <span className={cn("shrink-0 text-xs font-black", s.muted)}>{item.count}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-black/10">
                  <div className="h-full rounded-full bg-violet-400/80" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AttentionRow({ icon, text, s }: {
  icon: React.ReactNode; text: string; s: ThemeStyles;
}) {
  return (
    <div className={cn("flex items-center gap-3 px-4 sm:px-5 py-3", s.panelBorder)}>
      <span className="shrink-0">{icon}</span>
      <span className={cn("text-sm font-semibold", s.muted)}>{text}</span>
    </div>
  );
}
