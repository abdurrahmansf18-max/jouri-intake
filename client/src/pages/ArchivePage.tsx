import { useEffect, useMemo, useState } from "react";
import { ArchiveIcon, Loader2, Search } from "lucide-react";
import { fetchProducts } from "../api";
import { useApp } from "../context";
import { COPY, cn, normalizeText, searchTokens } from "../i18n";
import { DARK, LIGHT } from "../theme";
import type { ProductRecord } from "../types";
import ProductCard from "../components/ProductCard";
import ProductDetail from "../components/ProductDetail";
import { useProductSync } from "../hooks/useProductSync";

function isArchived(r: ProductRecord) {
  return r.status === "sold_archive" || r.soldSizes.length > 0;
}

export default function ArchivePage() {
  const { locale, theme } = useApp();
  const t = COPY[locale];
  const s = theme === "dark" ? DARK : LIGHT;

  const [records, setRecords] = useState<ProductRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailMode, setDetailMode] = useState<"view" | "edit">("view");

  useEffect(() => {
    fetchProducts()
      .then((all) => setRecords(all.filter(isArchived)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useProductSync({
    onProductUpdated: (updated) => {
      if (isArchived(updated)) {
        setRecords((prev) => {
          const exists = prev.find((r) => r.id === updated.id);
          return exists ? prev.map((r) => r.id === updated.id ? updated : r) : [updated, ...prev];
        });
      } else {
        setRecords((prev) => prev.filter((r) => r.id !== updated.id));
      }
    },
    onProductDeleted: (id) => {
      setRecords((prev) => prev.filter((r) => r.id !== id));
      setSelectedId((cur) => cur === id ? null : cur);
    },
  });

  const filtered = useMemo(() => {
    const tokens = searchTokens(search);
    if (!tokens.length) return records;
    return records.filter((r) => {
      const p = r.parsed;
      const soldSizeNames = r.soldSizes.map((ss) => ss.size).join(" ");
      const hay = normalizeText([p.titleRaw, p.colorRaw, p.sizesRaw, p.priceAmount, r.notes, r.description, soldSizeNames].join(" "));
      return tokens.every((tok) => hay.includes(tok));
    });
  }, [records, search]);

  function replaceRecord(updated: ProductRecord) {
    if (!isArchived(updated)) {
      setRecords((prev) => prev.filter((r) => r.id !== updated.id));
      setSelectedId(null);
    } else {
      setRecords((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    }
  }

  function removeRecord(id: string) {
    setRecords((prev) => prev.filter((r) => r.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  const selected = records.find((r) => r.id === selectedId) ?? null;

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="size-8 animate-spin text-violet-400" /></div>;
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-col gap-1">
        <h1 className={cn("text-2xl font-black tracking-tight", s.title)}>{t.archiveTitle}</h1>
        <p className={cn("text-sm font-medium", s.muted)}>
          {t.archiveCount(records.length)}
        </p>
      </div>

      <label className={cn("flex min-h-11 items-center gap-2 rounded-xl border px-3", s.input)}>
        <Search className="size-4 shrink-0 text-violet-400" />
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((record) => (
            <ProductCard
              key={record.id}
              record={record}
              onOpen={() => { setSelectedId(record.id); setDetailMode("view"); }}
              onEdit={() => { setSelectedId(record.id); setDetailMode("edit"); }}
              onReplace={replaceRecord}
              showRestoreBtn={record.status === "sold_archive"}
              showSoldSizes
              searchQuery={search}
            />
          ))}
        </div>
      )}

      {selected && (
        <ProductDetail
          record={selected}
          initialMode={detailMode}
          onClose={() => setSelectedId(null)}
          onReplace={replaceRecord}
          onDelete={removeRecord}
        />
      )}
    </div>
  );
}
