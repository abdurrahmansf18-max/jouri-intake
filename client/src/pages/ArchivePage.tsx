import { useEffect, useMemo, useState } from "react";
import { ArchiveIcon, Loader2, Search } from "lucide-react";
import { useApp } from "../context";
import { COPY, cn } from "../i18n";
import { DARK, LIGHT } from "../theme";
import type { ProductRecord } from "../types";
import { searchProducts } from "../search";
import ProductCard from "../components/ProductCard";
import ProductDetail from "../components/ProductDetail";
import Pagination from "../components/Pagination";
import { useProductCacheActions, useProductsQuery } from "../queries";

const PAGE_SIZE = 30;

function isArchived(r: ProductRecord) {
  return r.status === "sold_archive" || r.soldSizes.length > 0;
}

export default function ArchivePage() {
  const { locale, theme } = useApp();
  const t = COPY[locale];
  const s = theme === "dark" ? DARK : LIGHT;

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailMode, setDetailMode] = useState<"view" | "edit">("view");
  const [page, setPage] = useState(1);
  const productsQuery = useProductsQuery();
  const cacheActions = useProductCacheActions();

  const allProducts: ProductRecord[] = productsQuery.data ?? [];
  const records = useMemo<ProductRecord[]>(() => allProducts.filter(isArchived), [allProducts]);
  const fullSoldCount = useMemo(() => records.filter((record: ProductRecord) => record.status === "sold_archive").length, [records]);
  const partialSoldCount = records.length - fullSoldCount;
  const loading = productsQuery.isLoading;

  // Arama değişince sayfa 1'e dön
  useEffect(() => { setPage(1); }, [search]);

  const searchResults = useMemo(() => searchProducts(records, search, true), [records, search]);
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
    if (!isArchived(updated)) {
      setSelectedId(null);
    }
  }

  function removeRecord(id: string) {
    cacheActions.removeProduct(id);
    if (selectedId === id) setSelectedId(null);
  }

  const selected = records.find((r: ProductRecord) => r.id === selectedId) ?? null;

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="size-8 animate-spin text-emerald-400" /></div>;
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-col gap-1">
        <h1 className={cn("text-2xl font-black tracking-tight", s.title)}>{t.archiveTitle}</h1>
        <p className={cn("text-sm font-medium", s.muted)}>
          {t.archiveCount(records.length)}
        </p>
        {records.length > 0 && (
          <p className={cn("text-xs font-semibold", s.muted)}>
            {t.archiveSummary(fullSoldCount, partialSoldCount)}
          </p>
        )}
      </div>

      <label className={cn("flex min-h-11 items-center gap-2 rounded-xl border px-3", s.input)}>
        <Search className="size-4 shrink-0 text-emerald-400" />
        <input className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none placeholder:text-slate-500"
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={t.searchPlaceholder} dir="auto" />
      </label>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16">
          <ArchiveIcon className={cn("size-12", s.emptyIcon)} />
          <p className={cn("text-sm font-semibold", s.muted)}>{records.length === 0 ? t.noRecords : t.noFiltered}</p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {paginated.map((record) => (
              <ProductCard
                key={record.id}
                record={record}
                onOpen={() => { setSelectedId(record.id); setDetailMode("view"); }}
                onEdit={() => { setSelectedId(record.id); setDetailMode("edit"); }}
                onReplace={replaceRecord}
                showRestoreBtn={record.status === "sold_archive"}
                showSoldSizes
                searchQuery={search}
                searchMatches={searchMatchesById.get(record.id) ?? []}
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
          showRestoreSizes
          allProducts={allProducts}
          navigationProducts={filtered}
          onNavigate={(product) => { setSelectedId(product.id); setDetailMode("view"); }}
        />
      )}
    </div>
  );
}
