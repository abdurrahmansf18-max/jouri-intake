import { useEffect, useState } from "react";
import {
  Activity, AlertTriangle, ArchiveIcon, Box,
  CheckCircle2, Clock, DollarSign, Images, Loader2,
  LogIn, PackageCheck, PackageX, ShoppingBag, Tag, Trash2,
} from "lucide-react";
import { deleteLog, fetchLogs, fetchProducts, productImageUrl } from "../api";
import { useProductSync } from "../hooks/useProductSync";
import { useApp } from "../context";
import { COPY, cn, logActionLabel, statusLabel } from "../i18n";
import { DARK, LIGHT } from "../theme";
import { statusBadge } from "../components/ProductCard";
import type { ActivityLog, ProductRecord } from "../types";

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

  const active = products.filter((p) => p.status !== "sold_archive");

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
  const hasAttention = attention.noPrice > 0 || attention.noImages > 0;

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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
      </div>

      {/* ── 3. Arşiv sayacı ── */}
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

      {/* ── 4. İnceleme Gerekiyor — sadece sorun varsa göster ── */}
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
        </div>
      </div>
      )}

      {/* ── 5. Son Eklenen Ürünler ── */}
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
                      src={productImageUrl(p.id, firstImg.fileName)}
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

      {/* ── 6. Son İşlemler ── */}
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

function AttentionRow({ icon, text, s }: {
  icon: React.ReactNode; text: string; s: ReturnType<typeof Object.assign>;
}) {
  return (
    <div className={cn("flex items-center gap-3 px-4 sm:px-5 py-3", s.panelBorder)}>
      <span className="shrink-0">{icon}</span>
      <span className={cn("text-sm font-semibold", s.muted)}>{text}</span>
    </div>
  );
}
