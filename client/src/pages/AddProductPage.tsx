import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ClipboardList,
  Edit3,
  Layers,
  Loader2,
  Package,
  Ruler,
  Save,
  UploadCloud,
  ImagePlus,
  X,
} from "lucide-react";
import { createProduct, updateRelatedProducts, parseProductText } from "../api";
import { useApp } from "../context";
import { COPY, cn, normalizeCategory, normalizeProductType } from "../i18n";
import { DARK, LIGHT, type ThemeStyles } from "../theme";
import SizeStockEditor, { type SizeStockRow } from "../components/SizeStockEditor";
import BulkProductForm from "../components/BulkProductForm";
import VariantSelector from "../components/VariantSelector";
import { useProductCacheActions, useProductsQuery } from "../queries";

type Draft = {
  titleRaw: string;
  categorySuggestion: string;
  productTypeSuggestion: string;
  priceAmount: string;
  colorRaw: string;
  season: string;
  notes: string;
};

type AiVariant = {
  color?: string;
  sizes?: string | string[];
};

function emptyDraft(): Draft {
  return {
    titleRaw: "",
    categorySuggestion: "",
    productTypeSuggestion: "",
    priceAmount: "",
    colorRaw: "",
    season: "",
    notes: "",
  };
}

export default function AddProductPage() {
  const { locale, theme, showToast } = useApp();
  const t = COPY[locale];
  const s = theme === "dark" ? DARK : LIGHT;
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement>(null);

  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<{ name: string; url: string }[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [sizeRows, setSizeRows] = useState<SizeStockRow[]>([{ size: "", qty: "1" }]);
  const [addMode, setAddMode] = useState<"single" | "bulk">("single");
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [selectedVariantIds, setSelectedVariantIds] = useState<string[]>([]);
  const productsQuery = useProductsQuery();
  const cacheActions = useProductCacheActions();

  // AI Parsing State
  const [aiText, setAiText] = useState("");
  const [aiImage, setAiImage] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState(false);

  const allProducts = productsQuery.data ?? [];

  const existingCategories = Array.from(new Set(
    allProducts
      .map((p) => normalizeCategory(p.parsed.categorySuggestion || ""))
      .filter(Boolean),
  )).sort((a, b) => a.localeCompare(b));
  const existingProductTypes = Array.from(new Set(
    allProducts
      .map((p) => normalizeProductType(p.parsed.productTypeSuggestion || ""))
      .filter(Boolean),
  )).sort((a, b) => a.localeCompare(b));

  function patch(key: keyof Draft, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function validate(): string | null {
    if (!files.length) return t.emptyImg;
    if (files.length > 5) return t.errMaxImages;
    if (!draft.titleRaw.trim()) return t.errTitleRequired;
    if (!draft.priceAmount.trim()) return t.errPriceRequired;
    if (!draft.colorRaw.trim()) return t.errColorRequired;
    const validSizes = sizeRows.filter((r) => r.size.trim() && parseInt(r.qty, 10) >= 1);
    if (!validSizes.length) return t.errSizeRequired;
    if (!description.trim()) return t.emptyDesc;
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) {
      setFieldError(err);
      return;
    }
    setFieldError(null);
    setSubmitting(true);
    try {
      await createProduct(description, files, {
        notes: draft.notes,
        sizeStocks: sizeRows.filter((r) => r.size.trim() && parseInt(r.qty, 10) >= 1).map((r) => ({ size: r.size.trim(), qty: parseInt(r.qty, 10) })),
        parsed: {
          titleRaw: draft.titleRaw,
          categorySuggestion: draft.categorySuggestion,
          productTypeSuggestion: draft.productTypeSuggestion,
          priceAmount: draft.priceAmount,
          colorRaw: draft.colorRaw,
          season: draft.season,
        },
      });
      showToast(t.toastCreated, "success");
      setDraft(emptyDraft());
      setDescription("");
      setSizeRows([{ size: "", qty: "1" }]);
      setFiles([]);
      setPreviews([]);
      setAiText("");
      setAiImage(null);
      cacheActions.invalidateProducts();
      navigate("/products");
    } catch (error) {
      showToast(t.errors.ERR_GENERAL, "error");
    } finally {
      setSubmitting(false);
    }
  }

  function splitAiSizes(sizesVal: string | string[] | undefined): string[] {
    if (!sizesVal) return [];
    if (Array.isArray(sizesVal)) return sizesVal;
    return sizesVal.split(",").map((s) => s.trim()).filter(Boolean);
  }

  // Bulk Mode state from AI
  const [bulkCards, setBulkCards] = useState<any[] | undefined>(undefined);

  async function handleAIParsing() {
    if (!aiText.trim() && !aiImage) return;
    setIsParsing(true);
    try {
      const result = await parseProductText(aiText, aiImage || undefined);
      const parsed = result.parsed;
      const providerNote = getProviderNote(result.provider, t);
      
      const variants: AiVariant[] = result.variants || [];
      if (variants.length > 1 || (addMode === "bulk" && variants.length > 0)) {
         // Create bulk cards
         const newCards = variants.map((v: AiVariant, idx: number) => {
             const sizes = splitAiSizes(v.sizes);
             return {
                 id: `ai-${Date.now()}-${idx}`,
                 titleRaw: parsed.titleRaw || "",
                 priceAmount: parsed.priceAmount || "",
                 colorRaw: v.color || "",
                 season: parsed.season || "",
                 categorySuggestion: parsed.categorySuggestion || "",
                 productTypeSuggestion: parsed.productTypeSuggestion || "",
                 description: result.description || "",
                 notes: "",
                 files: [],
                 previews: [],
                 sizeRows: sizes.length > 0 ? sizes.map((s: string) => ({ size: s, qty: "1" })) : [{ size: "", qty: "1" }]
             };
         });
         setBulkCards(newCards);
         setAddMode("bulk");
         showToast(`${t.aiBulkSwitched} ${providerNote}`, "success");
      } else {
         if (result.description) setDescription(result.description);
         if (parsed.titleRaw) patch("titleRaw", parsed.titleRaw);
         if (parsed.priceAmount) patch("priceAmount", parsed.priceAmount);
         if (parsed.colorRaw) patch("colorRaw", parsed.colorRaw);
         if (parsed.season) patch("season", parsed.season);
         if (parsed.categorySuggestion) patch("categorySuggestion", parsed.categorySuggestion);
         if (parsed.productTypeSuggestion) patch("productTypeSuggestion", parsed.productTypeSuggestion);
         if (aiImage && files.length === 0) handleFiles([aiImage]);
         
         if (parsed.sizesRaw) {
           const sizes = splitAiSizes(parsed.sizesRaw);
           if (sizes.length > 0) {
             setSizeRows(sizes.map((s: string) => ({ size: s, qty: "1" })));
           }
         }
         showToast(`${t.aiSuccess} ${providerNote}`, "success");
      }
    } catch (err) {
      showToast(t.aiFailed, "error");
    } finally {
      setIsParsing(false);
    }
  }

  function handleFiles(selected: File[]) {
    setFiles((prev) => {
      const combined = [...prev, ...selected].slice(0, 5);
      setPreviews((curr) => {
        curr.forEach((p) => URL.revokeObjectURL(p.url));
        return combined.map((f) => ({ name: f.name, url: URL.createObjectURL(f) }));
      });
      return combined;
    });
  }

  function removeFile(index: number) {
    setFiles((prev) => {
      const next = prev.filter((_, i) => i !== index);
      setPreviews((curr) => {
        URL.revokeObjectURL(curr[index]?.url ?? "");
        return curr.filter((_, i) => i !== index);
      });
      return next;
    });
  }

  return (
    <div className="grid gap-5">
      {/* AI ile Hızlı Ekleme (Her iki modda da çalışır) */}
      <section className={cn("rounded-xl border p-4", s.subPanel)}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className={cn("flex items-center gap-2 text-sm font-extrabold", s.title)}>
            {t.aiAutoFill}
          </h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
          <textarea
            className={cn("min-h-24 w-full resize-y rounded-xl border px-4 py-3 text-sm leading-6 outline-none transition focus:ring-4", s.input)}
            value={aiText}
            onChange={(e) => setAiText(e.target.value)}
            placeholder={t.aiPlaceholder}
            dir="auto"
          />
          <label className={cn("flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-3 text-center transition", aiImage ? "border-green-500 bg-green-500/10" : s.dropzone)}>
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  setAiImage(e.target.files[0]);
                }
              }}
            />
            {aiImage ? (
              <>
                <img src={URL.createObjectURL(aiImage)} alt={t.aiImagePreviewAlt} className="h-10 w-10 object-cover rounded-lg" />
                <span className="text-[10px] font-bold text-green-600 dark:text-green-400">{t.aiImageSelected}</span>
              </>
            ) : (
              <>
                <ImagePlus className={cn("size-6 opacity-50")} />
                <span className="text-xs font-semibold">{t.aiImageOptional}</span>
              </>
            )}
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleAIParsing}
            disabled={isParsing || (!aiText.trim() && !aiImage)}
            className={cn("mt-3 inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-extrabold transition disabled:opacity-70", s.primary)}
          >
            {isParsing ? <Loader2 className="size-4 animate-spin" /> : <Layers className="size-4" />}
            {isParsing ? t.aiAnalyzing : t.aiAnalyzeBtn}
          </button>
          {aiImage && (
            <button
              type="button"
              onClick={() => setAiImage(null)}
              className="mt-3 text-xs font-bold text-red-500 hover:underline"
            >
              {t.aiImageRemove}
            </button>
          )}
        </div>
      </section>

      {/* Mod seçici */}
      <div className={cn("grid grid-cols-2 gap-0 rounded-xl border overflow-hidden", s.controlGroup)}>
        <button
          type="button"
          onClick={() => setAddMode("single")}
          className={cn(
            "inline-flex min-h-11 items-center justify-center gap-2 px-3 text-sm font-extrabold transition",
            addMode === "single" ? s.controlActive : s.controlIdle,
          )}
        >
          <Package className="size-4" />
          {t.addModeSingle}
        </button>
        <button
          type="button"
          onClick={() => setAddMode("bulk")}
          className={cn(
            "inline-flex min-h-11 items-center justify-center gap-2 px-3 text-sm font-extrabold transition border-s",
            addMode === "bulk" ? s.controlActive : s.controlIdle,
            s.panelBorder,
          )}
        >
          <Layers className="size-4" />
          {t.addModeBulk}
        </button>
      </div>

      {/* Çoklu ekleme modu */}
      {addMode === "bulk" && <BulkProductForm initialCards={bulkCards} />}

      {/* Tekli ekleme modu */}
      {addMode === "single" && <form ref={formRef} onSubmit={handleSubmit} className={cn("rounded-xl border", s.panel)}>
        <div className={cn("flex items-center justify-between gap-3 border-b px-5 py-4", s.panelBorder)}>
          <div>
            <h1 className={cn("text-lg font-extrabold tracking-tight", s.title)}>{t.addProductTitle}</h1>
            <p className={cn("mt-1 text-sm font-medium", s.muted)}>{t.newRecordSubtitle}</p>
          </div>
        </div>

        <div className="grid gap-5 p-5">

          {/* Görsel yükleme */}
          <label className={cn("group relative grid min-h-44 cursor-pointer place-items-center rounded-xl border border-dashed px-4 py-6 text-center transition", s.dropzone)}>
            <input
              className="sr-only"
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => { handleFiles(Array.from(e.currentTarget.files ?? [])); e.currentTarget.value = ""; }}
            />
            <span className={cn("mb-3 flex size-12 items-center justify-center rounded-xl shadow-sm ring-1", s.dropIcon)}>
              <UploadCloud className="size-6" />
            </span>
            <span className={cn("text-base font-extrabold", s.title)}>{t.productImages}</span>
            <span className={cn("mt-1 text-sm", s.muted)}>{t.chooseGallery}</span>
            <span className={cn("mt-1 text-xs font-semibold", s.muted)}>
              {t.maxImages}
            </span>
            {files.length > 0 && (
              <span className={cn("mt-1 text-xs font-black", files.length > 5 ? "text-red-400" : "text-violet-400")}>
                {t.imageCount(files.length)}
              </span>
            )}
          </label>

          {previews.length > 0 && (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
              {previews.map((p, i) => (
                <figure key={p.name} className={cn("relative overflow-hidden rounded-xl border", s.subPanel)}>
                  <img src={p.url} alt={p.name} className="aspect-square w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-black/60 text-red-400 hover:bg-red-500/80 hover:text-white transition active:scale-95"
                  >
                    <X className="size-3.5" />
                  </button>
                </figure>
              ))}
            </div>
          )}

          {/* Açıklama */}
          <label className="grid gap-2">
            <span className={cn("flex items-center gap-2 text-sm font-bold", s.label)}>
              <ClipboardList className="size-4 text-violet-400" />
              {t.description}
            </span>
            <textarea
              className={cn("min-h-40 w-full resize-y rounded-xl border px-4 py-3 text-base leading-7 outline-none transition focus:ring-4", s.input)}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t.sampleDesc}
              dir="auto"
            />
            <span className={cn("text-xs", s.muted)}>{t.descriptionHelp(description.length)}</span>
          </label>

          {/* Zorunlu alanlar */}
          <section className={cn("rounded-xl border p-4", s.subPanel)}>
            <h3 className={cn("mb-3 flex items-center gap-2 text-sm font-extrabold", s.title)}>
              <Edit3 className="size-4 text-violet-400" />
              {t.createDetailsTitle}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={`${t.rawTitle} *`}       s={s} value={draft.titleRaw}              onChange={(v) => patch("titleRaw", v)} />
              <Field label={`${t.price} *`}           s={s} value={draft.priceAmount}           onChange={(v) => patch("priceAmount", v)} prefix="€" inputDir="ltr" />
              <Field label={`${t.color} *`}           s={s} value={draft.colorRaw}              onChange={(v) => patch("colorRaw", v)} />
              <Field label={t.category}               s={s} value={draft.categorySuggestion}    onChange={(v) => patch("categorySuggestion", v)} listId="category-options" />
              <Field label={t.productType}            s={s} value={draft.productTypeSuggestion} onChange={(v) => patch("productTypeSuggestion", v)} listId="product-type-options" />
              <SeasonField label={t.season} s={s} value={draft.season} onChange={(v) => patch("season", v)} />
            </div>
            {existingCategories.length > 0 && (
              <datalist id="category-options">
                {existingCategories.map((category) => (
                  <option key={category} value={category} />
                ))}
              </datalist>
            )}
            {existingProductTypes.length > 0 && (
              <datalist id="product-type-options">
                {existingProductTypes.map((productType) => (
                  <option key={productType} value={productType} />
                ))}
              </datalist>
            )}

            {/* Beden + stok editörü */}
            <div className="mt-3 grid gap-1.5">
              <span className={cn("flex items-center gap-2 text-xs font-black", s.strong)}>
                <Ruler className="size-3.5 text-sky-400" />
                {t.sizeStocksLabel} *
              </span>
              <SizeStockEditor
                value={sizeRows}
                onChange={setSizeRows}
                s={s}
                sizeNamePlaceholder={t.sizeNamePlaceholder}
                sizeQtyPlaceholder={t.sizeQtyPlaceholder}
                addRowLabel={t.addSizeRow}
              />
            </div>

            <label className="mt-3 grid gap-1.5">
              <span className={cn("text-xs font-black", s.strong)}>{t.notes}</span>
              <textarea
                className={cn("min-h-20 w-full rounded-xl border px-3 py-3 text-sm leading-6 outline-none focus:ring-4", s.input)}
                value={draft.notes}
                onChange={(e) => patch("notes", e.target.value)}
                placeholder={t.notesPlaceholder}
                dir="auto"
              />
            </label>
          </section>

          {/* Renk varyantları */}
          {allProducts.length > 0 && (
            <section className={cn("rounded-xl border p-4", s.subPanel)}>
              <VariantSelector
                allProducts={allProducts}
                selectedIds={selectedVariantIds}
                onChange={setSelectedVariantIds}
                s={s}
                label={t.colorVariantsLabel}
                searchPlaceholder={t.colorVariantsSearch}
                emptyText={t.colorVariantsEmpty}
              />
            </section>
          )}

          {fieldError && (
            <div className={cn("rounded-xl border px-4 py-3 text-sm font-semibold", s.error)}>
              {fieldError}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className={cn("inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-xl px-5 text-base font-extrabold transition disabled:opacity-70", s.primary)}
          >
            {submitting ? <Loader2 className="size-5 animate-spin" /> : <Save className="size-5" />}
            {submitting ? t.saving : t.saveProduct}
          </button>
        </div>
      </form>}
    </div>
  );
}

