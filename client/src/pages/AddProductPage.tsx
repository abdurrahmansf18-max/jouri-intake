import { useEffect, useRef, useState } from "react";
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
  X,
} from "lucide-react";
import { createProduct, fetchProducts, updateRelatedProducts, parseProductText } from "../api";
import { useApp } from "../context";
import { COPY, cn } from "../i18n";
import { DARK, LIGHT, type ThemeStyles } from "../theme";
import type { ProductRecord } from "../types";
import SizeStockEditor, { type SizeStockRow } from "../components/SizeStockEditor";
import BulkProductForm from "../components/BulkProductForm";
import VariantSelector from "../components/VariantSelector";

type Draft = {
  titleRaw: string;
  categorySuggestion: string;
  productTypeSuggestion: string;
  priceAmount: string;
  colorRaw: string;
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
  const [allProducts, setAllProducts] = useState<ProductRecord[]>([]);
  const [selectedVariantIds, setSelectedVariantIds] = useState<string[]>([]);

  // AI Parsing State
  const [aiText, setAiText] = useState("");
  const [isParsing, setIsParsing] = useState(false);

  useEffect(() => {
    fetchProducts().then(setAllProducts).catch(() => {});
  }, []);

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
    if (err) { setFieldError(err); return; }
    setFieldError(null);
    setSubmitting(true);
    try {
      const validSizes = sizeRows
        .filter((r) => r.size.trim())
        .map((r) => ({ size: r.size.trim(), qty: Math.max(0, parseInt(r.qty, 10) || 0) }));

      const newProduct = await createProduct(description, files, {
        notes: draft.notes,
        sizeStocks: validSizes,
        parsed: {
          titleRaw: draft.titleRaw,
          categorySuggestion: draft.categorySuggestion,
          productTypeSuggestion: draft.productTypeSuggestion,
          priceAmount: draft.priceAmount,
          currency: "EUR",
          colorRaw: draft.colorRaw,
        },
      });

      if (selectedVariantIds.length > 0) {
        await updateRelatedProducts(newProduct.id, selectedVariantIds);
      }

      showToast(t.toastCreated, "success");
      setDescription("");
      setDraft(emptyDraft());
      setFiles([]);
      setSizeRows([{ size: "", qty: "1" }]);
      setSelectedVariantIds([]);
      setPreviews((curr) => { curr.forEach((p) => URL.revokeObjectURL(p.url)); return []; });
      formRef.current?.reset();
      navigate("/products");
    } catch (err: unknown) {
      const code = err instanceof Error ? err.message : "ERR_GENERAL";
      const msg = t.errors[code] ?? t.errors.ERR_GENERAL;
      showToast(msg, "error");
    } finally {
      setSubmitting(false);
    }
  }

  // Bulk Mode state from AI
  const [bulkCards, setBulkCards] = useState<any[] | undefined>(undefined);

  async function handleAIParsing() {
    if (!aiText.trim()) return;
    setIsParsing(true);
    try {
      const result = await parseProductText(aiText);
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
         if (parsed.categorySuggestion) patch("categorySuggestion", parsed.categorySuggestion);
         if (parsed.productTypeSuggestion) patch("productTypeSuggestion", parsed.productTypeSuggestion);
         
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
        <textarea
          className={cn("min-h-24 w-full resize-y rounded-xl border px-4 py-3 text-sm leading-6 outline-none transition focus:ring-4", s.input)}
          value={aiText}
          onChange={(e) => setAiText(e.target.value)}
          placeholder={t.aiPlaceholder}
          dir="auto"
        />
        <button
          type="button"
          onClick={handleAIParsing}
          disabled={isParsing || !aiText.trim()}
          className={cn("mt-3 inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-extrabold transition disabled:opacity-70", s.primary)}
        >
          {isParsing ? <Loader2 className="size-4 animate-spin" /> : <Layers className="size-4" />}
          {isParsing ? t.aiAnalyzing : t.aiAnalyzeBtn}
        </button>
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
              <Field label={`${t.price} *`}           s={s} value={draft.priceAmount}           onChange={(v) => patch("priceAmount", v)} />
              <Field label={`${t.color} *`}           s={s} value={draft.colorRaw}              onChange={(v) => patch("colorRaw", v)} />
              <Field label={t.category}               s={s} value={draft.categorySuggestion}    onChange={(v) => patch("categorySuggestion", v)} />
              <Field label={t.productType}            s={s} value={draft.productTypeSuggestion} onChange={(v) => patch("productTypeSuggestion", v)} />
            </div>

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
    .map((item) => item.trim().replace(/\s+/g, ""))
    .filter(Boolean)
    .forEach((item) => {
      const normalized = suffix && /^\d+(?:[.,]\d+)?$/.test(item) ? `${item}${suffix}` : item.toUpperCase();
      if (!sizes.includes(normalized)) sizes.push(normalized);
    });
  return sizes;
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
  label, onChange, s, type = "text", value,
}: {
  label: string; onChange: (v: string) => void;
  s: ThemeStyles; type?: "number" | "text"; value: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className={cn("text-xs font-black", s.strong)}>{label}</span>
      <input
        className={cn("min-h-11 w-full rounded-xl border px-3 text-sm font-semibold outline-none focus:ring-4", s.input)}
        type={type}
        min={type === "number" ? 0 : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        dir="auto"
      />
    </label>
  );
}
