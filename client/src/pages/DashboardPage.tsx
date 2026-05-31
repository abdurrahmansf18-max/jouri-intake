import { useEffect, useState } from "react";
import {
  Activity,
  ArchiveIcon,
  CheckCircle2,
  Clock,
  Images,
  Loader2,
  PackageCheck,
  PackageX,
  ShoppingBag,
  Trash2,
} from "lucide-react";
import { deleteLog, fetchLogs, fetchProducts } from "../api";
import { useApp } from "../context";
import { COPY, cn, logActionLabel } from "../i18n";
import { DARK, LIGHT } from "../theme";
import type { ActivityLog, ProductRecord } from "../types";

export default function DashboardPage() {
  const { locale, theme } = useApp();
  const t = COPY[locale];
  const s = theme === "dark" ? DARK : LIGHT;

  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([fetchProducts(), fetchLogs(30)])
      .then(([prods, activity]) => {
        setProducts(prods);
        setLogs(activity);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const counts = {
    pending: products.filter((p) => p.status === "pending").length,
    ai_enhanced: products.filter((p) => p.status === "ai_enhanced").length,
    published: products.filter((p) => p.status === "published").length,
    sold_archive: products.filter((p) => p.status === "sold_archive").length,
    images: products.reduce((n, p) => n + p.images.length, 0),
    stock: products.reduce((n, p) => n + Math.max(0, p.stockQuantity), 0),
  };

  const dateLocale = locale === "ar" ? "ar" : "tr-TR";

  function timeAgo(iso: string): string {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return locale === "ar" ? "الآن" : "az önce";
    if (diff < 3600) {
      const m = Math.floor(diff / 60);
      return locale === "ar" ? `منذ ${m} دقيقة` : `${m} dk önce`;
    }
    if (diff < 86400) {
      const h = Math.floor(diff / 3600);
      return locale === "ar" ? `منذ ${h} ساعة` : `${h} sa önce`;
    }
    return new Date(iso).toLocaleDateString(dateLocale);
  }

  async function handleDeleteLog(id: number) {
    setDeletingId(id);
    try {
      await deleteLog(id);
      setLogs(prev => prev.filter(l => l.id !== id));
    } catch { /* ignore */ } finally {
      setDeletingId(null);
    }
  }

  function fieldLabel(field: string): string {
    const map: Record<string, string> = {
      title: t.logFieldTitle,
      german_title: t.logFieldGermanTitle,
      price: t.logFieldPrice,
      color: t.logFieldColor,
      size: t.logFieldSize,
      stock: t.logFieldStock,
      category: t.logFieldCategory,
      product_type: t.logFieldProductType,
      notes: t.logFieldNotes,
      currency: t.logFieldCurrency,
    };
    return map[field] || field;
  }

  function actionIcon(action: string) {
    const cls = "size-4";
    switch (action) {
      case "create":       return <PackageCheck className={cn(cls, "text-emerald-400")} />;
      case "update":       return <Activity className={cn(cls, "text-blue-400")} />;
      case "delete":       return <Trash2 className={cn(cls, "text-red-400")} />;
      case "sell":         return <ShoppingBag className={cn(cls, "text-amber-400")} />;
      case "restore":      return <ArchiveIcon className={cn(cls, "text-violet-400")} />;
      case "status_change":return <CheckCircle2 className={cn(cls, "text-indigo-400")} />;
      case "add_images":   return <Images className={cn(cls, "text-sky-400")} />;
      case "reset_sales":  return <PackageX className={cn(cls, "text-slate-400")} />;
      default:             return <Activity className={cn(cls, s.muted)} />;
    }
  }

  const stats = [
    { label: t.dashPending,     value: counts.pending,     color: "text-amber-400",   bg: "bg-amber-400/10 border-amber-400/20" },
    { label: t.dashAiEnhanced,  value: counts.ai_enhanced, color: "text-blue-400",    bg: "bg-blue-400/10 border-blue-400/20"  },
    { label: t.dashPublished,   value: counts.published,   color: "text-emerald-400", bg: "bg-emerald-400/10 border-emerald-400/20" },
    { label: t.dashArchive,     value: counts.sold_archive, color: "text-slate-400",  bg: "bg-slate-400/10 border-slate-400/20" },
    { label: t.dashTotalImages, value: counts.images,      color: "text-sky-400",     bg: "bg-sky-400/10 border-sky-400/20"    },
    { label: t.dashTotalStock,  value: counts.stock,       color: "text-violet-400",  bg: "bg-violet-400/10 border-violet-400/20" },
  ];

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

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className={cn("rounded-xl border px-4 py-4", stat.bg)}
          >
            <div className={cn("text-3xl font-black", stat.color)}>{stat.value}</div>
            <div className={cn("mt-1 text-xs font-bold", s.muted)}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Recent activity */}
      <div className={cn("rounded-xl border", s.panel)}>
        <div className={cn("flex items-center gap-3 border-b px-5 py-4", s.panelBorder)}>
          <Activity className="size-5 text-violet-400" />
          <h2 className={cn("text-base font-extrabold", s.title)}>{t.dashRecentActivity}</h2>
        </div>

        {logs.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12">
            <Clock className={cn("size-10", s.emptyIcon)} />
            <p className={cn("text-sm font-semibold", s.muted)}>{t.dashNoActivity}</p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: "transparent" }}>
            {logs.map((log) => {
              const changed = log.action === "update" && log.details?.changed
                ? log.details.changed as Record<string, { from: string; to: string }>
                : null;
              return (
                <div
                  key={log.id}
                  className={cn("flex items-start gap-3 px-5 py-3", s.panelBorder, "border-b last:border-b-0")}
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
                            className="inline-flex items-center gap-1 rounded-md bg-blue-400/10 px-1.5 py-0.5 text-[10px] font-bold text-blue-300 ring-1 ring-blue-400/20"
                          >
                            {fieldLabel(field)}: <span className="line-through opacity-60">{ch.from}</span> → {ch.to}
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
                        s.muted,
                        deletingId === log.id && "opacity-40",
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