function splitAiSizes(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value.join(",") : (value || "");
  const suffix = raw.match(/\b([A-Za-z]+)\b\s*$/)?.[1]?.toUpperCase() || "";
  const sizes: string[] = [];
  raw
    .replace(/،/g, ",")
    .split(/[,/]+/)
    .map((item) => item.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .forEach((item) => {
      const normalized = normalizeAiSizeToken(item, suffix);
      if (!sizes.includes(normalized)) sizes.push(normalized);
    });
  return sizes;
}

function normalizeAiSizeToken(item: string, inheritedSuffix: string): string {
  const compact = item.replace(/\s+/g, "");
  const ageRange = item.match(/^(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)\s*(years?|months?)$/i);
  if (ageRange) {
    return formatAgeRange(ageRange[1], ageRange[2], ageRange[3]);
  }
  const compactAgeRange = compact.match(/^(\d+(?:[.,]\d+)?)-(\d+(?:[.,]\d+)?)(YEARS?|MONTHS?)$/i);
  if (compactAgeRange) {
    return formatAgeRange(compactAgeRange[1], compactAgeRange[2], compactAgeRange[3]);
  }
  const compactAge = compact.match(/^(\d+(?:[.,]\d+)?)(YEARS?|MONTHS?)$/i);
  if (compactAge) {
    return formatAgeSize(compactAge[1], compactAge[2].toUpperCase().startsWith("YEAR") ? "Y" : "M");
  }
  const ownRangeSuffix = compact.match(/^(\d+(?:[.,]\d+)?)-(\d+(?:[.,]\d+)?)([YM])$/i);
  if (ownRangeSuffix) {
    return formatAgeRange(ownRangeSuffix[1], ownRangeSuffix[2], ownRangeSuffix[3]);
  }
  if ((inheritedSuffix === "Y" || inheritedSuffix === "M") && /^\d+(?:[.,]\d+)?$/.test(compact)) {
    return formatAgeSize(item, inheritedSuffix);
  }
  const inheritedRange = compact.match(/^(\d+(?:[.,]\d+)?)-(\d+(?:[.,]\d+)?)$/);
  if ((inheritedSuffix === "Y" || inheritedSuffix === "M") && inheritedRange) {
    return formatAgeRange(inheritedRange[1], inheritedRange[2], inheritedSuffix);
  }
  const ownSuffix = compact.match(/^(\d+(?:[.,]\d+)?)([YM])$/i);
  if (ownSuffix) {
    return formatAgeSize(ownSuffix[1], ownSuffix[2].toUpperCase());
  }
  return item.toUpperCase();
}

function formatAgeSize(value: string, suffix: string): string {
  const number = value.replace(",", ".");
  const displayNumber = number.endsWith(".0") ? number.slice(0, -2) : number;
  const singular = number === "1" || number === "1.0";
  const unit = suffix === "Y"
    ? (singular ? "Year" : "Years")
    : (singular ? "Month" : "Months");
  return `${displayNumber} ${unit}`;
}

function formatAgeRange(start: string, end: string, unitSource: string): string {
  let startNumber = Number(start.replace(",", "."));
  let endNumber = Number(end.replace(",", "."));
  if (Number.isFinite(startNumber) && Number.isFinite(endNumber) && startNumber > endNumber) {
    [startNumber, endNumber] = [endNumber, startNumber];
  }
  const displayStart = Number.isFinite(startNumber) ? formatAgeNumber(String(startNumber)) : formatAgeNumber(start);
  const displayEnd = Number.isFinite(endNumber) ? formatAgeNumber(String(endNumber)) : formatAgeNumber(end);
  const source = unitSource.toUpperCase();
  const unit = source.startsWith("Y") ? "Years" : "Months";
  return `${displayStart}-${displayEnd} ${unit}`;
}

function formatAgeNumber(value: string): string {
  const number = value.replace(",", ".");
  return number.endsWith(".0") ? number.slice(0, -2) : number;
}

function getProviderNote(
  provider: "gemini" | "gemma" | "parser" | undefined,
  t: typeof COPY["tr"] | typeof COPY["ar"],
): string {
  const label =
    provider === "gemini" ? t.aiProviderGemini :
    provider === "gemma" ? t.aiProviderGemma :
    t.aiProviderParser;
  return t.aiProviderUsed(label);
}

function Field({
  label, inputDir = "auto", listId, onChange, prefix, s, type = "text", value,
}: {
  label: string; onChange: (v: string) => void;
  s: ThemeStyles; type?: "number" | "text"; value: string; inputDir?: "auto" | "ltr" | "rtl"; listId?: string; prefix?: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className={cn("text-xs font-black", s.strong)}>{label}</span>
      <span className="relative block">
        {prefix ? (
          <span className={cn("pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-black", s.muted)}>
            {prefix}
          </span>
        ) : null}
        <input
          className={cn("min-h-11 w-full rounded-xl border px-3 text-sm font-semibold outline-none focus:ring-4", prefix && "pl-9", s.input)}
          type={type}
          list={listId}
          min={type === "number" ? 0 : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          dir={inputDir}
        />
      </span>
    </label>
  );
}

function SeasonField({
  label, onChange, s, value,
}: {
  label: string; onChange: (v: string) => void; s: ThemeStyles; value: string;
}) {
  const seasons = ["Summer", "Winter", "Mid-season"];
  return (
    <label className="grid gap-1.5">
      <span className={cn("text-xs font-black", s.strong)}>{label}</span>
      <select
        className={cn("min-h-11 w-full rounded-xl border px-3 text-sm font-semibold outline-none focus:ring-4", s.input)}
        value={seasons.includes(value) ? value : ""}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">-</option>
        {seasons.map((season) => (
          <option key={season} value={season}>{season}</option>
        ))}
      </select>
    </label>
  );
}
