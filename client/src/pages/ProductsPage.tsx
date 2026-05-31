import { useEffect, useMemo, useState } from "react";
import { ImagePlus, Loader2, Search } from "lucide-react";
import { fetchProducts } from "../api";
import { useApp } from "../context";
import { COPY, cn, filterLabel } from "../i18n";
import { DARK, LIGHT } from "../theme";
import type { ProductRecord, StatusFilter } from "../types";
import ProductCard from "../components/ProductCard";
import ProductDetail from "../components/ProductDetail";

const FILTERS: StatusFilter[] = ["all", "pending", "ai_enhanced", "published"];

// Arapça hareke + elif varyantları + Almanca/Latin aksan normalizasyonu
function norm(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")       // Latin aksan işaretleri (ä→a, ö→o, ü→u)
    .replace(/[ً-ٰٟ]/g, "") // Arapça hareke (تشكيل)
    .replace(/[أإآٱ]/g, "ا")              // Elif varyantları
    .replace(/[ىئ]/g, "ي")               // Ya varyantları
    .replace(/ة/g, "ه")                  // Te merbuta
    .toLocaleLowerCase();
}

function normalizeSearch(q: string): string[] {
  return norm(q).split(/\s+/).filter(Boolean);
}

export default function ProductsPage() {
  const { locale, theme } = useApp();
  const t = COPY[locale];
  const s = theme === "dark" ? DARK : LIGHT;

  const [records, setRecords] = useState<ProductRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    fetchProducts()
      .then((all) => setRecords(all.filter((p) => p.status !== "sold_archive")))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const counts: Record<StatusFilter, number> = {
    all: records.length,
    pending: records.filter((r) => r.status === "pending").length,
    ai_enhanced: records.filter((r) => r.status === "ai_enhanced").length,
    published: records.filter((r) => r.status === "published").length,
    sold_archive: 0,
  };

  const filtered = useMemo(() => {
    const tokens = normalizeSearch(search);
    return records.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (tokens.length === 0) return true;
      const p = r.parsed;
      const haystack = norm([
        p.titleRaw, p.germanTitleSuggestion, p.categorySuggestion,
        p.colorRaw, p.sizesRaw, p.priceAmount, p.productTypeSuggestion,
        r.notes, r.folderName, r.description,
      ].join(" "));
      return tokens.every((tok) => haystack.includes(tok));
    });
  }, [records, filter, search]);

  function replaceRecord(updated: ProductRecord) {
    setRecords((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }

  function removeRecord(id: string) {
    setRecords((prev) => prev.filter((r) => r.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  const selected = records.find((r) => r.id === selectedId) ?? null;

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

      {/* Filters + search */}
      <div className={cn("rounded-xl border p-4", s.panel)}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-extrabold transition",
                  filter === f ? s.filterActive : s.filterIdle,
                )}
              >
                {filterLabel(f, locale)}
                <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-black", filter === f ? "bg-white/20" : "bg-white/5")}>
                  {counts[f]}
                </span>
              </button>
            ))}
          </div>
          <label className={cn("flex min-h-10 flex-1 items-center gap-2 rounded-xl border px-3", s.input)}>
            <Search className="size-4 shrink-0 text-violet-400" />
            <input
              className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none placeholder:text-slate-500"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.searchPlaceholder}
              dir="auto"
            />
          </label>
        </div>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16">
          <ImagePlus className={cn("size-12", s.emptyIcon)} />
          <p className={cn("text-sm font-semibold", s.muted)}>{records.length === 0 ? t.noRecords : t.noFiltered}</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((record) => (
            <ProductCard
              key={record.id}
              record={record}
              onOpen={() => setSelectedId(record.id)}
              onReplace={replaceRecord}
            />
          ))}
        </div>
      )}

      {selected && (
        <ProductDetail
          record={selected}
          onClose={() => setSelectedId(null)}
          onReplace={replaceRecord}
          onDelete={removeRecord}
        />
      )}
    </div>
  );
}
