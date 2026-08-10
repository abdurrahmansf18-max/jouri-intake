import { Plus, X } from "lucide-react";
import { cn } from "../i18n";
import type { ThemeStyles } from "../theme";
import BarcodeScanButton from "./BarcodeScanButton";

export type SizeStockRow = { size: string; qty: string; barcode?: string };

interface Props {
  value: SizeStockRow[];
  onChange: (rows: SizeStockRow[]) => void;
  s: ThemeStyles;
  sizeNamePlaceholder: string;
  sizeQtyPlaceholder: string;
  addRowLabel: string;
  barcodePlaceholder?: string;
  barcodeScanTitle?: string;
}

export default function SizeStockEditor({
  value, onChange, s, sizeNamePlaceholder, sizeQtyPlaceholder, addRowLabel, barcodePlaceholder, barcodeScanTitle,
}: Props) {
  function updateRow(i: number, key: keyof SizeStockRow, val: string) {
    onChange(value.map((r, j) => j === i ? { ...r, [key]: val } : r));
  }

  function removeRow(i: number) {
    onChange(value.filter((_, j) => j !== i));
  }

  function addRow() {
    onChange([...value, { size: "", qty: "1", barcode: "" }]);
  }

  return (
    <div className="grid gap-2">
      {value.map((row, i) => (
        /* Mobil: dikey (beden üstte tam genişlik, adet+sil altta yan yana) */
        <div key={i} className="grid gap-1.5">
          <input
            type="text"
            value={row.size}
            onChange={(e) => updateRow(i, "size", e.target.value)}
            placeholder={sizeNamePlaceholder}
            className={cn(
              "min-h-11 w-full rounded-xl border px-3 text-sm font-semibold outline-none focus:ring-4",
              s.input,
            )}
          />
          <div className="flex gap-2">
            <input
              type="number"
              min={0}
              value={row.qty}
              onChange={(e) => updateRow(i, "qty", e.target.value)}
              placeholder={sizeQtyPlaceholder}
              className={cn(
                "min-h-11 flex-1 rounded-xl border px-3 text-sm font-semibold outline-none focus:ring-4 text-center",
                s.input,
              )}
            />
            <button
              type="button"
              onClick={() => removeRow(i)}
              className={cn(
                "flex size-11 shrink-0 items-center justify-center rounded-xl border transition active:scale-95",
                s.controlGroup, s.controlIdle,
              )}
            >
              <X className="size-4" />
            </button>
          </div>
          {barcodePlaceholder && (
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                value={row.barcode || ""}
                onChange={(e) => updateRow(i, "barcode", e.target.value)}
                placeholder={barcodePlaceholder}
                className={cn(
                  "min-h-10 min-w-0 flex-1 rounded-xl border px-3 font-mono text-xs font-semibold outline-none focus:ring-4",
                  s.input,
                )}
                dir="ltr"
              />
              {barcodeScanTitle && (
                <BarcodeScanButton
                  s={s}
                  title={barcodeScanTitle}
                  onDetected={(code) => updateRow(i, "barcode", code)}
                  className="size-10 rounded-xl"
                />
              )}
            </div>
          )}
        </div>
      ))}

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
