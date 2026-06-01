import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ClipboardList,
  Edit3,
  Loader2,
  Save,
  UploadCloud,
} from "lucide-react";
import { createProduct } from "../api";
import { useApp } from "../context";
import { COPY, cn } from "../i18n";
import { DARK, LIGHT, type ThemeStyles } from "../theme";

type Draft = {
  titleRaw: string;
  germanTitleSuggestion: string;
  categorySuggestion: string;
  productTypeSuggestion: string;
  priceAmount: string;
  currency: string;
  colorRaw: string;
  colorGermanSuggestion: string;
  sizesRaw: string;
  stockQuantity: string;
  notes: string;
};

function emptyDraft(): Draft {
  return {
    titleRaw: "",
    germanTitleSuggestion: "",
    categorySuggestion: "",
    productTypeSuggestion: "",
    priceAmount: "",
    currency: "",
    colorRaw: "",
    colorGermanSuggestion: "",
    sizesRaw: "",
    stockQuantity: "",
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
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  function patch(key: keyof Draft, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function validate(): string | null {
    if (!files.length) return t.emptyImg;
    if (!draft.titleRaw.trim()) return t.errTitleRequired;
    if (!draft.priceAmount.trim()) return t.errPriceRequired;
    if (!draft.colorRaw.trim()) return t.errColorRequired;
    if (!draft.sizesRaw.trim()) return t.errSizeRequired;
    const stock = parseInt(draft.stockQuantity, 10);
    if (!Number.isFinite(stock) || stock < 1) return t.errStockRequired;
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
      await createProduct(description, files, {
        notes: draft.notes,
        stockQuantity: parseInt(draft.stockQuantity, 10),
        parsed: {
          titleRaw: draft.titleRaw,
          germanTitleSuggestion: draft.germanTitleSuggestion,
          categorySuggestion: draft.categorySuggestion,
          productTypeSuggestion: draft.productTypeSuggestion,
          priceAmount: draft.priceAmount,
          currency: draft.currency,
          colorRaw: draft.colorRaw,
          colorGermanSuggestion: draft.colorGermanSuggestion,
          sizesRaw: draft.sizesRaw,
        },
      });
      showToast(t.toastCreated, "success");
      setDescription("");
      setDraft(emptyDraft());
      setFiles([]);
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

  function handleFiles(selected: File[]) {
    setFiles(selected);
    setPreviews((curr) => {
      curr.forEach((p) => URL.revokeObjectURL(p.url));
      return selected.map((f) => ({ name: f.name, url: URL.createObjectURL(f) }));
    });
  }

  return (
    <div className="grid gap-5">
      <form ref={formRef} onSubmit={handleSubmit} className={cn("rounded-xl border", s.panel)}>
        <div className={cn("flex items-center justify-between gap-3 border-b px-5 py-4", s.panelBorder)}>
          <div>
            <h1 className={cn("text-lg font-extrabold tracking-tight", s.title)}>{t.addProductTitle}</h1>
            <p className={cn("mt-1 text-sm font-medium", s.muted)}>{t.newRecordSubtitle}</p>
          </div>
        </div>

        <div className="grid gap-5 p-5">
          {/* Image upload */}
          <label className={cn("group relative grid min-h-44 cursor-pointer place-items-center rounded-xl border border-dashed px-4 py-6 text-center transition", s.dropzone)}>
            <input
              className="sr-only"
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => handleFiles(Array.from(e.currentTarget.files ?? []))}
            />
            <span className={cn("mb-3 flex size-12 items-center justify-center rounded-xl shadow-sm ring-1", s.dropIcon)}>
              <UploadCloud className="size-6" />
            </span>
            <span className={cn("text-base font-extrabold", s.title)}>{t.productImages}</span>
            <span className={cn("mt-1 text-sm", s.muted)}>{t.chooseGallery}</span>
            {files.length > 0 && (
              <span className={cn("mt-2 text-xs font-black", "text-violet-400")}>
                {t.imageCount(files.length)}
              </span>
            )}
          </label>

          {previews.length > 0 && (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
              {previews.map((p) => (
                <figure key={p.name} className={cn("overflow-hidden rounded-xl border", s.subPanel)}>
                  <img src={p.url} alt={p.name} className="aspect-square w-full object-cover" />
                </figure>
              ))}
            </div>
          )}

          {/* Description */}
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

          {/* Required fields */}
          <section className={cn("rounded-xl border p-4", s.subPanel)}>
            <h3 className={cn("mb-3 flex items-center gap-2 text-sm font-extrabold", s.title)}>
              <Edit3 className="size-4 text-violet-400" />
              {t.createDetailsTitle}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={`${t.rawTitle} *`}   s={s} value={draft.titleRaw}    onChange={(v) => patch("titleRaw", v)} />
              <Field label={t.germanTitle}        s={s} value={draft.germanTitleSuggestion} onChange={(v) => patch("germanTitleSuggestion", v)} />
              <Field label={`${t.price} *`}       s={s} value={draft.priceAmount} onChange={(v) => patch("priceAmount", v)} />
              <Field label={t.currency}           s={s} value={draft.currency}    onChange={(v) => patch("currency", v)} />
              <Field label={`${t.color} *`}       s={s} value={draft.colorRaw}    onChange={(v) => patch("colorRaw", v)} />
              <Field label={`${t.size} *`}        s={s} value={draft.sizesRaw}    onChange={(v) => patch("sizesRaw", v)} />
              <Field label={t.category}           s={s} value={draft.categorySuggestion}   onChange={(v) => patch("categorySuggestion", v)} />
              <Field label={t.productType}        s={s} value={draft.productTypeSuggestion} onChange={(v) => patch("productTypeSuggestion", v)} />
              <Field label={`${t.stockQuantity} *`} s={s} value={draft.stockQuantity} type="number" onChange={(v) => patch("stockQuantity", v)} />
            </div>
            <label className="mt-3 grid gap-1.5">
              <span className={cn("text-xs font-black", s.strong)}>{t.notes}</span>
              <textarea
                className={cn("min-h-20 rounded-xl border px-3 py-3 text-sm leading-6 outline-none focus:ring-4", s.input)}
                value={draft.notes}
                onChange={(e) => patch("notes", e.target.value)}
                placeholder={t.notesPlaceholder}
                dir="auto"
              />
            </label>
          </section>

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
      </form>

    </div>
  );
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
        className={cn("min-h-11 rounded-xl border px-3 text-sm font-semibold outline-none focus:ring-4", s.input)}
        type={type}
        min={type === "number" ? 0 : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        dir="auto"
      />
    </label>
  );
}
