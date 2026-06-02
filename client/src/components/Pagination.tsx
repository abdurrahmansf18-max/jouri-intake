import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../i18n";
import { useApp } from "../context";
import type { ThemeStyles } from "../theme";

interface Props {
  page: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  onChange: (page: number) => void;
  s: ThemeStyles;
}

export default function Pagination({ page, totalPages, totalCount, pageSize, onChange, s }: Props) {
  const { locale } = useApp();
  const isRtl = locale === "ar";

  if (totalPages <= 1) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalCount);

  function pageNumbers(): (number | "…")[] {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const items: (number | "…")[] = [1];
    const lo = Math.max(2, page - 1);
    const hi = Math.min(totalPages - 1, page + 1);
    if (lo > 2) items.push("…");
    for (let i = lo; i <= hi; i++) items.push(i);
    if (hi < totalPages - 1) items.push("…");
    items.push(totalPages);
    return items;
  }

  const PrevIcon = isRtl ? ChevronRight : ChevronLeft;
  const NextIcon = isRtl ? ChevronLeft : ChevronRight;

  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
      <p className={cn("text-xs font-semibold tabular-nums", s.muted)}>
        {start}–{end} / {totalCount}
      </p>

      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page === 1}
          onClick={() => onChange(page - 1)}
          className={cn(
            "inline-flex size-9 items-center justify-center rounded-xl border transition active:scale-95 disabled:opacity-40",
            s.controlGroup, s.controlIdle,
          )}
        >
          <PrevIcon className="size-4" />
        </button>

        {/* Masaüstü: sayfa numaraları */}
        <div className="hidden sm:flex items-center gap-1">
          {pageNumbers().map((p, i) =>
            p === "…" ? (
              <span key={`e${i}`} className={cn("flex size-9 items-center justify-center text-xs", s.muted)}>
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => onChange(p as number)}
                className={cn(
                  "inline-flex size-9 items-center justify-center rounded-xl border text-xs font-extrabold transition active:scale-95",
                  page === p ? s.controlActive : cn(s.controlGroup, s.controlIdle),
                )}
              >
                {p}
              </button>
            ),
          )}
        </div>

        {/* Mobil: sadece mevcut / toplam */}
        <span className={cn(
          "flex sm:hidden min-w-[3.5rem] items-center justify-center px-1 text-xs font-extrabold",
          s.title,
        )}>
          {page} / {totalPages}
        </span>

        <button
          type="button"
          disabled={page === totalPages}
          onClick={() => onChange(page + 1)}
          className={cn(
            "inline-flex size-9 items-center justify-center rounded-xl border transition active:scale-95 disabled:opacity-40",
            s.controlGroup, s.controlIdle,
          )}
        >
          <NextIcon className="size-4" />
        </button>
      </div>
    </div>
  );
}
