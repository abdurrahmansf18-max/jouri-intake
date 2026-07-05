import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ImagePlus, Layers3, Loader2, Search, Tag } from "lucide-react";
import { useApp } from "../context";
import { COPY, cn, filterLabel, normalizeCategory, normalizeProductType } from "../i18n";
import { DARK, LIGHT } from "../theme";
import type { ProductRecord, StatusFilter } from "../types";
import { searchProducts } from "../search";
import ProductCard from "../components/ProductCard";
import ProductDetail from "../components/ProductDetail";
import Pagination from "../components/Pagination";
import { PromptModal } from "../components/PromptModal";
import { useProductCacheActions, useProductsQuery } from "../queries";
import { bulkUpdateProducts, bulkUpdateStatus, bulkPushToShopify } from "../api";

const PAGE_SIZE = 30;

const FILTERS: StatusFilter[] = ["all", "pending", "ai_enhanced", "published"];


export default function ProductsPage() {
  const { locale, theme, showToast } = useApp();
  const t = COPY[locale];
  const s = theme === "dark" ? DARK : LIGHT;

  const [filter, setFilter] = useState<StatusFilter>("all");
  const [onlyUnsynced, setOnlyUnsynced] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [seasonFilter, setSeasonFilter] = useState<string>("all");
  const [seasonMenuOpen, setSeasonMenuOpen] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushProgress, setPushProgress] = useState<string | null>(null);
  const [statusBulkLoading, setStatusBulkLoading] = useState<"ai_enhanced" | "published" | null>(null);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailMode, setDetailMode] = useState<"view" | "edit">("view");
  const [promptConfig, setPromptConfig] = useState<{
    isOpen: boolean;
    title: string;
    description?: string;
    placeholder?: string;
    type?: "text" | "password";
    onConfirm: (v: string) => void;
    onCancel: () => void;
  } | null>(null);
  const [page, setPage] = useState(1);
  const productsQuery = useProductsQuery();
  const cacheActions = useProductCacheActions();

  const allProducts = productsQuery.data ?? [];
  const records = useMemo(() => allProducts.filter((p) => p.status !== "sold_archive"), [allProducts]);
  const loading = productsQuery.isLoading;

  const counts: Record<StatusFilter, number> = {
    all: records.length,
    pending: records.filter((r) => r.status === "pending").length,
    ai_enhanced: records.filter((r) => r.status === "ai_enhanced").length,
    published: records.filter((r) => r.status === "published").length,
    sold_archive: 0,
  };
  const unsyncedPublishedCount = records.filter((r) => r.status === "published" && !r.shopify?.productId).length;

  const statusRecords = useMemo(
    () => records.filter((r) => filter === "all" || r.status === filter),
    [records, filter],
  );

  const recordsForCategoryCounts = useMemo(
    () => statusRecords.filter((r) => {
      const productType = normalizeProductType(r.parsed?.productTypeSuggestion ?? "");
      if (typeFilter === "untyped") return !productType;
      if (typeFilter !== "all") return productType === typeFilter;
      const season = r.parsed?.season ?? "";
      if (seasonFilter === "unspecified") return !season;
      if (seasonFilter !== "all") return season === seasonFilter;
      return true;
    }),
    [statusRecords, typeFilter, seasonFilter],
  );

  const recordsForTypeCounts = useMemo(
    () => statusRecords.filter((r) => {
      const category = normalizeCategory(r.parsed?.categorySuggestion ?? "");
      if (categoryFilter === "uncategorized") return !category;
      if (categoryFilter !== "all") return category === categoryFilter;
      const season = r.parsed?.season ?? "";
      if (seasonFilter === "unspecified") return !season;
      if (seasonFilter !== "all") return season === seasonFilter;
      return true;
    }),
    [statusRecords, categoryFilter, seasonFilter],
  );

  const categoryCounts = useMemo(() => {
    const countsByCategory = new Map<string, number>();
    let uncategorized = 0;
    recordsForCategoryCounts.forEach((r) => {
      const category = normalizeCategory(r.parsed?.categorySuggestion ?? "");
      if (!category) {
        uncategorized += 1;
        return;
      }
      countsByCategory.set(category, (countsByCategory.get(category) ?? 0) + 1);
    });
    return {
      categories: Array.from(countsByCategory.entries()).sort(([a], [b]) => a.localeCompare(b)),
      uncategorized,
    };
  }, [recordsForCategoryCounts]);

  const typeCounts = useMemo(() => {
    const countsByType = new Map<string, number>();
    let untyped = 0;
    recordsForTypeCounts.forEach((r) => {
      const productType = normalizeProductType(r.parsed?.productTypeSuggestion ?? "");
      if (!productType) {
        untyped += 1;
        return;
      }
      countsByType.set(productType, (countsByType.get(productType) ?? 0) + 1);
    });
    return {
      types: Array.from(countsByType.entries()).sort(([a], [b]) => a.localeCompare(b)),
      untyped,
    };
  }, [recordsForTypeCounts]);

  const recordsForSeasonCounts = useMemo(
    () => statusRecords.filter((r) => {
      const category = normalizeCategory(r.parsed?.categorySuggestion ?? "");
      if (categoryFilter === "uncategorized" && category) return false;
      if (categoryFilter !== "all" && categoryFilter !== "uncategorized" && category !== categoryFilter) return false;

      const productType = normalizeProductType(r.parsed?.productTypeSuggestion ?? "");
      if (typeFilter === "untyped" && productType) return false;
      if (typeFilter !== "all" && typeFilter !== "untyped" && productType !== typeFilter) return false;
      return true;
    }),
    [statusRecords, categoryFilter, typeFilter],
  );

  const seasonCounts = useMemo(() => {
    const countsBySeason = new Map<string, number>();
    let unspecified = 0;
    recordsForSeasonCounts.forEach((r) => {
      const season = r.parsed?.season ?? "";
      if (!season) {
        unspecified += 1;
        return;
      }
      countsBySeason.set(season, (countsBySeason.get(season) ?? 0) + 1);
    });
    return {
      seasons: Array.from(countsBySeason.entries()).sort(([a], [b]) => a.localeCompare(b)),
      unspecified,
    };
  }, [recordsForSeasonCounts]);

  // Filtre veya arama değişince sayfa 1'e dön
  useEffect(() => { setPage(1); }, [filter, onlyUnsynced, search, categoryFilter, typeFilter, seasonFilter]);

  const searchResults = useMemo(() => {
    const filterScoped = records.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (onlyUnsynced && (r.status !== "published" || r.shopify?.productId)) return false;

      const cat = normalizeCategory(r.parsed?.categorySuggestion ?? "");
      if (categoryFilter === "uncategorized" && cat) return false;
      if (categoryFilter !== "all" && categoryFilter !== "uncategorized" && cat !== categoryFilter) return false;

      const productType = normalizeProductType(r.parsed?.productTypeSuggestion ?? "");
      if (typeFilter === "untyped" && productType) return false;
      if (typeFilter !== "all" && typeFilter !== "untyped" && productType !== typeFilter) return false;

      const season = r.parsed?.season ?? "";
      if (seasonFilter === "unspecified" && season) return false;
      if (seasonFilter !== "all" && seasonFilter !== "unspecified" && season !== seasonFilter) return false;

      return true;
    });
    return searchProducts(filterScoped, search);
  }, [records, filter, onlyUnsynced, search, categoryFilter, typeFilter, seasonFilter]);

  const filtered = useMemo(() => searchResults.map((result) => result.record), [searchResults]);
  const searchMatchesById = useMemo(
    () => new Map(searchResults.map((result) => [result.record.id, result.matches])),
    [searchResults],
  );

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  function replaceRecord(updated: ProductRecord) {
    cacheActions.upsertProduct(updated);
    if (updated.status === "sold_archive") {
      setSelectedId(null);
    }
  }

  function removeRecord(id: string) {
    cacheActions.removeProduct(id);
    if (selectedId === id) setSelectedId(null);
  }

  async function handleBulkStatusChange(status: "ai_enhanced" | "published") {
    setStatusBulkLoading(status);
    try {
      const updatedRecords = await bulkUpdateStatus(selectedIds, status);
      const skipped = selectedIds.length - updatedRecords.length;
      showToast(
        skipped > 0
          ? t.bulkStatusPartial(updatedRecords.length, skipped)
          : t.bulkStatusSuccess(updatedRecords.length),
        skipped > 0 ? "error" : "success",
      );
      setTimeout(() => window.location.reload(), 1000);
    } catch (e) {
      showToast(t.errors.ERR_GENERAL, "error");
    } finally {
      setStatusBulkLoading(null);
    }
  }

  function openView(id: string) { setSelectedId(id); setDetailMode("view"); }
  function openEdit(id: string) { setSelectedId(id); setDetailMode("edit"); }

  const selected = records.find((r) => r.id === selectedId) ?? null;
  const selectedCategoryLabel =
    categoryFilter === "all" ? t.allCategories :
    categoryFilter === "uncategorized" ? t.uncategorized :
    categoryFilter;
  const selectedTypeLabel =
    typeFilter === "all" ? t.allProductTypes :
    typeFilter === "untyped" ? t.untyped :
    typeFilter;
  const selectedSeasonLabel =
    seasonFilter === "all" ? t.allSeasons :
    seasonFilter === "unspecified" ? t.unspecified :
    seasonFilter;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-8 animate-spin text-violet-400" />
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className={cn("text-2xl font-black tracking-tight", s.title)}>{t.productsTitle}</h1>
        <div className="text-sm font-bold text-violet-400">{t.imageCount(records.reduce((n, r) => n + r.images.length, 0))}</div>
      </div>

      {/* Filtreler + arama */}
      <div className={cn("rounded-xl border p-4", s.panel)}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button key={f} type="button" onClick={() => setFilter(f)}
                  className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-extrabold transition",
                    filter === f ? s.filterActive : s.filterIdle)}>
                  {filterLabel(f, locale)}
                  <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-black", filter === f ? "bg-white/20" : "bg-white/5")}>
                    {counts[f]}
                  </span>
                </button>
              ))}
              <button type="button" onClick={() => setOnlyUnsynced((v) => !v)}
                className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-extrabold transition",
                  onlyUnsynced ? s.filterActive : s.filterIdle)}>
                {t.filterUnsynced}
                <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-black",
                  onlyUnsynced ? "bg-white/20" : "bg-amber-400/20 text-amber-400")}>
                  {unsyncedPublishedCount}
                </span>
              </button>
            </div>
            <label className={cn("flex min-h-10 flex-1 items-center gap-2 rounded-xl border px-3", s.input)}>
              <Search className="size-4 shrink-0 text-violet-400" />
              <input className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none placeholder:text-slate-500"
                value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder={t.searchPlaceholder} dir="auto" />
            </label>
          </div>

          {/* Categories */}
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => { setCategoryMenuOpen((open) => !open); setTypeMenuOpen(false); setSeasonMenuOpen(false); }}
                className={cn(
                  "inline-flex min-h-10 max-w-full items-center gap-2 rounded-xl border px-3 text-xs font-extrabold transition active:scale-95",
                  categoryFilter !== "uncategorized" && categoryFilter !== "all" ? s.filterActive : cn(s.controlGroup, s.controlIdle),
                )}
              >
                <Layers3 className="size-4 shrink-0" />
                <span className="shrink-0">{t.categoryFilterButton}</span>
                <span className={cn("min-w-0 truncate rounded-lg px-2 py-0.5", categoryFilter !== "all" && categoryFilter !== "uncategorized" ? "bg-white/20" : "bg-white/5")}>
                  {selectedCategoryLabel}
                </span>
                <ChevronDown className={cn("size-4 shrink-0 transition", categoryMenuOpen && "rotate-180")} />
              </button>
              <button
                type="button"
                onClick={() => { setCategoryFilter("uncategorized"); setCategoryMenuOpen(false); }}
                className={cn(
                  "inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-xs font-extrabold transition active:scale-95",
                  categoryFilter === "uncategorized" ? s.filterActive : cn(s.controlGroup, s.controlIdle),
                )}
              >
                {t.uncategorized}
                <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-black">{categoryCounts.uncategorized}</span>
              </button>
            </div>

            {categoryMenuOpen && (
              <div className={cn("grid max-h-64 gap-1 overflow-y-auto rounded-xl border p-2", s.subPanel)}>
                <div className={cn("px-2 py-1 text-[10px] font-black uppercase tracking-wide", s.muted)}>
                  {t.categoryFilterList}
                </div>
                <button
                  type="button"
                  onClick={() => { setCategoryFilter("all"); setCategoryMenuOpen(false); }}
                  className={cn(
                    "flex min-h-10 items-center justify-between gap-3 rounded-lg px-3 text-sm font-extrabold transition",
                    categoryFilter === "all" ? s.filterActive : s.filterIdle,
                  )}
                >
                  <span>{t.allCategories}</span>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-black">{recordsForCategoryCounts.length}</span>
                </button>
                {categoryCounts.categories.map(([category, count]) => (
                  <button
                    key={category}
                    type="button"
                    onClick={() => { setCategoryFilter(category); setCategoryMenuOpen(false); }}
                    className={cn(
                      "flex min-h-10 items-center justify-between gap-3 rounded-lg px-3 text-sm font-extrabold transition",
                      categoryFilter === category ? s.filterActive : s.filterIdle,
                    )}
                  >
                    <span className="min-w-0 truncate" dir="ltr">{category}</span>
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-black">{count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Product types */}
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => { setTypeMenuOpen((open) => !open); setCategoryMenuOpen(false); setSeasonMenuOpen(false); }}
                className={cn(
                  "inline-flex min-h-10 max-w-full items-center gap-2 rounded-xl border px-3 text-xs font-extrabold transition active:scale-95",
                  typeFilter !== "untyped" && typeFilter !== "all" ? s.filterActive : cn(s.controlGroup, s.controlIdle),
                )}
              >
                <Tag className="size-4 shrink-0" />
                <span className="shrink-0">{t.productTypeFilterButton}</span>
                <span className={cn("min-w-0 truncate rounded-lg px-2 py-0.5", typeFilter !== "all" && typeFilter !== "untyped" ? "bg-white/20" : "bg-white/5")}>
                  {selectedTypeLabel}
                </span>
                <ChevronDown className={cn("size-4 shrink-0 transition", typeMenuOpen && "rotate-180")} />
              </button>
              <button
                type="button"
                onClick={() => { setTypeFilter("untyped"); setTypeMenuOpen(false); }}
                className={cn(
                  "inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-xs font-extrabold transition active:scale-95",
                  typeFilter === "untyped" ? s.filterActive : cn(s.controlGroup, s.controlIdle),
                )}
              >
                {t.untyped}
                <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-black">{typeCounts.untyped}</span>
              </button>
            </div>

            {typeMenuOpen && (
              <div className={cn("grid max-h-64 gap-1 overflow-y-auto rounded-xl border p-2", s.subPanel)}>
                <div className={cn("px-2 py-1 text-[10px] font-black uppercase tracking-wide", s.muted)}>
                  {t.productTypeFilterList}
                </div>
                <button
                  type="button"
                  onClick={() => { setTypeFilter("all"); setTypeMenuOpen(false); }}
                  className={cn(
                    "flex min-h-10 items-center justify-between gap-3 rounded-lg px-3 text-sm font-extrabold transition",
                    typeFilter === "all" ? s.filterActive : s.filterIdle,
                  )}
                >
                  <span>{t.allProductTypes}</span>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-black">{recordsForTypeCounts.length}</span>
                </button>
                {typeCounts.types.map(([productType, count]) => (
                  <button
                    key={productType}
                    type="button"
                    onClick={() => { setTypeFilter(productType); setTypeMenuOpen(false); }}
                    className={cn(
                      "flex min-h-10 items-center justify-between gap-3 rounded-lg px-3 text-sm font-extrabold transition",
                      typeFilter === productType ? s.filterActive : s.filterIdle,
                    )}
                  >
                    <span className="min-w-0 truncate" dir="ltr">{productType}</span>
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-black">{count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Season */}
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => { setSeasonMenuOpen((open) => !open); setCategoryMenuOpen(false); setTypeMenuOpen(false); }}
                className={cn(
                  "inline-flex min-h-10 max-w-full items-center gap-2 rounded-xl border px-3 text-xs font-extrabold transition active:scale-95",
                  seasonFilter !== "unspecified" && seasonFilter !== "all" ? s.filterActive : cn(s.controlGroup, s.controlIdle),
                )}
              >
                <Tag className="size-4 shrink-0 text-orange-400" />
                <span className="shrink-0">{t.season}</span>
                <span className={cn("min-w-0 truncate rounded-lg px-2 py-0.5", seasonFilter !== "all" && seasonFilter !== "unspecified" ? "bg-white/20" : "bg-white/5")}>
                  {selectedSeasonLabel}
                </span>
                <ChevronDown className={cn("size-4 shrink-0 transition", seasonMenuOpen && "rotate-180")} />
              </button>
              <button
                type="button"
                onClick={() => { setSeasonFilter("unspecified"); setSeasonMenuOpen(false); }}
                className={cn(
                  "inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-xs font-extrabold transition active:scale-95",
                  seasonFilter === "unspecified" ? s.filterActive : cn(s.controlGroup, s.controlIdle),
                )}
              >
                {t.unspecified}
                <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-black">{seasonCounts.unspecified}</span>
              </button>
            </div>

            {seasonMenuOpen && (
              <div className={cn("grid max-h-64 gap-1 overflow-y-auto rounded-xl border p-2", s.subPanel)}>
                <div className={cn("px-2 py-1 text-[10px] font-black uppercase tracking-wide", s.muted)}>
                  {t.seasonFilterList}
                </div>
                <button
                  type="button"
                  onClick={() => { setSeasonFilter("all"); setSeasonMenuOpen(false); }}
                  className={cn(
                    "flex min-h-10 items-center justify-between gap-3 rounded-lg px-3 text-sm font-extrabold transition",
                    seasonFilter === "all" ? s.filterActive : s.filterIdle,
                  )}
                >
                  <span>{t.allSeasons}</span>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-black">{recordsForSeasonCounts.length}</span>
                </button>
                {seasonCounts.seasons.map(([season, count]) => (
                  <button
                    key={season}
                    type="button"
                    onClick={() => { setSeasonFilter(season); setSeasonMenuOpen(false); }}
                    className={cn(
                      "flex min-h-10 items-center justify-between gap-3 rounded-lg px-3 text-sm font-extrabold transition",
                      seasonFilter === season ? s.filterActive : s.filterIdle,
                    )}
                  >
                    <span className="min-w-0 truncate" dir="ltr">{season}</span>
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-black">{count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 border-t border-white/10 pt-4 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex min-w-0 items-center gap-2 text-sm font-bold cursor-pointer">
                <input type="checkbox" checked={bulkMode} onChange={(e) => {
                  setBulkMode(e.target.checked);
                  if (!e.target.checked) setSelectedIds([]);
                }} className="size-4 rounded" />
                <span className="min-w-0">{t.bulkModeLabel}</span>
              </label>
              {bulkMode && (
                <label className="flex min-w-0 items-center gap-2 text-sm font-medium cursor-pointer text-gray-400">
                  <input type="checkbox" 
                    checked={selectedIds.length > 0 && selectedIds.length === paginated.length} 
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds(paginated.map(r => r.id));
                      } else {
                        setSelectedIds([]);
                      }
                    }} 
                    className="size-4 rounded" 
                  />
                  <span className="min-w-0">{t.selectAllPage}</span>
                </label>
              )}
            </div>
            {bulkMode && selectedIds.length > 0 && (
              <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 md:w-auto">
                <button
                  type="button"
                  disabled={pushLoading}
                  className={cn(
                    "min-h-11 min-w-0 rounded-lg px-4 py-2 text-sm font-black text-white transition-colors",
                    pushLoading ? "bg-green-400 cursor-not-allowed" : "bg-green-600 hover:bg-green-500"
                  )}
                  onClick={async () => {
                    setPushLoading(true);
                    let successCount = 0;
                    for (let i = 0; i < selectedIds.length; i++) {
                      const id = selectedIds[i];
                      const r = records.find(x => x.id === id);
                      const productName = r?.parsed?.titleRaw || t.selectedProductFallback;
                      const progressMsg = t.processingAi(i + 1, selectedIds.length, productName);
                      
                      setPushProgress(progressMsg);
                      
                      try {
                        const result = await bulkPushToShopify([id]);
                        const itemResult = result.results?.[0];
                        if (itemResult?.success) {
                          successCount++;
                        } else {
                          showToast(`${productName}: ${itemResult?.error || t.shopifyError}`, "error");
                        }
                      } catch (e) {
                        showToast(`${productName}: ${t.shopifyError}`, "error");
                      }
                    }
                    setPushProgress(null);
                    setPushLoading(false);
                    const failCount = selectedIds.length - successCount;
                    showToast(
                      failCount > 0
                        ? t.shopifySyncPartial(successCount, failCount)
                        : t.shopifySyncComplete,
                      failCount > 0 ? "error" : "success",
                    );
                    setTimeout(() => window.location.reload(), 1500);
                  }}
                >
                  <span className="block min-w-0 text-center leading-tight">{pushProgress ? pushProgress : t.shopifyBtn}</span>
                </button>
                <button
                  type="button"
                  className="min-h-11 min-w-0 rounded-lg bg-violet-600 px-4 py-2 text-sm font-black text-white hover:bg-violet-500 sm:col-span-2 lg:col-span-1"
                  onClick={async () => {
                    const newSeason = await new Promise<string | null>(resolve => {
                      setPromptConfig({
                        isOpen: true,
                        title: t.editSeasonTitle(selectedIds.length),
                        placeholder: "Summer, Winter, Spring...",
                        type: "text",
                        onConfirm: (val) => { setPromptConfig(null); resolve(val); },
                        onCancel: () => { setPromptConfig(null); resolve(null); }
                      });
                    });
                    if (newSeason !== null && newSeason.trim() !== "") {
                      try {
                        await bulkUpdateProducts(selectedIds, { season: newSeason });
                        showToast(t.seasonUpdateSuccess, "success");
                        setTimeout(() => window.location.reload(), 1000);
                      } catch (e) {
                        showToast(t.errors.ERR_GENERAL, "error");
                      }
                    }
                  }}
                >
                  <span className="block min-w-0 text-center leading-tight">{t.bulkEditSelected(selectedIds.length)}</span>
                </button>
                <button
                  type="button"
                  disabled={statusBulkLoading !== null}
                  className={cn(
                    "min-h-11 min-w-0 rounded-lg px-4 py-2 text-sm font-black text-white transition-colors",
                    statusBulkLoading !== null ? "bg-blue-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-500"
                  )}
                  onClick={() => handleBulkStatusChange("ai_enhanced")}
                >
                  <span className="block min-w-0 text-center leading-tight">
                    {statusBulkLoading === "ai_enhanced" ? t.bulkStatusWorking : t.bulkMarkAiEnhanced(selectedIds.length)}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={statusBulkLoading !== null}
                  className={cn(
                    "min-h-11 min-w-0 rounded-lg px-4 py-2 text-sm font-black text-white transition-colors",
                    statusBulkLoading !== null ? "bg-emerald-400 cursor-not-allowed" : "bg-emerald-600 hover:bg-emerald-500"
                  )}
                  onClick={() => handleBulkStatusChange("published")}
                >
                  <span className="block min-w-0 text-center leading-tight">
                    {statusBulkLoading === "published" ? t.bulkStatusWorking : t.bulkMarkPublished(selectedIds.length)}
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16">
          <ImagePlus className={cn("size-12", s.emptyIcon)} />
          <p className={cn("text-sm font-semibold", s.muted)}>{records.length === 0 ? t.noRecords : t.noFiltered}</p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {paginated.map((record) => (
              <ProductCard
                key={record.id}
                record={record}
                onOpen={() => openView(record.id)}
                onEdit={() => openEdit(record.id)}
                onReplace={replaceRecord}
                searchQuery={search}
                searchMatches={searchMatchesById.get(record.id) ?? []}
                selectable={bulkMode}
                selected={selectedIds.includes(record.id)}
                onToggleSelect={(id, isSelected) => {
                  setSelectedIds((prev) => 
                    isSelected ? [...prev, id] : prev.filter((i) => i !== id)
                  );
                }}
              />
            ))}
          </div>
          <Pagination
            page={page}
            totalPages={totalPages}
            totalCount={filtered.length}
            pageSize={PAGE_SIZE}
            onChange={setPage}
            s={s}
          />
        </>
      )}

      {selected && (
        <ProductDetail
          record={selected}
          initialMode={detailMode}
          onClose={() => setSelectedId(null)}
          onReplace={replaceRecord}
          onDelete={removeRecord}
          allProducts={allProducts}
          navigationProducts={filtered}
          onNavigate={(product) => { setSelectedId(product.id); setDetailMode("view"); }}
        />
      )}

      {promptConfig && (
        <PromptModal
          {...promptConfig}
          confirmText={(t as any).confirm || "Tamam"}
          cancelText={(t as any).cancel || "İptal"}
        />
      )}
    </div>
  );
}
