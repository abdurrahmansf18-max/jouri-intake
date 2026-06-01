import { Plus, X } from "lucide-react";
import { cn } from "../i18n";
import type { ThemeStyles } from "../theme";

export type SizeStockRow = { size: string; qty: string };

interface Props {
  value: SizeStockRow[];
  onChange: (rows: SizeStockRow[]) => void;
  s: ThemeStyles;
  sizeLabel: string;
  sizeNamePlaceholder: string;
  sizeQtyPlaceholder: string;
  addRowLabel: string;
}

export default function SizeStockEditor({
  value, onChange, s, sizeLabel, sizeNamePlaceholder, sizeQtyPlaceholder, addRowLabel,
}: Props) {
  function updateRow(i: number, key: keyof SizeStockRow, val: string) {
    onChange(value.map((r, j) => j === i ? { ...r, [key]: val } : r));
  }

  function removeRow(i: number) {
    onChange(value.filter((_, j) => j !== i));
  }

  function addRow() {
    onChange([...value, { size: "", qty: "1" }]);
  }

  return (
    <div className="grid gap-2">
      {/* Başlık satırı */}
      {value.length > 0 && (
        <div className="flex gap-2 items-center px-1">
          <span className={cn("flex-1 text-xs font-black", s.strong)}>{sizeLabel}</span>
          <span className={cn("w-20 text-xs font-black", s.strong)}>{sizeQtyPlaceholder}</span>
          <span className="size-9 shrink-0" />
        </div>
      )}

      {/* Satırlar */}
      {value.map((row, i) => (
        <div key={i} className="flex gap-2 items-center">
          <input
            type="text"
            value={row.size}
            onChange={(e) => updateRow(i, "size", e.target.value)}
            placeholder={sizeNamePlaceholder}
            className={cn(
              "min-h-11 flex-1 rounded-xl border px-3 text-sm font-semibold outline-none focus:ring-4",
              s.input,
            )}
          />
          <input
            type="number"
            min={0}
            value={row.qty}
            onChange={(e) => updateRow(i, "qty", e.target.value)}
            className={cn(
              "min-h-11 w-20 rounded-xl border px-3 text-sm font-semibold outline-none focus:ring-4 text-center",
              s.input,
            )}
          />
          <button
            type="button"
            onClick={() => removeRow(i)}
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-xl border transition active:scale-95",
              s.controlGroup, s.controlIdle,
            )}
          >
            <X className="size-4" />
          </button>
        </div>
      ))}

      {/* Ekle butonu */}
      <button
        type="button"
        onClick={addRow}
        className={cn(
          "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border px-3",
          "text-sm font-extrabold transition active:scale-95",
          s.controlGroup, s.controlIdle,
        )}
      >
        <Plus className="size-4" /> {addRowLabel}
      </button>
    </div>
  );
}
