import { useEffect, useRef, useState } from "react";
import { Palette, Search, X } from "lucide-react";
import type { ProductRecord } from "../types";
import type { ThemeStyles } from "../theme";
import { cn, normalizeText, searchTokens } from "../i18n";
import { productImageUrl } from "../api";

interface Props {
  allProducts: ProductRecord[];
  selectedIds: string[];
  currentProductId?: string;
  onChange: (ids: string[]) => void;
  s: ThemeStyles;
  label: string;
  searchPlaceholder: string;
  emptyText: string;
}

export default function VariantSelector({
  allProducts,
  selectedIds,
  currentProductId,
  onChange,
  s,
  label,
  searchPlaceholder,
  emptyText,
}: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const available = allProducts.filter(
    (p) => p.id !== currentProductId && !selectedIds.includes(p.id),
  );

  const filtered = query.trim()
    ? (() => {
        const tokens = searchTokens(query);
        return available.filter((p) => {
          const hay = normalizeText(
            [p.parsed.titleRaw, p.parsed.colorRaw, p.parsed.categorySuggestion].join(" "),
          );
          return tokens.every((tok) => hay.includes(tok));
        });
      })()
    : available;

  const selectedProducts = selectedIds
    .map((id) => allProducts.find((p) => p.id === id))
    .filter((p): p is ProductRecord => !!p);

  function add(product: ProductRecord) {
    onChange([...selectedIds, product.id]);
    setQuery("");
    setOpen(false);
  }

  function remove(id: string) {
    onChange(selectedIds.filter((sid) => sid !== id));
  }

  return (
    <div className="grid gap-1.5">
      <span className={cn("flex items-center gap-2 text-xs font-black", s.strong)}>
        <Palette className="size-3.5 text-fuchsia-400" />
        {label}
      </span>

      {selectedProducts.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedProducts.map((p) => {
            const img = p.images[0];
            return (
              <div
                key={p.id}
                className={cn(
                  "flex items-center gap-1.5 rounded-xl border px-2 py-1",
                  s.subPanel,
                )}
              >
                {img && (
                  <img
                    src={productImageUrl(p.id, img.fileName)}
                    alt=""
                    className="size-6 rounded-md object-cover"
                  />
                )}
                <span className={cn("max-w-[8rem] truncate text-xs font-semibold", s.title)} dir="auto">
                  {p.parsed.colorRaw || p.parsed.titleRaw}
                </span>
                <button
                  type="button"
                  onClick={() => remove(p.id)}
                  className="text-red-400 hover:text-red-300 transition"
                >
                  <X className="size-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div ref={containerRef} className="relative">
        <div className={cn("flex items-center gap-2 rounded-xl border px-3", s.input)}>
          <Search className="size-4 shrink-0 text-fuchsia-400" />
          <input
            className="min-h-10 min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none placeholder:text-slate-500"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder={searchPlaceholder}
            dir="auto"
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(""); setOpen(false); }}
              className={cn("shrink-0", s.muted)}
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {open && (
          <div
            className={cn(
              "absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border shadow-2xl",
              s.panel,
            )}
          >
            {filtered.length === 0 ? (
              <p className={cn("px-3 py-3 text-sm font-semibold text-center", s.muted)}>
                {emptyText}
              </p>
            ) : (
              filtered.slice(0, 25).map((p) => {
                const img = p.images[0];
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => add(p)}
                    className={cn(
                      "flex w-full items-center gap-3 px-3 py-2 text-start transition hover:bg-white/5 active:bg-white/10",
                    )}
                  >
                    {img ? (
                      <img
                        src={productImageUrl(p.id, img.fileName)}
                        alt=""
                        className="size-10 shrink-0 rounded-lg object-cover"
                      />
                    ) : (
                      <div className={cn("size-10 shrink-0 rounded-lg", s.subPanel)} />
                    )}
                    <div className="min-w-0 flex-1">
                      <div
                        className={cn("truncate text-sm font-semibold", s.title)}
                        dir="auto"
                      >
                        {p.parsed.titleRaw}
                      </div>
                      {p.parsed.colorRaw && (
                        <div className={cn("flex items-center gap-1 text-xs", s.muted)} dir="auto">
                          <Palette className="size-3 text-fuchsia-400 shrink-0" />
                          {p.parsed.colorRaw}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
