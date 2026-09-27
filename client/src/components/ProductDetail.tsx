import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import {
  ArchiveRestore, Box, CalendarDays, ChevronLeft, ChevronRight, Edit3,
  ImagePlus, Images, Lock, Loader2, Palette, Plus, ReceiptText,
  RotateCcw, Ruler, Save, ShoppingBag, Tag, Trash2, Unlock, X, Sparkles, Bot, ClipboardList, Check, Copy, Wand2, Share2
} from "lucide-react";
import {
  addProductImages, deleteProduct, deleteProductImage,
  generateAiProductImages, markProductImageAsAi,
  productImageUrl, resetSales, restoreProduct, restoreSize,
  sellProduct, updateProduct, updateRelatedProducts, updateStatus, verifyEditLock,
  pushToShopify, getAiPrompts
} from "../api";
import { useApp } from "../context";
import { COPY, cn, statusLabel } from "../i18n";
import { DARK, LIGHT, type ThemeStyles } from "../theme";
import type { ProductRecord, ProductStatus, SavedImage, SizeStock } from "../types";
import { formatPrice } from "../format";
import { statusActiveBadge, statusBadge } from "./ProductCard";
import { AI_PROMPTS } from "../constants/aiPrompts";
import ImageLightbox from "./ImageLightbox";
import SizeStockEditor, { type SizeStockRow } from "./SizeStockEditor";
import VariantSelector from "./VariantSelector";
import BarcodeScanButton from "./BarcodeScanButton";

const ACTIVE_STATUSES: ProductStatus[] = ["pending", "ai_enhanced", "published"];

type Mode = "view" | "edit";

type Draft = {
  titleRaw: string;
  categorySuggestion: string; productTypeSuggestion: string;
  priceAmount: string;
  compareAtPriceAmount: string;
  discountNote: string;
  colorRaw: string; colorGermanSuggestion: string;
  season: string; fabricType: string;
  notes: string; description: string;
  barcode: string;
  restoreStock: string;
  saleQuantity: string; saleNote: string; saleSource: string;
  saleSize: string;
  saleSizes: string[];
  saleSizeQuantities: Record<string, string>;
  isDiscounted: boolean;
  isFinalSale: boolean;
  isLimitedTimeDeal: boolean;
};

function recordToDraft(r: ProductRecord): Draft {
  return {
    titleRaw: r.parsed.titleRaw,
    categorySuggestion: r.parsed.categorySuggestion,
    productTypeSuggestion: r.parsed.productTypeSuggestion,
    priceAmount: r.parsed.priceAmount,
    compareAtPriceAmount: r.compareAtPriceAmount || "",
    discountNote: r.discountNote || "",
    colorRaw: r.parsed.colorRaw,
    colorGermanSuggestion: r.parsed.colorGermanSuggestion,
    season: r.parsed.season || "", fabricType: r.parsed.fabricType || "",
    notes: r.notes || "",
    description: r.description || "",
    barcode: (r.barcodes || [])[0] || "",
    restoreStock: String(Math.max(1, r.stockQuantity || 1)),
    saleQuantity: "1",
    saleNote: "", saleSource: "physical",
    saleSize: "",
    saleSizes: [],
    saleSizeQuantities: {},
    isDiscounted: Boolean(r.isDiscounted),
    isFinalSale: Boolean(r.isFinalSale),
    isLimitedTimeDeal: Boolean(r.isLimitedTimeDeal),
  };
}

function sizeStocksToRows(ss: SizeStock[]): SizeStockRow[] {
  return ss.map((s) => ({ size: s.size, qty: String(s.qty), barcode: s.barcode || "" }));
}

function aiImageSizeText(record: ProductRecord): string {
  const sizes = record.sizeStocks.map((s) => s.size.trim()).filter(Boolean);
  return sizes.length > 0 ? sizes.join(", ") : record.parsed.sizesRaw || "";
}

function inferAiAudience(record: ProductRecord): string {
  const p = record.parsed;
  const category = (p.categorySuggestion || "").trim();

  // Priority to explicit category
  const lowerCat = category.toLowerCase();
  if (lowerCat === "boys" || lowerCat === "boy") return "Boys";
  if (lowerCat === "girls" || lowerCat === "girl") return "Girls";
  if (lowerCat === "baby" || lowerCat === "newborn" || lowerCat === "infant") return "Baby";
  if (lowerCat === "kids" || lowerCat === "kid") return "Kids";

  // Fallback to text search
  const text = [
    p.titleRaw,
    p.productTypeSuggestion,
    p.colorRaw,
    p.sizesRaw,
    record.description,
    record.notes,
  ].join(" ").toLowerCase();

  if (/\b(baby|newborn|infant|toddler|mini baby|bebe|bebek)\b|b\.?\s*b\.?|بيبي|رضيع|مواليد/.test(text)) return "Baby";
  if (/\b(girls?|girl'?s)\b|بناتي|بنات|بنت|فتيات|kız/.test(text)) return "Girls";
  if (/\b(boys?|boy'?s)\b|ولادي|اولادي|أولادي|ولد|صبيان|erkek/.test(text)) return "Boys";

  return category || "";
}

function inferAiAgeFromSizes(sizeText: string): string {
  const range = extractAgeRangeInMonths(sizeText);
  if (!range) return "";
  if (range.min === range.max) return `About ${formatAge(range.min)}`;
  return `About ${formatAge(range.min)} to ${formatAge(range.max)}`;
}

function extractAgeRangeInMonths(sizeText: string): { min: number; max: number } | null {
  const text = sizeText.toLowerCase().replace(/–|—/g, "-");
  const values: number[] = [];

  for (const match of text.matchAll(/(\d{1,2})\s*-\s*(\d{1,2})\s*(m|mo|month|months|y|yr|year|years)\b/g)) {
    const a = Number(match[1]);
    const b = Number(match[2]);
    const factor = match[3].startsWith("y") ? 12 : 1;
    values.push(a * factor, b * factor);
  }
  for (const match of text.matchAll(/\b(\d{1,2})\s*(m|mo|month|months|y|yr|year|years)\b/g)) {
    const n = Number(match[1]);
    const factor = match[2].startsWith("y") ? 12 : 1;
    values.push(n * factor);
  }

  const euSizeToMonths: Record<number, number> = {
    50: 0, 56: 1, 62: 3, 68: 6, 74: 9, 80: 12, 86: 18, 92: 24,
    98: 36, 104: 48, 110: 60, 116: 72, 122: 84, 128: 96, 134: 108,
    140: 120, 146: 132, 152: 144, 158: 156, 164: 168,
  };
  for (const match of text.matchAll(/\b(50|56|62|68|74|80|86|92|98|104|110|116|122|128|134|140|146|152|158|164)\b/g)) {
    values.push(euSizeToMonths[Number(match[1])]);
  }

  const cleaned = Array.from(new Set(values.filter((n) => Number.isFinite(n) && n >= 0 && n <= 216)));
  if (cleaned.length === 0) return null;
  return { min: Math.min(...cleaned), max: Math.max(...cleaned) };
}

function formatAge(months: number): string {
  if (months === 0) return "newborn";
  if (months < 24) return `${months} month${months === 1 ? "" : "s"}`;
  if (months % 12 === 0) {
    const years = months / 12;
    return `${years} year${years === 1 ? "" : "s"}`;
  }
  return `${Math.floor(months / 12)} years ${months % 12} months`;
}

interface Props {
  record: ProductRecord;
  initialMode?: Mode;
  onClose: () => void;
  onReplace: (updated: ProductRecord) => void;
  onDelete: (id: string) => void;
  showRestoreSizes?: boolean;
  allProducts?: ProductRecord[];
  navigationProducts?: ProductRecord[];
  onNavigate?: (product: ProductRecord) => void;
}

export default function ProductDetail({ record, initialMode = "view", onClose, onReplace, onDelete, showRestoreSizes = false, allProducts, navigationProducts, onNavigate }: Props) {
  const { locale, theme, showToast } = useApp();
  const t = COPY[locale];
  const s = theme === "dark" ? DARK : LIGHT;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [draft, setDraft] = useState<Draft>(() => recordToDraft(record));
  const [sizeRows, setSizeRows] = useState<SizeStockRow[]>(() => sizeStocksToRows(record.sizeStocks));
  const [selectedVariantIds, setSelectedVariantIds] = useState<string[]>(() => record.relatedProducts ?? []);
  const [busy, setBusy] = useState(false);
  const [restoringSize, setRestoringSize] = useState<string | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [deletingImage, setDeletingImage] = useState<string | null>(null);
  const [markingAiImage, setMarkingAiImage] = useState<string | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<{ name: string; url: string }[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [editUnlocked, setEditUnlocked] = useState(false);
  const [unlockCode, setUnlockCode] = useState("");
  const [unlockError, setUnlockError] = useState(false);
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [showStatusUnlock, setShowStatusUnlock] = useState(false);
  const [sellError, setSellError] = useState("");
  const [showShopifyPreview, setShowShopifyPreview] = useState(false);
  const [aiImageSource, setAiImageSource] = useState<SavedImage | null>(null);
  const [aiImageBusy, setAiImageBusy] = useState(false);
  const [aiImageForm, setAiImageForm] = useState({ gender: "", age: "", size: "", instructions: "" });
  const [manualAiBusy, setManualAiBusy] = useState(false);
  const [rewriteBusy, setRewriteBusy] = useState(false);
  const [showManualPrompts, setShowManualPrompts] = useState(false);
  const [selectedPromptIndex, setSelectedPromptIndex] = useState<number>(1);
  const navList = navigationProducts ?? [];
  const navIndex = navList.findIndex((product) => product.id === record.id);
  const prevProduct = navIndex > 0 ? navList[navIndex - 1] : null;
  const nextProduct = navIndex >= 0 && navIndex < navList.length - 1 ? navList[navIndex + 1] : null;
  

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverscroll = document.documentElement.style.overscrollBehavior;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overscrollBehavior = previousHtmlOverscroll;
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
    setDraft(recordToDraft(record));
    setSizeRows(sizeStocksToRows(record.sizeStocks));
    setSelectedVariantIds(record.relatedProducts ?? []);
    setMode(initialMode);
    setDeleteConfirm(false);
    setImageFiles([]);
    setLightboxIdx(null);
    setEditUnlocked(false);
    setUnlockCode("");
    setUnlockError(false);
    setShowStatusUnlock(false);
    setSellError("");
    setShowShopifyPreview(false);
    setAiImageSource(null);
    setAiImageBusy(false);
    setAiImageForm({ gender: "", age: "", size: "", instructions: "" });

    setImagePreviews((c) => { c.forEach((p) => URL.revokeObjectURL(p.url)); return []; });
  }, [record.id, initialMode]);

  useEffect(() => () => { imagePreviews.forEach((p) => URL.revokeObjectURL(p.url)); }, [imagePreviews]);

  function patch(key: keyof Draft, val: string) { setDraft((d) => ({ ...d, [key]: val })); }
  function patchBool(key: keyof Draft, val: boolean) { setDraft((d) => ({ ...d, [key]: val })); }
  function toggleSaleSize(size: string) {
    setDraft((d) => {
      const exists = d.saleSizes.includes(size);
      const saleSizes = exists ? d.saleSizes.filter((item) => item !== size) : [...d.saleSizes, size];
      const saleSizeQuantities = { ...d.saleSizeQuantities };
      if (exists) delete saleSizeQuantities[size];
      else saleSizeQuantities[size] = saleSizeQuantities[size] || "1";
      return { ...d, saleSizes, saleSize: saleSizes[0] ?? "", saleSizeQuantities };
    });
    setSellError("");
  }
  function patchSaleSizeQuantity(size: string, val: string) {
    const stockLimit = record.sizeStocks.find((ss) => ss.size === size)?.qty ?? 1;
    const raw = parseInt(val, 10);
    const nextValue = Number.isFinite(raw) ? String(Math.min(stockLimit, Math.max(1, raw))) : "";
    setDraft((d) => ({
      ...d,
      saleSizeQuantities: { ...d.saleSizeQuantities, [size]: nextValue },
    }));
  }
  function num(val: string, fb: number) { const n = parseInt(val, 10); return Number.isFinite(n) ? n : fb; }
  function statusCanMoveWithoutUnlock(from: ProductStatus, to: ProductStatus) {
    const fromRank = ACTIVE_STATUSES.indexOf(from);
    const toRank = ACTIVE_STATUSES.indexOf(to);
    if (fromRank === -1 || toRank === -1) return false;
    return toRank >= fromRank;
  }

  async function handleSave() {
    const validSizes = sizeRows
      .filter((r) => r.size.trim())
      .map((r) => ({ size: r.size.trim(), qty: Math.max(0, parseInt(r.qty, 10) || 0), barcode: r.barcode?.trim() || "" }));

    if (validSizes.length === 0) {
      showToast(t.errSaveNeedSize, "error");
      return;
    }

    setBusy(true);
    try {
      let updated = await updateProduct(record.id, {
        notes: draft.notes,
        barcodes: draft.barcode.trim() ? [draft.barcode.trim()] : [],
        isDiscounted: draft.isDiscounted,
        compareAtPriceAmount: draft.compareAtPriceAmount,
        discountNote: draft.discountNote,
        isFinalSale: draft.isFinalSale,
        isLimitedTimeDeal: draft.isLimitedTimeDeal,
        description: draft.description,
        sizeStocks: validSizes.length > 0 ? validSizes : undefined,
        parsed: {
          titleRaw: draft.titleRaw,
          categorySuggestion: draft.categorySuggestion,
          productTypeSuggestion: draft.productTypeSuggestion,
          priceAmount: draft.priceAmount,
          currency: "EUR",
          colorRaw: draft.colorRaw,
          colorGermanSuggestion: draft.colorGermanSuggestion,
          season: draft.season,
          fabricType: draft.fabricType,
        },
      });

      if (allProducts !== undefined) {
        updated = await updateRelatedProducts(record.id, selectedVariantIds);
      }

      if (imageFiles.length > 0) {
        updated = await addProductImages(record.id, imageFiles);
        setImageFiles([]);
        setImagePreviews((c) => { c.forEach((p) => URL.revokeObjectURL(p.url)); return []; });
      }

      onReplace(updated);
      showToast(t.toastUpdated, "success");
      setMode("view");
    } catch (err) {
      const code = err instanceof Error ? err.message : "ERR_GENERAL";
      showToast(t.errors[code] ?? t.errors.ERR_GENERAL, "error");
    } finally { setBusy(false); }
  }

  async function handleStatusChange(status: ProductStatus) {
    if (busy || record.status === status) return;
    setBusy(true);
    try {
      const updated = await updateStatus(record.id, status);
      onReplace(updated);
      showToast(t.toastStatusUpdated, "success");
    } catch (err) {
      const code = err instanceof Error ? err.message : "ERR_GENERAL";
      if (code === "ERR_EDIT_LOCK_REQUIRED") setEditUnlocked(false);
      showToast(t.errors[code] ?? t.errors.ERR_GENERAL, "error");
    }
    finally { setBusy(false); }
  }

  async function handleSell() {
    const hasSizeStocks = record.sizeStocks.length > 0;
    if (hasSizeStocks && draft.saleSizes.length === 0) {
      setSellError(t.errSizeSelectRequired);
      return;
    }
    setSellError("");
    setBusy(true);
    try {
      const sizeQuantities = draft.saleSizes.map((size) => ({
        size,
        quantity: num(draft.saleSizeQuantities[size] || draft.saleQuantity, 1),
      }));
      const updated = await sellProduct(record.id, num(draft.saleQuantity, 1), sizeQuantities, draft.saleNote, draft.saleSource);
      onReplace(updated);
      showToast(t.toastSold, "success");
      patch("saleQuantity", "1");
      patch("saleNote", "");
      setDraft((d) => ({ ...d, saleSize: "", saleSizes: [], saleSizeQuantities: {} }));
    } catch (err) {
      const code = err instanceof Error ? err.message : "ERR_GENERAL";
      showToast(t.errors[code] ?? t.errors.ERR_GENERAL, "error");
    }
    finally { setBusy(false); }
  }

  async function handleRestore() {
    setBusy(true);
    try {
      const updated = await restoreProduct(record.id, num(draft.restoreStock, 1));
      onReplace(updated);
      showToast(t.toastRestored, "success");
    } catch (err) {
      const code = err instanceof Error ? err.message : "ERR_GENERAL";
      showToast(t.errors[code] ?? t.errors.ERR_GENERAL, "error");
    } finally { setBusy(false); }
  }

  async function handleRestoreSize(size: string) {
    setRestoringSize(size);
    try {
      const updated = await restoreSize(record.id, size);
      onReplace(updated);
      showToast(t.toastSizeRestored, "success");
    } catch (err) {
      const code = err instanceof Error ? err.message : "ERR_GENERAL";
      showToast(t.errors[code] ?? t.errors.ERR_GENERAL, "error");
    } finally { setRestoringSize(null); }
  }

  async function handleResetSales() {
    if (!window.confirm(t.resetSalesConfirm)) return;
    setBusy(true);
    try {
      const updated = await resetSales(record.id);
      onReplace(updated);
      showToast(t.toastSalesReset, "success");
    } catch {
      showToast(t.errors.ERR_GENERAL, "error");
    } finally { setBusy(false); }
  }

  async function handleUploadImages() {
    if (!imageFiles.length) return;
    setImageBusy(true);
    try {
      const updated = await addProductImages(record.id, imageFiles);
      onReplace(updated);
      setImageFiles([]);
      setImagePreviews((c) => { c.forEach((p) => URL.revokeObjectURL(p.url)); return []; });
      showToast(t.toastImagesAdded, "success");
    } catch { showToast(t.errors.ERR_GENERAL, "error"); }
    finally { setImageBusy(false); }
  }

  function openAiImagePanel(img: SavedImage) {
    const sizeText = aiImageSizeText(record);
    setAiImageSource(img);
    setShowManualPrompts(false);
    setAiImageForm({
      gender: inferAiAudience(record),
      age: inferAiAgeFromSizes(sizeText),
      size: sizeText,
      instructions: "",
    });
  }

  async function handleGenerateAiImages() {
    if (!aiImageSource) return;
    setAiImageBusy(true);
    try {
      const updated = await generateAiProductImages(record.id, {
        sourceFileName: aiImageSource.fileName,
        sourceFolder: aiImageSource.folder ?? "originals",
        gender: aiImageForm.gender,
        age: aiImageForm.age,
        size: aiImageForm.size,
        instructions: aiImageForm.instructions,
      });
      onReplace(updated);
      setAiImageSource(null);
      showToast(t.aiImageGenerated, "success");
    } catch (err) {
      const code = err instanceof Error ? err.message : "ERR_GENERAL";
      showToast(t.errors[code] ?? t.errors.ERR_GENERAL, "error");
    } finally {
      setAiImageBusy(false);
    }
  }

  function getGeneratedPrompt(index: number): string {
    const rawPrompt = (AI_PROMPTS as any)[`prompt${index}`] || "";
    if (index !== 2 && index !== 6) return rawPrompt;

    // Build garment info
    const parts = [];
    if (record.parsed.titleRaw) parts.push(`Garment: ${record.parsed.titleRaw}`);
    if (aiImageForm.gender) parts.push(`Target Gender: ${aiImageForm.gender}`);
    if (aiImageForm.age) parts.push(`Target Age: ${aiImageForm.age}`);
    if (aiImageForm.size) parts.push(`Size: ${aiImageForm.size}`);
    if (record.parsed.colorRaw) parts.push(`Color: ${record.parsed.colorRaw}`);
    if (record.parsed.fabricType) parts.push(`Fabric: ${record.parsed.fabricType}`);
    if (record.parsed.season) parts.push(`Season: ${record.parsed.season}`);
    
    const infoText = parts.length > 0 ? parts.join("\\n") : "No specific garment information provided.";
    
    if (index === 2) {
      return rawPrompt.replace("[Buraya kıyafetin ürün bilgilerini ekle]", infoText);
    }
    if (index === 6) {
      return rawPrompt.replace("[INSERT GARMENT INFORMATION HERE]", infoText);
    }
    return rawPrompt;
  }

  async function handleRewriteDescription() {
    setRewriteBusy(true);
    try {
      const { rewriteDescription } = await import("../api");
      const res = await rewriteDescription(record.id);
      patch("description", res.description);
      showToast((t as any).rewriteDescriptionSuccess || "Açıklama yenilendi!", "success");
    } catch (err) {
      const code = err instanceof Error ? err.message : "ERR_GENERAL";
      showToast(t.errors[code] ?? t.errors.ERR_GENERAL, "error");
    } finally {
      setRewriteBusy(false);
    }
  }


  function handleCopy(text: string) {
    navigator.clipboard.writeText(text);
    showToast((t as any).copied || "Kopyalandı!", "success");
  }

  async function handleDeleteImage(imageOrFileName: SavedImage | string, folder?: "originals" | "enhanced") {
    const fileName = typeof imageOrFileName === "string" ? imageOrFileName : imageOrFileName.fileName;
    const imageFolder = folder ?? (typeof imageOrFileName === "string" ? "originals" : imageOrFileName.folder ?? "originals");
    setDeletingImage(fileName);
    try {
      const updated = await deleteProductImage(record.id, imageFolder, fileName);
      onReplace(updated);
      if (lightboxIdx !== null) {
        const len = updated.images.length;
        if (len === 0) setLightboxIdx(null);
        else setLightboxIdx((i) => Math.min(i ?? 0, len - 1));
      }
    } catch { showToast(t.errors.ERR_GENERAL, "error"); }
    finally { setDeletingImage(null); }
  }

  async function handleMarkAsAi(img: SavedImage) {
    if (img.folder === "enhanced") return;
    setMarkingAiImage(img.fileName);
    try {
      const updated = await markProductImageAsAi(record.id, img.fileName);
      onReplace(updated);
      showToast((t as any).logMarkAiImage || "Marked as AI", "success");
    } catch {
      showToast(t.errors.ERR_GENERAL, "error");
    } finally {
      setMarkingAiImage(null);
    }
  }

  async function handlePushToShopify() {
    setBusy(true);
    try {
      const wasSynced = Boolean(record.shopify?.productId);
      const updated = await pushToShopify(record.id);
      onReplace(updated);
      showToast(wasSynced ? t.shopifyUpdateSuccess : t.shopifyCreateSuccess, "success");
    } catch (err) {
      const code = err instanceof Error ? err.message : "ERR_GENERAL";
      showToast(t.errors[code] ?? t.errors.ERR_GENERAL, "error");
    } finally {
      setBusy(false);
    }
  }


  async function handleDelete() {
    setBusy(true);
    try {
      await deleteProduct(record.id);
      onDelete(record.id);
      showToast(t.toastDeleted, "success");
      onClose();
    } catch {
      showToast(t.errors.ERR_GENERAL, "error");
      setBusy(false);
    }
  }

  const p = record.parsed;
  const isArchive = record.status === "sold_archive";
  const dateLocale = locale === "ar" ? "ar" : "tr-TR";
  const isPublishedLocked = (record.status === "published" || record.status === "sold_archive") && !editUnlocked;
  const isImageLocked = isPublishedLocked;
  const hasLockedStatusTargets = !isArchive && ACTIVE_STATUSES.some((st) =>
    st !== record.status && !statusCanMoveWithoutUnlock(record.status, st)
  );
  const shopifySynced = Boolean(record.shopify?.productId);
  const shopifyImageCount = record.images.filter((img) => img.folder === "enhanced").length;

  // Satış için geçerli bedenler (stok > 0)
  const availableSizes = record.sizeStocks.filter((ss) => ss.qty > 0);


  const [shareBusy, setShareBusy] = useState(false);
  const [shareClipboardText, setShareClipboardText] = useState<string | null>(null);
  const [shareOptionsOpen, setShareOptionsOpen] = useState(false);

const shareConfigLabels: Record<string, string> = {
  title: "Başlık",
  productCode: "Ürün Kodu/Barkod",
  price: "Fiyat",
  category: "Kategori",
  productType: "Tür",
  color: "Renk",
  season: "Mevsim",
  fabric: "Kumaş",
  sizes: "Bedenler",
  description: "Açıklama",
  notes: "Notlar"
};

  const [shareConfig, setShareConfig] = useState({
    title: true,
    productCode: true,
    price: true,
    category: true,
    productType: true,
    color: true,
    season: true,
    fabric: true,
    sizes: true,
    description: true,
    notes: true,
  });
  const [shareImages, setShareImages] = useState<string[]>([]);

  function buildShareText(): string {
    const textParts: string[] = [];
    if (shareConfig.title && p.titleRaw) textParts.push(`*${p.titleRaw}*`);
    if (shareConfig.productCode && record.productCode) textParts.push(`${(t as any).shareProductCode || "Ürün Kodu"}: ${record.productCode}`);

    if (shareConfig.price && p.priceAmount) {
      let priceStr = `${(t as any).sharePrice || "Fiyat"}: ${p.priceAmount} EUR`;
      if (record.isDiscounted && record.compareAtPriceAmount) {
        priceStr += ` (${(t as any).shareDiscounted || "İndirimli"}! ${(t as any).shareOriginalPrice || "Normal fiyat"}: ${record.compareAtPriceAmount} EUR)`;
      }
      textParts.push(priceStr);
    }

    if (shareConfig.category && p.categorySuggestion && p.categorySuggestion !== "Diğer") textParts.push(`${(t as any).shareCategory || "Kategori"}: ${p.categorySuggestion}`);
    if (shareConfig.productType && p.productTypeSuggestion && p.productTypeSuggestion !== "Diğer") textParts.push(`${(t as any).shareType || "Tür"}: ${p.productTypeSuggestion}`);
    if (shareConfig.color && p.colorRaw) textParts.push(`${(t as any).shareColor || "Renk"}: ${p.colorRaw}`);
    if (shareConfig.season && p.season) textParts.push(`${(t as any).shareSeason || "Mevsim"}: ${p.season}`);
    if (shareConfig.fabric && p.fabricType) textParts.push(`${(t as any).shareFabric || "Kumaş"}: ${p.fabricType}`);

    if (shareConfig.sizes && availableSizes.length > 0) {
      const sizesStr = availableSizes.map(sz => `${sz.size} (${sz.qty} ${(t as any).sharePcs || "adet"})`).join(", ");
      textParts.push(`${(t as any).shareSizes || "Mevcut Bedenler"}: ${sizesStr}`);
    }

    if (shareConfig.description && record.description) textParts.push(`\n${(t as any).shareDescription || "Açıklama"}:\n${record.description}`);
    if (shareConfig.notes && record.notes) textParts.push(`\n${(t as any).shareNotes || "Notlar"}:\n${record.notes}`);

    return textParts.join("\n");
  }
  function openShareOptions() {
    setShareImages(record.images.map(img => img.fileName));
    setShareOptionsOpen(true);
  }

  async function handleShareExec() {
    setShareOptionsOpen(false);
    if (shareBusy) return;
    setShareBusy(true);
    try {
      const shareText = buildShareText();
      const title = p.titleRaw || (t as any).shareDefaultTitle || "Ürün";

      // Try Web Share API (mobile / supported browsers)
      if (navigator.share) {
        const shareData: ShareData = { title, text: shareText };

        const imagesToShare = record.images.filter(img => shareImages.includes(img.fileName));
        
        // Try to attach selected product images as files
        if (imagesToShare.length > 0 && navigator.canShare) {
          try {
            const files = await Promise.all(
              imagesToShare.map(async (img, idx) => {
                const response = await fetch(productImageUrl(record.id, img.fileName, undefined, img.folder));
                const blob = await response.blob();
                const ext = blob.type.includes("png") ? "png" : "jpg";
                return new File([blob], `product-${record.id}-${idx + 1}.${ext}`, { type: blob.type || "image/jpeg" });
              })
            );
            if (navigator.canShare({ files })) {
              shareData.files = files;
            } else if (files.length > 0 && navigator.canShare({ files: [files[0]] })) {
              // Fallback: share only the first image if browser rejects all
              shareData.files = [files[0]];
            }
          } catch (imgErr) {
            console.warn("Could not attach images to share:", imgErr);
          }
        }

        await navigator.share(shareData);
      } else {
        // Desktop fallback: copy text to clipboard and show modal
        try {
          await navigator.clipboard.writeText(shareText);
          setShareClipboardText(shareText);
          showToast((t as any).shareTextCopied || "Ürün bilgileri panoya kopyalandı!", "success");
        } catch (clipErr) {
          // Last resort: show modal so user can copy manually
          setShareClipboardText(shareText);
        }
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        console.error("Share failed:", err);
        showToast((t as any).shareFailed || "Paylaşım başarısız oldu.", "error");
      }
    } finally {
      setShareBusy(false);
    }
  }


  async function handleVerifyUnlock(e: React.FormEvent) {
    e.preventDefault();
    setUnlockBusy(true);
    setUnlockError(false);
    try {
      const ok = await verifyEditLock(unlockCode);
      if (ok) { setEditUnlocked(true); setShowStatusUnlock(false); setUnlockCode(""); }
      else setUnlockError(true);
    } catch { setUnlockError(true); }
    finally { setUnlockBusy(false); }
  }



  return createPortal(
    <>
      <div className="product-detail-overlay fixed inset-0 z-50 overflow-hidden bg-black/60 p-0 sm:p-4" role="dialog" aria-modal="true">
        <div
          className={cn("product-detail-shell ms-auto flex w-full max-w-3xl flex-col overflow-hidden border shadow-2xl sm:rounded-2xl", s.panel)}
          dir={locale === "ar" ? "rtl" : "ltr"}
        >
          {/* ── Başlık ── */}
          <div className={cn("flex items-center gap-3 border-b px-4 py-3 sm:px-5", s.panelBorder)}>
            <div className="min-w-0 flex-1">
              <h2 className={cn("line-clamp-1 text-sm font-black tracking-tight", s.title)} dir="auto">
                {p.titleRaw || record.folderName}
              </h2>
              {navIndex >= 0 && navList.length > 1 ? (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopy(record.productCode)}
                    className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-[11px] font-black tracking-wide transition active:scale-95", s.controlGroup, s.controlIdle)}
                    dir="ltr"
                  >
                    {record.productCode}
                    <Copy className="size-3" />
                  </button>
                  <span className={cn("text-[11px] font-bold", s.muted)}>{t.productNavPosition(navIndex + 1, navList.length)}</span>
                </div>
              ) : null}
            </div>
            {navIndex < 0 || navList.length <= 1 ? (
              <button
                type="button"
                onClick={() => handleCopy(record.productCode)}
                className={cn("inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 font-mono text-xs font-black tracking-wide transition active:scale-95", s.controlGroup, s.controlIdle)}
                dir="ltr"
              >
                {record.productCode}
                <Copy className="size-3" />
              </button>
            ) : null}
            {onNavigate && navList.length > 1 ? (
              <div className={cn("inline-flex shrink-0 items-center gap-1 rounded-lg border p-0.5", s.controlGroup)}>
                <button
                  type="button"
                  onClick={() => prevProduct && onNavigate(prevProduct)}
                  disabled={!prevProduct}
                  title={t.prevProduct}
                  className={cn("inline-flex size-8 items-center justify-center rounded-md transition disabled:opacity-35", s.controlIdle)}
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => nextProduct && onNavigate(nextProduct)}
                  disabled={!nextProduct}
                  title={t.nextProduct}
                  className={cn("inline-flex size-8 items-center justify-center rounded-md transition disabled:opacity-35", s.controlIdle)}
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            ) : null}
            {/* Masaüstü tab */}
            <div className={cn("hidden sm:inline-flex items-center gap-0.5 rounded-lg border p-0.5", s.controlGroup)}>
              <button type="button" onClick={() => setMode("view")}
                className={cn("rounded-md px-3 py-1.5 text-xs font-extrabold transition",
                  mode === "view" ? s.controlActive : s.controlIdle)}>
                {t.viewDetails}
              </button>
              <button type="button" onClick={() => setMode("edit")}
                className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-extrabold transition",
                  mode === "edit" ? s.controlActive : s.controlIdle)}>
                {isPublishedLocked && <Lock className="size-3" />}
                {t.editBtn}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={openShareOptions} disabled={shareBusy}
                className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-lg border transition disabled:opacity-60", s.controlGroup, s.controlIdle)}
                title={(t as any).shareBtn || "Paylaş"}>
                {shareBusy ? <Loader2 className="size-4 animate-spin" /> : <Share2 className="size-4" />}
              </button>
              <button type="button" onClick={onClose}
                className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-lg border transition", s.controlGroup, s.controlIdle)}>
                <X className="size-4" />
              </button>
            </div>
          </div>

          {/* Mobil tab */}
          <div className={cn("flex sm:hidden border-b", s.panelBorder)}>
            <button type="button" onClick={() => setMode("view")}
              className={cn("flex-1 py-2.5 text-xs font-extrabold transition border-b-2",
                mode === "view" ? "border-emerald-400 text-emerald-400" : cn("border-transparent", s.muted))}>
              {t.viewDetails}
            </button>
            <button type="button" onClick={() => setMode("edit")}
              className={cn("flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 text-xs font-extrabold transition border-b-2",
                mode === "edit" ? "border-emerald-400 text-emerald-400" : cn("border-transparent", s.muted))}>
              {isPublishedLocked && <Lock className="size-3" />}
              {t.editBtn}
            </button>
          </div>

          {/* ── İçerik ── */}
          <div ref={scrollRef} className="product-detail-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
            {mode === "view" ? (
              /* ────────────────── GÖRÜNTÜLEME MODU ────────────────── */
              <div className="grid gap-4">

                {/* Görseller */}
                {record.images.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {record.images.map((img, i) => (
                      <div key={img.fileName} className="relative group">
                        <button type="button" onClick={() => setLightboxIdx(i)}
                          className="overflow-hidden rounded-xl ring-1 ring-white/10 active:scale-95 transition-transform w-full block">
                          <img src={productImageUrl(record.id, img.fileName, undefined, img.folder)} alt={img.originalName}
                            className="aspect-square w-full object-cover" loading="lazy" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Ürün bilgileri */}
                <section className={cn("rounded-xl border p-4", s.subPanel)}>
                  <div className={cn("divide-y", s.divider)}>
                    {/* Tarih + görsel sayısı */}
                    <InfoRow>
                      <span className={cn("inline-flex items-center gap-1 text-xs font-bold text-amber-400")}>
                        <CalendarDays className="size-3" />
                        {new Date(record.createdAt).toLocaleDateString(dateLocale)}
                      </span>
                      <span className={cn("text-xs", s.muted)}>·</span>
                      <span className={cn("inline-flex items-center gap-1 text-xs font-bold text-sky-400")}>
                        <Images className="size-3" />
                        {t.imageCount(record.images.length)}
                      </span>
                    </InfoRow>

                    {/* Fiyat */}
                    {p.priceAmount && <InfoRow label={t.price} s={s}>
                      <span className="font-black text-emerald-400">{formatPrice(p.priceAmount, p.currency)}</span>
                    </InfoRow>}

                    {record.isDiscounted && <InfoRow label={(t as any).campaignInfoTitle} s={s}>
                      <span className="grid gap-1 text-xs">
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          <Tag className="size-3 text-amber-400" />
                          <strong className="text-amber-400">{(t as any).discountedProduct}</strong>
                          {record.compareAtPriceAmount && (
                            <span className={cn("line-through", s.muted)}>
                              {formatPrice(record.compareAtPriceAmount, p.currency)}
                            </span>
                          )}
                          {record.isLimitedTimeDeal && <span className="rounded-md bg-orange-400/15 px-1.5 py-0.5 text-[10px] font-black text-orange-400">{(t as any).weeklyDealShort}</span>}
                          {record.isFinalSale && <span className="rounded-md bg-red-400/15 px-1.5 py-0.5 text-[10px] font-black text-red-400">{(t as any).finalSaleShort}</span>}
                        </span>
                        {record.discountNote && <span className={cn("leading-5", s.muted)} dir="auto">{record.discountNote}</span>}
                      </span>
                    </InfoRow>}

                    {/* Orijinal ad */}
                    {p.titleRaw && <InfoRow label={t.rawTitle} s={s}>
                      <span dir="auto">{p.titleRaw}</span>
                    </InfoRow>}


                    {/* Renk */}
                    {p.colorRaw && <InfoRow label={t.color} s={s}>
                      <span className="inline-flex items-center gap-1">
                        <Palette className="size-3 text-amber-300" />
                        <span dir="auto">{p.colorRaw}</span>
                      </span>
                    </InfoRow>}

                    {/* Mevsim */}
                    {p.season && <InfoRow label={(t as any).season || "Mevsim"} s={s}>
                      <span className="inline-flex items-center gap-1">
                        <Tag className="size-3 text-orange-400" />
                        <span dir="auto">{p.season}</span>
                      </span>
                    </InfoRow>}
                    {p.fabricType && <InfoRow label={(t as any).fabricType || "Kumaş Türü"} s={s}>
                      <span className="inline-flex items-center gap-1">
                        <Tag className="size-3 text-indigo-400" />
                        <span dir="auto">{p.fabricType}</span>
                      </span>
                    </InfoRow>}

                    {/* Bedenler + Toplam stok — yan yana */}
                    {record.sizeStocks.length > 0 ? (
                      <div className="grid grid-cols-2 gap-0 py-2.5">
                        <div className={cn("border-e pe-3", s.panelBorder)}>
                          <span className={cn("block mb-2 text-xs font-black", s.strong)}>{t.sizeStocksLabel}</span>
                          <div className="flex flex-wrap gap-1.5">
                            {record.sizeStocks.map((ss) => (
                              <button key={ss.size} type="button" onClick={() => ss.code && handleCopy(ss.code)} dir="ltr"
                                className={cn(
                                  "inline-flex items-center overflow-hidden rounded-lg text-xs font-extrabold transition active:scale-95",
                                  ss.qty > 0 ? "ring-1 ring-emerald-400/30" : "ring-1 ring-slate-400/20",
                                )}
                                title={ss.code || ss.size}>
                                <span className={cn(
                                  "flex items-center gap-1 px-2 py-1",
                                  ss.qty > 0 ? "bg-emerald-400/15 text-emerald-400" : "bg-slate-400/10 text-slate-400 line-through",
                                )}>
                                  <Ruler className="size-2.5 shrink-0" />
                                  {ss.size}
                                </span>
                                <span className={cn(
                                  "px-2 py-1",
                                  ss.qty > 0 ? "bg-emerald-400/25 text-emerald-500" : "bg-slate-400/20 text-slate-500",
                                )}>
                                  ×{ss.qty}
                                </span>
                                {ss.code && (
                                  <span className={cn(
                                    "flex items-center gap-1 border-s px-2 py-1 font-mono text-[10px]",
                                    ss.qty > 0 ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200" : "border-slate-400/10 bg-slate-400/10 text-slate-400",
                                  )}>
                                    {ss.code}
                                    <Copy className="size-2.5" />
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="ps-3 flex flex-col justify-center gap-1">
                          <span className={cn("text-xs font-black", s.strong)}>{t.stockQuantity}</span>
                          <span className="inline-flex items-center gap-1">
                            <Box className="size-3 text-emerald-400" />
                            <span className="font-black text-emerald-400">{record.stockQuantity}</span>
                          </span>
                        </div>
                      </div>
                    ) : (
                      /* Eski sistem — beden metin + toplam stok */
                      <>
                        {p.sizesRaw && <InfoRow label={t.size} s={s}>
                          <span className="inline-flex items-center gap-1">
                            <Ruler className="size-3 text-sky-400" />
                            {p.sizesRaw}
                          </span>
                        </InfoRow>}
                        <InfoRow label={t.stockQuantity} s={s}>
                          <span className="inline-flex items-center gap-1">
                            <Box className="size-3 text-emerald-400" />
                            <span className="font-black text-emerald-400">{record.stockQuantity}</span>
                          </span>
                        </InfoRow>
                      </>
                    )}

                    {/* Satılan */}
                    {record.soldQuantity > 0 && <InfoRow label={t.soldQuantity} s={s}>
                      <span className="inline-flex items-center gap-1 text-amber-400 font-bold">
                        <ShoppingBag className="size-3" />
                        {record.soldQuantity}
                      </span>
                    </InfoRow>}

                    {/* Kategori */}
                    {p.categorySuggestion && <InfoRow label={t.category} s={s}>
                      <span className="inline-flex items-center gap-1">
                        <Tag className="size-3 text-emerald-400" />
                        {p.categorySuggestion}
                      </span>
                    </InfoRow>}

                    {/* Ürün tipi */}
                    {p.productTypeSuggestion && <InfoRow label={t.productType} s={s}>
                      <span>{p.productTypeSuggestion}</span>
                    </InfoRow>}

                    {shopifySynced && <InfoRow label={t.shopifySynced} s={s}>
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        <ShoppingBag className="size-3 text-emerald-400" />
                        <span dir="ltr">#{record.shopify?.productId}</span>
                        {record.shopify?.handle && (
                          <span className={cn("text-xs", s.muted)} dir="ltr">/{record.shopify.handle}</span>
                        )}
                      </span>
                    </InfoRow>}

                    {record.shopify?.syncedAt && <InfoRow label={t.shopifyLastSync} s={s}>
                      <span>{new Date(record.shopify.syncedAt).toLocaleString(dateLocale)}</span>
                    </InfoRow>}

                    {record.shopify?.lastInventorySyncAt && <InfoRow label={(t as any).shopifyLastInventorySync} s={s}>
                      <span>{new Date(record.shopify.lastInventorySyncAt).toLocaleString(dateLocale)}</span>
                    </InfoRow>}

                    {record.shopify?.lastOrderSyncAt && <InfoRow label={(t as any).shopifyLastOrderSync} s={s}>
                      <span>{new Date(record.shopify.lastOrderSyncAt).toLocaleString(dateLocale)}</span>
                    </InfoRow>}

                    {shopifySynced && <InfoRow label={(t as any).shopifyVariantLinks} s={s}>
                      {(record.shopify?.variants ?? []).length > 0 ? (
                        <span className="flex flex-wrap gap-1.5">
                          {(record.shopify?.variants ?? []).map((variant) => (
                            <span key={`${variant.variantId}-${variant.size}`} className={cn("rounded-md border px-2 py-0.5 text-[10px] font-bold", s.panelBorder)} dir="ltr">
                              {variant.size}: #{variant.variantId}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className={cn("text-xs", s.muted)}>{(t as any).shopifyNoVariantLinks}</span>
                      )}
                    </InfoRow>}

                    {record.shopify?.lastError && <InfoRow label={t.shopifyLastError} s={s}>
                      <span className="text-red-400" dir="auto">{record.shopify.lastError}</span>
                    </InfoRow>}
                  </div>
                </section>

                {/* Açıklama */}
                {record.description && (
                  <section className={cn("rounded-xl border p-4", s.subPanel)}>
                    <h3 className={cn("mb-2 text-xs font-black uppercase tracking-wide", s.muted)}>{t.description}</h3>
                    <p className={cn("text-sm leading-6 whitespace-pre-wrap", s.strong)} dir="auto">{record.description}</p>
                  </section>
                )}

                {/* Notlar */}
                {record.notes && (
                  <section className={cn("rounded-xl border p-4", s.subPanel)}>
                    <h3 className={cn("mb-2 text-xs font-black uppercase tracking-wide", s.muted)}>{t.notes}</h3>
                    <p className={cn("text-sm leading-6", s.strong)} dir="auto">{record.notes}</p>
                  </section>
                )}

                {/* Renk varyantları — görüntüleme modu */}
                {allProducts && (record.relatedProducts ?? []).length > 0 && (
                  <section className={cn("rounded-xl border p-4", s.subPanel)}>
                    <h3 className={cn("mb-3 flex items-center gap-2 text-sm font-extrabold", s.title)}>
                      <Palette className="size-4 text-amber-300" />
                      {t.colorVariants}
                    </h3>
                    <div className="flex flex-wrap gap-3">
                      {(record.relatedProducts ?? []).map((relId) => {
                        const rel = allProducts.find((p) => p.id === relId);
                        if (!rel) return null;
                        const img = rel.images[0];
                        return (
                          <button
                            key={relId}
                            type="button"
                            onClick={() => onNavigate?.(rel)}
                            className={cn(
                              "flex flex-col items-center gap-1.5 rounded-xl border p-2 transition",
                              "hover:border-amber-300/50 hover:bg-amber-300/10 active:scale-95",
                              s.panelBorder,
                            )}
                          >
                            {img ? (
                              <img
                                src={productImageUrl(rel.id, img.fileName, undefined, img.folder)}
                                alt={rel.parsed.titleRaw}
                                className="size-16 rounded-lg object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <div className={cn("size-16 rounded-lg", s.subPanel)} />
                            )}
                            <span
                              className={cn("max-w-[4.5rem] truncate text-xs font-semibold", s.muted)}
                              dir="auto"
                            >
                              {rel.parsed.colorRaw || rel.parsed.titleRaw}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                )}

                {/* Durum değiştirme */}
                {!isArchive && (
                  <section className={cn("rounded-xl border p-4", s.subPanel)}>
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <h3 className={cn("text-xs font-black uppercase tracking-wide", s.muted)}>{t.changeStatus}</h3>
                      <div className="flex flex-wrap items-center gap-2">
                        {hasLockedStatusTargets && (
                          editUnlocked ? (
                            <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-xs font-extrabold text-emerald-400">
                              <Unlock className="size-3" /> {t.statusUnlocked}
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setShowStatusUnlock((v) => !v)}
                              className={cn("inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-extrabold transition active:scale-95", s.controlGroup, s.controlIdle)}
                            >
                              <Lock className="size-3" /> {t.unlockToEdit}
                            </button>
                          )
                        )}
                        {record.status === "published" && (
                          <button type="button" onClick={() => setShowShopifyPreview(true)} disabled={busy} className="inline-flex items-center gap-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-purple-500 px-2.5 py-1 rounded-md transition disabled:opacity-50 shadow-sm">
                            <ShoppingBag className="size-3" /> {shopifySynced ? t.shopifyUpdateBtn : t.shopifyBtn}
                          </button>
                        )}
                      </div>
                    </div>
                    {showStatusUnlock && !editUnlocked && (
                      <form onSubmit={handleVerifyUnlock} className="mb-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                        <input
                          type="password"
                          inputMode="numeric"
                          value={unlockCode}
                          onChange={(e) => { setUnlockCode(e.target.value); setUnlockError(false); }}
                          placeholder={t.unlockCodePlaceholder}
                          autoComplete="off"
                          className={cn(
                            "min-h-10 rounded-xl border px-3 text-sm font-extrabold outline-none focus:ring-4",
                            s.input,
                            unlockError && "border-red-400 focus:ring-red-500/15",
                          )}
                        />
                        <button
                          type="submit"
                          disabled={unlockBusy || !unlockCode}
                          className={cn("inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border px-4 text-xs font-extrabold transition disabled:opacity-50", s.success)}
                        >
                          {unlockBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Unlock className="size-3.5" />}
                          {t.unlockSubmit}
                        </button>
                        {unlockError && (
                          <p className="text-xs font-semibold text-red-400 sm:col-span-2">{t.unlockWrongCode}</p>
                        )}
                        <p className={cn("text-xs font-semibold sm:col-span-2", s.muted)}>{t.statusLockHint}</p>
                      </form>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {ACTIVE_STATUSES.map((st) => {
                        const isTransitionAllowed = editUnlocked || record.status === st || statusCanMoveWithoutUnlock(record.status, st);
                        
                        return (
                          <button key={st} type="button" disabled={busy || !isTransitionAllowed} onClick={() => handleStatusChange(st)}
                            className={cn("rounded-lg border px-3 py-1.5 text-xs font-extrabold transition-all active:scale-95 disabled:opacity-50",
                              record.status === st ? statusActiveBadge(st, s) : cn(statusBadge(st, s), isTransitionAllowed ? "opacity-60 hover:opacity-100" : "opacity-30 cursor-not-allowed"))}>
                            {statusLabel(st, locale)}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                )}

                {/* Satış / Geri al */}
                {!isArchive ? (
                  <section className={cn("rounded-xl border p-4", s.subPanel)}>
                    <h3 className={cn("mb-3 flex items-center gap-2 text-sm font-extrabold", s.title)}>
                      <ReceiptText className="size-4 text-emerald-400" /> {t.saleInfoTitle}
                    </h3>

                    <div className="grid gap-3">
                      {/* Beden seçimi (sizeStocks varsa) */}
                      {record.sizeStocks.length > 0 && (
                        availableSizes.length === 0 ? (
                          /* Tüm bedenler tükendi */
                          <div className={cn(
                            "flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold",
                            s.error,
                          )}>
                            <ShoppingBag className="size-4 shrink-0" />
                            {t.allSizesOutOfStock}
                          </div>
                        ) : (
                          <label className="grid gap-2">
                            <span className={cn("text-xs font-black", s.strong)}>{t.selectSizeForSale} *</span>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                              {availableSizes.map((ss) => {
                                const selected = draft.saleSizes.includes(ss.size);
                                return (
                                  <div key={ss.size} className="grid gap-2">
                                    <button
                                      type="button"
                                      onClick={() => toggleSaleSize(ss.size)}
                                      className={cn(
                                        "group flex min-h-16 items-center justify-between gap-3 rounded-xl border px-3 py-2 text-start transition active:scale-[0.99]",
                                        selected
                                          ? "border-emerald-400 bg-emerald-400/15 text-emerald-100 shadow-lg shadow-emerald-950/20"
                                          : cn(s.controlGroup, s.controlIdle),
                                        sellError && "border-red-400",
                                      )}
                                    >
                                      <span className="grid min-w-0 gap-1">
                                        <span className={cn("text-sm font-black", selected ? "text-emerald-200" : s.title)} dir="auto">
                                          {t.sizeStockDisplay(ss.size, ss.qty)}
                                        </span>
                                        {ss.code && (
                                          <span className={cn("truncate font-mono text-[11px] font-black", selected ? "text-emerald-300" : s.muted)} dir="ltr">
                                            {ss.code}
                                          </span>
                                        )}
                                      </span>
                                      <span className={cn(
                                        "grid size-6 shrink-0 place-items-center rounded-full border-2",
                                        selected ? "border-emerald-300 bg-emerald-400 text-stone-950" : "border-slate-400/50",
                                      )}>
                                        {selected ? <Check className="size-4" /> : null}
                                      </span>
                                    </button>
                                    {selected && (
                                      <div
                                        className={cn("flex items-center justify-between gap-3 rounded-xl border px-3 py-2", s.controlGroup)}
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <span className={cn("text-xs font-black", s.strong)}>{ss.size}</span>
                                        <div className="flex items-center gap-2" dir="ltr">
                                          <button
                                            type="button"
                                            onClick={() => patchSaleSizeQuantity(ss.size, String(Math.max(1, num(draft.saleSizeQuantities[ss.size] || "1", 1) - 1)))}
                                            disabled={num(draft.saleSizeQuantities[ss.size] || "1", 1) <= 1}
                                            className={cn("grid size-8 place-items-center rounded-lg border text-base font-black transition active:scale-95 disabled:opacity-40", s.controlGroup, s.controlIdle)}
                                          >
                                            -
                                          </button>
                                          <input
                                            type="number"
                                            min={1}
                                            max={ss.qty}
                                            value={draft.saleSizeQuantities[ss.size] || "1"}
                                          onChange={(e) => patchSaleSizeQuantity(ss.size, e.target.value)}
                                          onBlur={() => {
                                            if (!draft.saleSizeQuantities[ss.size]) patchSaleSizeQuantity(ss.size, "1");
                                          }}
                                            className={cn("h-8 w-16 rounded-lg border px-2 text-center text-sm font-black outline-none focus:ring-4", s.input)}
                                          />
                                          <button
                                            type="button"
                                            onClick={() => patchSaleSizeQuantity(ss.size, String(Math.min(ss.qty, num(draft.saleSizeQuantities[ss.size] || "1", 1) + 1)))}
                                            disabled={num(draft.saleSizeQuantities[ss.size] || "1", 1) >= ss.qty}
                                            className={cn("grid size-8 place-items-center rounded-lg border text-base font-black transition active:scale-95 disabled:opacity-40", s.controlGroup, s.controlIdle)}
                                          >
                                            +
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                            {sellError && (
                              <p className={cn("text-xs font-semibold text-red-400")}>{sellError}</p>
                            )}
                          </label>
                        )
                      )}

                      <div className="grid gap-3 sm:grid-cols-2">
                        {record.sizeStocks.length === 0 && (
                          <label className="grid gap-1.5">
                            <span className={cn("text-xs font-black", s.strong)}>{t.saleQuantity}</span>
                            <input type="number" min={1}
                              value={draft.saleQuantity}
                              onChange={(e) => patch("saleQuantity", e.target.value)}
                              className={cn("min-h-11 w-full rounded-xl border px-3 text-sm font-semibold outline-none focus:ring-4", s.input)} />
                          </label>
                        )}
                        <label className="grid gap-1.5">
                          <span className={cn("text-xs font-black", s.strong)}>{t.saleNote}</span>
                          <div className="flex gap-2 mb-2">
                            <button type="button" onClick={() => patch("saleSource", "physical")} className={cn("flex-1 min-h-9 rounded-lg border text-xs font-bold transition", draft.saleSource === "physical" ? s.primary : s.controlIdle)}>{(t as any).saleSourcePhysical || "Fiziksel Mağaza"}</button>
                            <button type="button" onClick={() => patch("saleSource", "online")} className={cn("flex-1 min-h-9 rounded-lg border text-xs font-bold transition", draft.saleSource === "online" ? s.primary : s.controlIdle)}>{(t as any).saleSourceOnline || "İnternet"}</button>
                          </div>
                          <input value={draft.saleNote} onChange={(e) => patch("saleNote", e.target.value)}
                            placeholder={t.saleNotePlaceholder} dir="auto"
                            className={cn("min-h-11 w-full rounded-xl border px-3 text-sm font-semibold outline-none focus:ring-4", s.input)} />
                        </label>
                      </div>
                    </div>

                    <div className={cn("product-detail-sale-actions -mx-4 mt-3 px-4 pb-1 pt-3", s.subPanel)}>
                      <button type="button" onClick={handleSell}
                        disabled={busy || (record.sizeStocks.length > 0 && availableSizes.length === 0)}
                        className={cn("inline-flex w-full min-h-12 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-extrabold transition disabled:opacity-60", s.error)}>
                        {busy ? <Loader2 className="size-4 animate-spin" /> : <ShoppingBag className="size-4" />}
                        {t.markSold}
                      </button>
                      {record.soldQuantity > 0 && (
                        <button type="button" onClick={handleResetSales} disabled={busy}
                          className={cn("mt-2 inline-flex w-full min-h-10 items-center justify-center gap-2 rounded-xl border px-4 text-xs font-extrabold transition disabled:opacity-60", s.controlGroup, s.controlIdle)}>
                          <RotateCcw className="size-3.5" /> {t.resetSales}
                        </button>
                      )}
                    </div>
                  </section>
                ) : (
                  <section className={cn("rounded-xl border p-4", s.subPanel)}>
                    {record.soldSizes.length === 0 && (
                      <label className="grid gap-1.5 mb-3">
                        <span className={cn("text-xs font-black", s.strong)}>{t.restoreStock}</span>
                        <input type="number" min={1} value={draft.restoreStock} onChange={(e) => patch("restoreStock", e.target.value)}
                          className={cn("min-h-11 w-full rounded-xl border px-3 text-sm font-semibold outline-none focus:ring-4", s.input)} />
                      </label>
                    )}
                    <button type="button" onClick={handleRestore} disabled={busy}
                      className={cn("inline-flex w-full min-h-11 items-center justify-center gap-2 rounded-xl border text-sm font-extrabold transition disabled:opacity-60", s.success)}>
                      {busy ? <Loader2 className="size-4 animate-spin" /> : <ArchiveRestore className="size-4" />}
                      {t.restoreProduct}
                    </button>
                  </section>
                )}

                {/* Satılan bedenler — sadece arşiv bölümünden geri alınabilir */}
                {showRestoreSizes && record.soldSizes.length > 0 && (
                  <section className={cn("rounded-xl border p-4", s.subPanel)}>
                    <h3 className={cn("mb-3 flex items-center gap-2 text-sm font-extrabold", s.title)}>
                      <Ruler className="size-4 text-amber-400" />
                      <span className="text-amber-400">{t.soldSizesLabel}</span>
                    </h3>
                    <div className="grid gap-2">
                      {record.soldSizes.map((ss) => (
                        <div key={ss.size} className={cn("flex items-center justify-between gap-3 rounded-xl border px-3 py-2", s.panelBorder)}>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-extrabold text-amber-400">{ss.size}</span>
                            <span className={cn("text-xs", s.muted)}>
                              {new Date(ss.soldAt).toLocaleDateString(dateLocale)}
                            </span>
                          </div>
                          <button
                            type="button"
                            disabled={restoringSize === ss.size || busy}
                            onClick={() => handleRestoreSize(ss.size)}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-extrabold transition active:scale-95 disabled:opacity-50",
                              s.success,
                            )}
                          >
                            {restoringSize === ss.size
                              ? <Loader2 className="size-3 animate-spin" />
                              : <ArchiveRestore className="size-3" />}
                            {t.restoreSizeBtn}
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Satış geçmişi */}
                {(record.saleHistory ?? []).length > 0 && (
                  <section className={cn("rounded-xl border p-4", s.subPanel)}>
                    <h3 className={cn("mb-3 text-sm font-extrabold", s.title)}>{t.saleHistory}</h3>
                    <div className="grid gap-2">
                      {[...record.saleHistory].reverse().map((sale, i) => (
                        <div key={`${sale.soldAt}-${i}`} className={cn("rounded-lg border px-3 py-2 text-xs", s.panelBorder)}>
                          <div className={cn("font-extrabold flex flex-wrap items-center gap-1", s.title)}>
                            {new Date(sale.soldAt).toLocaleString(dateLocale)}
                            <span className="text-emerald-400">·</span>
                            <span>{sale.quantity} {t.soldQuantity.toLowerCase()}</span>
                            {sale.source === "online" && <span className="ml-auto rounded bg-sky-400/10 px-1 py-0.5 text-[10px] uppercase text-sky-400">{(t as any).saleSourceOnline || "İnternet"}</span>}
                            {sale.source === "physical" && <span className="ml-auto rounded bg-orange-400/10 px-1 py-0.5 text-[10px] uppercase text-orange-400">{(t as any).saleSourcePhysical || "Fiziksel"}</span>}
                            {sale.size && (
                              <>
                                <span className="text-emerald-400">·</span>
                                <span className="inline-flex items-center gap-0.5 text-sky-400">
                                  <Ruler className="size-2.5" />{sale.size}
                                </span>
                              </>
                            )}
                            <span className="text-emerald-400">·</span>
                            <span className={cn("rounded-md px-1.5 py-0.5 text-[10px]", sale.source === "shopify" ? "bg-emerald-400/10 text-emerald-400" : "bg-emerald-400/10 text-emerald-400")}>
                              {sale.source === "shopify" ? (t as any).saleSourceShopify : (t as any).saleSourceManual}
                            </span>
                            {sale.orderName && (
                              <>
                                <span className="text-emerald-400">·</span>
                                <span dir="ltr">{sale.orderName}</span>
                              </>
                            )}
                          </div>
                          {sale.note && <div className={cn("mt-0.5", s.muted)} dir="auto">{sale.note}</div>}
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {(record.shopify?.orderHistory ?? []).length > 0 && (
                  <section className={cn("rounded-xl border p-4", s.subPanel)}>
                    <h3 className={cn("mb-3 text-sm font-extrabold", s.title)}>{(t as any).shopifyOrderHistory}</h3>
                    <div className="grid gap-2">
                      {[...(record.shopify?.orderHistory ?? [])].reverse().slice(0, 8).map((entry) => (
                        <div key={entry.processedKey} className={cn("rounded-lg border px-3 py-2 text-xs", s.panelBorder)}>
                          <div className={cn("flex flex-wrap items-center gap-1 font-extrabold", s.title)}>
                            <span dir="ltr">{entry.orderName || entry.orderId}</span>
                            <span className="text-emerald-400">·</span>
                            <span>{entry.quantity} {t.soldQuantity.toLowerCase()}</span>
                            {entry.size && (
                              <>
                                <span className="text-emerald-400">·</span>
                                <span className="inline-flex items-center gap-0.5 text-sky-400">
                                  <Ruler className="size-2.5" />{entry.size}
                                </span>
                              </>
                            )}
                            <span className={cn("rounded-md px-1.5 py-0.5 text-[10px]", entry.status === "synced" ? "bg-emerald-400/10 text-emerald-400" : entry.status === "partial" ? "bg-amber-400/10 text-amber-400" : "bg-red-400/10 text-red-400")}>
                              {entry.status}
                            </span>
                          </div>
                          <div className={cn("mt-0.5", s.muted)} dir="auto">
                            {new Date(entry.syncedAt).toLocaleString(dateLocale)}
                            {entry.message ? ` · ${entry.message}` : ""}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            ) : isPublishedLocked ? (
              /* ────────────────── KİLİT EKRANI ────────────────── */
              <div className="flex flex-col items-center justify-center py-16 gap-5 text-center">
                <div className={cn("flex size-16 items-center justify-center rounded-2xl border", s.subPanel)}>
                  <Lock className="size-8 text-emerald-400" />
                </div>
                <div>
                  <h3 className={cn("text-base font-black mb-1", s.title)}>{t.editLocked}</h3>
                  <p className={cn("text-sm leading-6 max-w-xs", s.muted)}>{t.editLockedPublished}</p>
                </div>
                <form onSubmit={handleVerifyUnlock} className="grid gap-3 w-full max-w-xs">
                  <input
                    type="password"
                    inputMode="numeric"
                    value={unlockCode}
                    onChange={(e) => { setUnlockCode(e.target.value); setUnlockError(false); }}
                    placeholder={t.unlockCodePlaceholder}
                    autoComplete="off"
                    className={cn(
                      "min-h-11 rounded-xl border px-3 text-center text-sm font-extrabold tracking-widest outline-none focus:ring-4",
                      s.input,
                      unlockError && "border-red-400 focus:ring-red-500/15",
                    )}
                  />
                  {unlockError && (
                    <p className={cn("rounded-xl border px-3 py-2 text-xs font-semibold text-center", s.error)}>
                      {t.unlockWrongCode}
                    </p>
                  )}
                  <button
                    type="submit"
                    disabled={unlockBusy || !unlockCode}
                    className={cn(
                      "inline-flex items-center justify-center gap-2 rounded-xl border px-5 py-3 text-sm font-extrabold transition",
                      "border-amber-400/30 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 active:scale-95 disabled:opacity-50",
                    )}
                  >
                    {unlockBusy ? <Loader2 className="size-4 animate-spin" /> : <Unlock className="size-4" />}
                    {t.unlockSubmit}
                  </button>
                </form>
              </div>
            ) : (
              /* ────────────────── DÜZENLEME MODU ────────────────── */
              <div className="grid gap-5">

                {/* Kaydet */}
                <button type="button" onClick={handleSave} disabled={busy}
                  className={cn("inline-flex w-full min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-extrabold transition disabled:opacity-60", s.primary)}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  {t.saveChanges}
                </button>

                {/* Form */}
                <section className={cn("rounded-xl border p-4", s.subPanel)}>
                  <h3 className={cn("mb-3 flex items-center gap-2 text-sm font-extrabold", s.title)}>
                    <Edit3 className="size-4 text-emerald-400" /> {t.editProduct}
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <DetailField label={t.rawTitle}            s={s} value={draft.titleRaw}              onChange={(v) => patch("titleRaw", v)} />
                    <DetailField label={t.price}               s={s} value={draft.priceAmount}            onChange={(v) => patch("priceAmount", v)} prefix="€" inputDir="ltr" />
                    <DetailField label={(t as any).compareAtPrice} s={s} value={draft.compareAtPriceAmount} onChange={(v) => patch("compareAtPriceAmount", v)} prefix="€" inputDir="ltr" />
                    <DetailField label={t.color}               s={s} value={draft.colorRaw}               onChange={(v) => patch("colorRaw", v)} />
                    <DetailField label={(t as any).fabricType || "Kumaş Türü"} s={s} value={draft.fabricType} onChange={(v) => patch("fabricType", v)} />
                    <label className="grid gap-1.5">
                      <span className={cn("text-xs font-black", s.strong)}>{(t as any).season || "Mevsim"}</span>
                      <select value={canonicalSeasonValue(draft.season)} onChange={(e) => patch("season", e.target.value)} className={cn("min-h-11 w-full rounded-xl border px-3 text-sm font-semibold outline-none focus:ring-4", s.input)}>
                        <option value="">-</option>
                        {["Summer", "Winter", "Spring"].map((season) => (
                          <option key={season} value={season}>{season}</option>
                        ))}
                      </select>
                    </label>
                    <DetailField label={t.category}            s={s} value={draft.categorySuggestion}     onChange={(v) => patch("categorySuggestion", v)} />
                    <DetailField label={t.productType}         s={s} value={draft.productTypeSuggestion}  onChange={(v) => patch("productTypeSuggestion", v)} />
                    <DetailField label={t.barcodeOptional} s={s} value={draft.barcode} onChange={(v) => patch("barcode", v)} inputDir="ltr" barcodeScanTitle={t.openCameraScanBarcode} />
                  </div>

                  <div className={cn("mt-4 rounded-xl border p-3", s.panelBorder)}>
                    <h4 className={cn("mb-2 flex items-center gap-2 text-xs font-black", s.strong)}>
                      <Tag className="size-3.5 text-amber-400" />
                      {(t as any).campaignInfoTitle}
                    </h4>
                    <div className="grid gap-2">
                      <label className={cn("flex items-start gap-2 rounded-lg border p-3 text-xs", s.panelBorder)}>
                        <input
                          type="checkbox"
                          checked={draft.isDiscounted}
                          onChange={(e) => {
                            patchBool("isDiscounted", e.target.checked);
                            if (!e.target.checked) {
                              setDraft((d) => ({ ...d, isFinalSale: false, isLimitedTimeDeal: false }));
                            }
                          }}
                          className="mt-0.5"
                        />
                        <span className="grid gap-0.5">
                          <strong className={s.title}>{(t as any).discountedProduct}</strong>
                          <span className={s.muted}>{(t as any).discountedProductHelp}</span>
                        </span>
                      </label>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className={cn("flex items-start gap-2 rounded-lg border p-3 text-xs", s.panelBorder, !draft.isDiscounted && "opacity-50")}>
                          <input
                            type="checkbox"
                            disabled={!draft.isDiscounted}
                            checked={draft.isLimitedTimeDeal}
                            onChange={(e) => patchBool("isLimitedTimeDeal", e.target.checked)}
                            className="mt-0.5"
                          />
                          <span className="grid gap-0.5">
                            <strong className={s.title}>{(t as any).includeWeeklyDeals}</strong>
                            <span className={s.muted}>{(t as any).includeWeeklyDealsHelp}</span>
                          </span>
                        </label>
                        <label className={cn("flex items-start gap-2 rounded-lg border p-3 text-xs", s.panelBorder, !draft.isDiscounted && "opacity-50")}>
                          <input
                            type="checkbox"
                            disabled={!draft.isDiscounted}
                            checked={draft.isFinalSale}
                            onChange={(e) => patchBool("isFinalSale", e.target.checked)}
                            className="mt-0.5"
                          />
                          <span className="grid gap-0.5">
                            <strong className={s.title}>{(t as any).finalSale}</strong>
                            <span className={s.muted}>{(t as any).finalSaleHelp}</span>
                          </span>
                        </label>
                      </div>
                      <label className={cn("grid gap-1.5", !draft.isDiscounted && "opacity-50")}>
                        <span className={cn("text-xs font-black", s.strong)}>{(t as any).discountNote}</span>
                        <textarea
                          disabled={!draft.isDiscounted}
                          className={cn("min-h-20 w-full rounded-xl border px-3 py-3 text-sm leading-6 outline-none focus:ring-4 disabled:cursor-not-allowed", s.input)}
                          value={draft.discountNote}
                          onChange={(e) => patch("discountNote", e.target.value)}
                          placeholder={(t as any).discountNotePlaceholder}
                          dir="auto"
                        />
                      </label>
                    </div>
                  </div>

                  {/* Beden + stok editörü */}
                  <div className="mt-3 grid gap-1.5">
                    <span className={cn("flex items-center gap-2 text-xs font-black", s.strong)}>
                      <Ruler className="size-3.5 text-sky-400" />
                      {t.sizeStocksLabel}
                    </span>
                    <SizeStockEditor
                      value={sizeRows}
                      onChange={setSizeRows}
                      s={s}
                      sizeNamePlaceholder={t.sizeNamePlaceholder}
                      sizeQtyPlaceholder={t.sizeQtyPlaceholder}
                      addRowLabel={t.addSizeRow}
                      barcodePlaceholder={(t as any).sizeBarcodePlaceholder || "Beden barkodu (opsiyonel)"}
                      barcodeScanTitle={t.openCameraScanBarcode}
                    />
                  </div>

                  <label className="mt-3 grid gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className={cn("text-xs font-black", s.strong)}>{t.description}</span>
                      <button type="button" onClick={handleRewriteDescription} disabled={rewriteBusy}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-black text-emerald-500 transition hover:bg-purple-500/20 disabled:opacity-50">
                        {rewriteBusy ? <Loader2 className="size-3 animate-spin" /> : <Wand2 className="size-3" />}
                        {(t as any).rewriteDescriptionAi || "✨ Açıklamayı Yenile (AI)"}
                      </button>
                    </div>
                    <textarea className={cn("min-h-24 w-full rounded-xl border px-3 py-3 text-sm leading-6 outline-none focus:ring-4", s.input)}
                      value={draft.description} onChange={(e) => patch("description", e.target.value)} dir="auto" />
                  </label>
                  <label className="mt-3 grid gap-1.5">
                    <span className={cn("text-xs font-black", s.strong)}>{t.notes}</span>
                    <textarea className={cn("min-h-20 w-full rounded-xl border px-3 py-3 text-sm leading-6 outline-none focus:ring-4", s.input)}
                      value={draft.notes} onChange={(e) => patch("notes", e.target.value)}
                      placeholder={t.notesPlaceholder} dir="auto" />
                  </label>
                </section>

                {/* Renk varyantları — düzenleme modu */}
                {allProducts && (
                  <section className={cn("rounded-xl border p-4", s.subPanel)}>
                    <VariantSelector
                      allProducts={allProducts}
                      selectedIds={selectedVariantIds}
                      currentProductId={record.id}
                      onChange={setSelectedVariantIds}
                      s={s}
                      label={t.colorVariantsLabel}
                      searchPlaceholder={t.colorVariantsSearch}
                      emptyText={t.colorVariantsEmpty}
                    />
                  </section>
                )}

                {/* Görseller */}
                <section className={cn("rounded-xl border p-4", s.subPanel)}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className={cn("flex items-center gap-2 text-sm font-extrabold", s.title)}>
                      <Images className="size-4 text-emerald-400" /> {t.images}
                    </h3>
                    {imageFiles.length > 0 && (
                      <button type="button" onClick={handleUploadImages} disabled={imageBusy}
                        className={cn("inline-flex min-h-9 items-center gap-2 rounded-xl px-3 text-xs font-extrabold transition disabled:opacity-60", s.primary)}>
                        {imageBusy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                        {t.uploadSelectedImages}
                      </button>
                    )}
                  </div>

                  {record.images.length > 0 && (
                    <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {record.images.map((img, i) => (
                        <div key={img.fileName} className="relative overflow-hidden rounded-xl">
                          <button type="button" onClick={() => setLightboxIdx(i)} className="block w-full">
                            <img src={productImageUrl(record.id, img.fileName, undefined, img.folder)} alt={img.originalName}
                              className="aspect-square w-full object-cover" loading="lazy" />
                          </button>
                          {img.folder === "enhanced" && (
                            <span className="absolute start-1 top-1 rounded-md bg-purple-600/90 px-1.5 py-0.5 text-[10px] font-black text-white">
                              AI
                            </span>
                          )}
                          {!isImageLocked && (
                            <>
                              {img.folder !== "enhanced" && (
                                <button type="button" disabled={markingAiImage === img.fileName}
                                  onClick={() => handleMarkAsAi(img)}
                                  className={cn("absolute top-1 end-1 flex size-7 items-center justify-center rounded-full bg-slate-800/80 text-sky-300 transition hover:bg-slate-700 active:scale-95", markingAiImage === img.fileName && "opacity-50")}
                                  title={(t as any).aiImageMarkAsAi || "Mark as AI"}>
                                  {markingAiImage === img.fileName ? <Loader2 className="size-3.5 animate-spin" /> : <Bot className="size-3.5" />}
                                </button>
                              )}
                              {img.folder !== "enhanced" && (
                                <button type="button"
                                  onClick={() => openAiImagePanel(img)}
                                  className="absolute bottom-1 start-1 flex size-7 items-center justify-center rounded-full bg-purple-600/90 text-white transition hover:bg-purple-500 active:scale-95"
                                  title={t.aiImageCreate}>
                                  <Sparkles className="size-3.5" />
                                </button>
                              )}
                              <button type="button" disabled={deletingImage === img.fileName}
                                onClick={() => handleDeleteImage(img)}
                                className={cn("absolute bottom-1 end-1 flex size-7 items-center justify-center rounded-full",
                                  "bg-black/60 text-red-400 hover:bg-red-500/80 hover:text-white transition active:scale-95",
                                  deletingImage === img.fileName && "opacity-50")}>
                                {deletingImage === img.fileName
                                  ? <Loader2 className="size-3.5 animate-spin" />
                                  : <Trash2 className="size-3.5" />}
                              </button>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {aiImageSource && !isImageLocked && (
                    <div className={cn("mb-3 grid gap-3 rounded-xl border p-3", s.panelBorder)}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className={cn("flex items-center gap-2 text-sm font-extrabold", s.title)}>
                            <Sparkles className="size-4 text-emerald-400" />
                            {t.aiImageCreate}
                          </h4>
                          <p className={cn("mt-1 text-xs leading-5", s.muted)}>{t.aiImageHelp}</p>
                        </div>
                        <button type="button" onClick={() => { setAiImageSource(null); }}
                          className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-lg border", s.controlGroup, s.controlIdle)}>
                          <X className="size-3.5" />
                        </button>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-3">
                        <input
                          value={aiImageForm.gender}
                          onChange={(e) => { setAiImageForm((v) => ({ ...v, gender: e.target.value })); }}
                          placeholder={t.aiImageGenderPlaceholder}
                          className={cn("min-h-10 rounded-xl border px-3 text-sm font-semibold outline-none focus:ring-4", s.input)}
                        />
                        <input
                          value={aiImageForm.age}
                          onChange={(e) => { setAiImageForm((v) => ({ ...v, age: e.target.value })); }}
                          placeholder={t.aiImageAgePlaceholder}
                          className={cn("min-h-10 rounded-xl border px-3 text-sm font-semibold outline-none focus:ring-4", s.input)}
                        />
                        <input
                          value={aiImageForm.size}
                          onChange={(e) => { setAiImageForm((v) => ({ ...v, size: e.target.value })); }}
                          placeholder={t.aiImageSizePlaceholder}
                          className={cn("min-h-10 rounded-xl border px-3 text-sm font-semibold outline-none focus:ring-4", s.input)}
                        />
                      </div>
                      <textarea
                        value={aiImageForm.instructions}
                        onChange={(e) => { setAiImageForm((v) => ({ ...v, instructions: e.target.value })); }}
                        placeholder={t.aiImageInstructionsPlaceholder}
                        className={cn("min-h-20 rounded-xl border px-3 py-2 text-sm leading-6 outline-none focus:ring-4", s.input)}
                        dir="auto"
                      />
                      <div className="grid grid-cols-2 gap-3">
                        <button type="button" onClick={() => setShowManualPrompts(!showManualPrompts)} disabled={manualAiBusy || aiImageBusy}
                          className={cn("inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-extrabold transition disabled:opacity-60", "border bg-slate-800/80 text-sky-300 hover:bg-slate-700 active:scale-95")}>
                          <ClipboardList className="size-4" />
                          {(t as any).aiManualPromptsBtn || "Promptları Gör"}
                        </button>
                        <button type="button" onClick={handleGenerateAiImages} disabled={aiImageBusy || manualAiBusy}
                          className={cn("inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-extrabold transition disabled:opacity-60", s.primary)}>
                          {aiImageBusy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                          {aiImageBusy ? t.aiImageGenerating : t.aiImageGenerate}
                        </button>
                      </div>

                      {showManualPrompts && (
                        <div className="mt-2 grid gap-3 border-t pt-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <h5 className={cn("text-xs font-bold", s.title)}>Manuel AI Kullanımı</h5>
                              <p className={cn("mt-0.5 text-[10px]", s.muted)}>Prompt ve referans görseli kopyalayıp harici AI aracına yapıştırın.</p>
                            </div>
                            <select 
                              value={selectedPromptIndex}
                              onChange={(e) => setSelectedPromptIndex(Number(e.target.value))}
                              className={cn("rounded-lg border px-2 py-1 text-xs font-bold outline-none", s.input)}
                            >
                              {[1,2,3,4,5,6].map((num) => (
                                <option key={num} value={num}>Prompt {num}</option>
                              ))}
                            </select>
                          </div>
                          
                          <div className="grid gap-3 sm:grid-cols-2">
                            {/* Image Section */}
                            <div className="grid gap-1">
                              <div className="flex items-center justify-between">
                                <span className={cn("text-[10px] font-bold", s.muted)}>Referans Görsel (Image 1)</span>
                                <button type="button" onClick={async () => {
                                  const imgName = selectedPromptIndex === 6 ? 'promt_2.png' : `promt_${selectedPromptIndex}.png`;
                                  try {
                                    const res = await fetch(`/prompts/${imgName}`);
                                    const blob = await res.blob();
                                    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
                                    showToast((t as any).btnCopied || "Kopyalandı", "success");
                                  } catch (err) {
                                    console.error(err);
                                    showToast(t.errors.ERR_GENERAL, "error");
                                  }
                                }}
                                  className="flex items-center gap-1 text-[10px] font-bold text-sky-400 hover:text-sky-300">
                                  <Copy className="size-3" /> Görseli Kopyala
                                </button>
                              </div>
                              <img src={`/prompts/${selectedPromptIndex === 6 ? 'promt_2' : `promt_${selectedPromptIndex}`}.png`} alt={`Prompt ${selectedPromptIndex}`} className="aspect-[2/3] w-full rounded-xl object-cover bg-black/10" />
                            </div>

                            {/* Prompt Text Section */}
                            <div className="grid gap-1">
                              <div className="flex items-center justify-between">
                                <span className={cn("text-[10px] font-bold", s.muted)}>Prompt Metni</span>
                                <button type="button" onClick={() => handleCopy(getGeneratedPrompt(selectedPromptIndex))}
                                  className="flex items-center gap-1 text-[10px] font-bold text-sky-400 hover:text-sky-300">
                                  <Copy className="size-3" /> Metni Kopyala
                                </button>
                              </div>
                              <div className="h-full max-h-[300px] overflow-y-auto rounded bg-black/10 p-3 text-[10px] font-mono leading-5 whitespace-pre-wrap select-all">
                                {getGeneratedPrompt(selectedPromptIndex)}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {!isImageLocked && (
                    <label className={cn("mb-3 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-4 py-4 text-center transition", s.dropzone)}>
                      <input className="sr-only" type="file" accept="image/*" multiple
                        onChange={(e) => {
                          const savedScroll = scrollRef.current?.scrollTop ?? 0;
                          const sel = Array.from(e.currentTarget.files ?? []);
                          const newPreviews = sel.map((f) => ({ name: f.name, url: URL.createObjectURL(f) }));
                          setImageFiles(sel);
                          setImagePreviews((c) => { c.forEach((p) => URL.revokeObjectURL(p.url)); return newPreviews; });
                          e.currentTarget.value = "";
                          requestAnimationFrame(() => { scrollRef.current?.scrollTo({ top: savedScroll, behavior: "auto" }); });
                        }} />
                      <span className={cn("mb-2 flex size-10 items-center justify-center rounded-xl ring-1", s.dropIcon)}>
                        <ImagePlus className="size-4" />
                      </span>
                      <span className={cn("text-sm font-extrabold", s.title)}>{t.addImages}</span>
                      <span className={cn("mt-0.5 text-xs", s.muted)}>{t.addImagesHelp}</span>
                    </label>
                  )}
                  
                  {imagePreviews.length > 0 && !isImageLocked && (
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {imagePreviews.map((prev) => (
                        <figure key={prev.name} className={cn("overflow-hidden rounded-xl border", s.panelBorder)}>
                          <img src={prev.url} alt={prev.name} className="aspect-square w-full object-cover" />
                        </figure>
                      ))}
                    </div>
                  )}
                </section>

                {/* Sil */}
                <section className={cn("rounded-xl border p-4", s.subPanel)}>
                  {!deleteConfirm ? (
                    <button type="button" onClick={() => setDeleteConfirm(true)}
                      className={cn("inline-flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-extrabold transition", s.error)}>
                      <Trash2 className="size-4" /> {t.deleteProduct}
                    </button>
                  ) : (
                    <div className="grid gap-3">
                      <p className={cn("text-sm font-bold", s.title)}>{t.deleteConfirmTitle}</p>
                      <p className={cn("text-xs leading-5", s.muted)}>{t.deleteConfirmText}</p>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setDeleteConfirm(false)}
                          className={cn("flex-1 rounded-xl border px-4 py-2.5 text-sm font-extrabold transition", s.controlGroup, s.controlIdle)}>
                          {t.deleteCancel}
                        </button>
                        <button type="button" onClick={handleDelete} disabled={busy}
                          className={cn("flex-1 inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-extrabold transition disabled:opacity-60", s.error)}>
                          {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                          {t.deleteConfirm}
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Lightbox */}
      {lightboxIdx !== null && record.images.length > 0 && (
        <ImageLightbox
          images={record.images}
          initialIndex={lightboxIdx}
          productId={record.id}
          onClose={() => setLightboxIdx(null)}
          onDelete={mode === "edit" && !isImageLocked ? handleDeleteImage : undefined}
          deletingFileName={deletingImage}
        />
      )}

      {/* Shopify Preview Modal */}
      {showShopifyPreview && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={() => setShowShopifyPreview(false)}>
          <div className={cn("w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden", s.panel)} onClick={(e) => e.stopPropagation()}>
            <div className={cn("flex items-center justify-between border-b px-4 py-3", s.panelBorder)}>
              <h2 className={cn("text-sm font-black flex items-center gap-2", s.title)}>
                <ShoppingBag className="size-4 text-emerald-500" />
                {t.shopifyPreviewTitle}
              </h2>
              <button type="button" onClick={() => setShowShopifyPreview(false)} className={cn("rounded-lg p-1 transition", s.controlIdle)}>
                <X className="size-4" />
              </button>
            </div>
            <div className="p-4 flex flex-col gap-3">
              <div className={cn("rounded-lg border px-3 py-2 text-xs font-extrabold", s.panelBorder, shopifySynced ? "text-teal-300" : "text-emerald-400")}>
                {shopifySynced ? t.shopifyWillUpdate : t.shopifyWillCreate}
              </div>
              <div className="text-sm">
                <span className={cn("font-bold", s.muted)}>{t.rawTitle}:</span> <span className={s.strong}>{p.titleRaw}</span>
              </div>
              <div className="text-sm">
                <span className={cn("font-bold", s.muted)}>{t.price}:</span> <span className={s.strong}>{formatPrice(p.priceAmount, p.currency)}</span>
              </div>
              <div className="text-sm">
                <span className={cn("font-bold", s.muted)}>{t.originalDescription || "Açıklama"}:</span> 
                <p className={cn("mt-1 whitespace-pre-wrap rounded-lg border p-2 text-xs", s.panelBorder, s.muted)}>{record.description}</p>
              </div>
              <div className="text-sm">
                <span className={cn("font-bold", s.muted)}>{t.size}:</span>
                <ul className="mt-1 flex flex-wrap gap-2">
                  {record.sizeStocks.map((sz) => (
                    <li key={sz.size} className={cn("rounded-md border px-2 py-0.5 text-xs font-bold", s.panelBorder, s.muted)}>
                      {sz.size} ({sz.qty})
                    </li>
                  ))}
                </ul>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className={cn("rounded-lg border px-3 py-2 text-xs font-bold", s.panelBorder, s.muted)}>
                  {t.shopifyImagesIncluded(shopifyImageCount)}
                </div>
                <div className={cn("rounded-lg border px-3 py-2 text-xs font-bold", s.panelBorder, s.muted)}>
                  {t.shopifyVariantsIncluded(record.sizeStocks.length || 1)}
                </div>
              </div>
              {record.shopify?.lastError && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-500" dir="auto">
                  {record.shopify.lastError}
                </div>
              )}
              
              <div className="mt-2 rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-xs font-bold text-red-500 flex items-start gap-2">
                <ArchiveRestore className="size-4 shrink-0" />
                <p>{t.shopifyPreviewWarning}</p>
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setShowShopifyPreview(false)} className={cn("px-4 py-2 text-xs font-bold rounded-lg border transition", s.controlIdle)}>
                  {t.close}
                </button>
                <button type="button" onClick={() => { setShowShopifyPreview(false); handlePushToShopify(); }} disabled={busy} className="bg-emerald-600 hover:bg-purple-500 text-white px-4 py-2 text-xs font-bold rounded-lg transition disabled:opacity-50">
                  {busy ? <Loader2 className="size-4 animate-spin" /> : (shopifySynced ? t.shopifyUpdateConfirm : t.shopifyConfirm)}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Share Options Modal */}
      {shareOptionsOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={() => setShareOptionsOpen(false)}>
          <div className={cn("w-full max-w-lg rounded-2xl border shadow-2xl flex flex-col max-h-[90vh]", s.panel)} onClick={(e) => e.stopPropagation()}>
            <div className={cn("flex items-center justify-between border-b px-5 py-4", s.panelBorder)}>
              <h2 className={cn("text-base font-extrabold flex items-center gap-2 tracking-tight", s.title)}>
                <Share2 className="size-4 text-emerald-500" />
                {(t as any).shareOptionsTitle || "Paylaşım Seçenekleri"}
              </h2>
              <button type="button" onClick={() => setShareOptionsOpen(false)} className={cn("rounded-lg p-2 transition", s.controlIdle)}>
                <X className="size-4" />
              </button>
            </div>
            
            <div className="p-5 overflow-y-auto space-y-6">
              {/* Info Options */}
              <div className="space-y-3">
                <h3 className={cn("text-xs font-bold uppercase tracking-wider", s.muted)}>{(t as any).shareInfoTitle || "Eklenecek Bilgiler"}</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {Object.entries(shareConfig).map(([k, v]) => (
                    <label key={k} className={cn("flex items-center gap-2 p-2 rounded-xl border cursor-pointer transition select-none", v ? "border-emerald-500/50 bg-emerald-500/10" : s.panelBorder)}>
                      <input 
                        type="checkbox" 
                        className="hidden"
                        checked={v}
                        onChange={(e) => setShareConfig(prev => ({ ...prev, [k]: e.target.checked }))}
                      />
                      <div className={cn("size-4 rounded-md flex items-center justify-center border transition-colors", v ? "bg-emerald-500 border-emerald-500 text-white" : s.panelBorder)}>
                        {v && <Check className="size-3" />}
                      </div>
                      <span className={cn("text-xs font-semibold capitalize", v ? s.title : s.muted)}>
                        {(t as any)["shareConfig_" + k] || shareConfigLabels[k] || k}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Image Options */}
              {record.images.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className={cn("text-xs font-bold uppercase tracking-wider", s.muted)}>{(t as any).shareImagesTitle || "Eklenecek Görseller"}</h3>
                    <button 
                      type="button" 
                      className={cn("text-[10px] font-bold uppercase px-2 py-1 rounded-md transition", s.controlIdle)}
                      onClick={() => {
                        if (shareImages.length === record.images.length) setShareImages([]);
                        else setShareImages(record.images.map(img => img.fileName));
                      }}
                    >
                      {shareImages.length === record.images.length ? "Tümünü Kaldır" : "Tümünü Seç"}
                    </button>
                  </div>
                  <div className="flex gap-3 overflow-x-auto pb-2 snap-x">
                    {record.images.map((img) => {
                      const selected = shareImages.includes(img.fileName);
                      return (
                        <div 
                          key={img.fileName} 
                          onClick={() => {
                            if (selected) setShareImages(prev => prev.filter(i => i !== img.fileName));
                            else setShareImages(prev => [...prev, img.fileName]);
                          }}
                          className={cn(
                            "relative size-24 shrink-0 rounded-xl overflow-hidden border-2 cursor-pointer snap-start transition-all",
                            selected ? "border-emerald-500 ring-4 ring-emerald-500/20" : s.panelBorder
                          )}
                        >
                          <img 
                            src={productImageUrl(record.id, img.fileName, "thumbnails", img.folder)} 
                            className="size-full object-cover"
                            alt="preview"
                          />
                          <div className={cn("absolute top-1 right-1 size-5 rounded-full flex items-center justify-center shadow-sm transition-colors", selected ? "bg-emerald-500 text-white" : "bg-white/80 dark:bg-black/80 text-transparent")}>
                            {selected && <Check className="size-3" />}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className={cn("p-4 border-t flex justify-end gap-2", s.panelBorder)}>
              <button 
                type="button" 
                onClick={() => setShareOptionsOpen(false)} 
                className={cn("px-4 py-2.5 text-xs font-bold rounded-xl transition", s.controlIdle)}
              >
                {(t as any).cancel || "İptal"}
              </button>
              <button 
                type="button" 
                onClick={handleShareExec}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-extrabold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white transition active:scale-95 shadow-lg shadow-emerald-500/20"
              >
                {shareBusy ? <Loader2 className="size-4 animate-spin" /> : <Share2 className="size-4" />}
                {(t as any).shareBtn || "Paylaş"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share Clipboard Modal (Desktop fallback) */}
      {shareClipboardText !== null && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={() => setShareClipboardText(null)}>
          <div className={cn("w-full max-w-lg rounded-2xl border shadow-2xl overflow-hidden", s.panel)} onClick={(e) => e.stopPropagation()}>
            <div className={cn("flex items-center justify-between border-b px-4 py-3", s.panelBorder)}>
              <h2 className={cn("text-sm font-black flex items-center gap-2", s.title)}>
                <Share2 className="size-4 text-emerald-500" />
                {(t as any).shareBtn || "Paylaş"}
              </h2>
              <button type="button" onClick={() => setShareClipboardText(null)} className={cn("rounded-lg p-1 transition", s.controlIdle)}>
                <X className="size-4" />
              </button>
            </div>
            <div className="grid gap-3 p-4">
              <p className={cn("text-xs leading-5", s.muted)}>
                {(t as any).shareDesktopHint || "Bilgisayarda direkt paylaşım desteklenmiyor. Ürün bilgileri panoya kopyalandı. Aşağıdan da kopyalayabilirsiniz:"}
              </p>
              <div className={cn("max-h-60 overflow-y-auto rounded-xl border p-3 text-xs font-mono leading-5 whitespace-pre-wrap select-all", s.panelBorder, s.muted)}>
                {shareClipboardText}
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShareClipboardText(null)} className={cn("px-4 py-2 text-xs font-bold rounded-lg border transition", s.controlIdle)}>
                  {t.close}
                </button>
                <button type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(shareClipboardText);
                      showToast((t as any).shareTextCopied || "Kopyalandı!", "success");
                    } catch { /* ignore */ }
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition">
                  <Copy className="size-3.5" />
                  {(t as any).btnCopy || "Kopyala"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </>, document.body
  );
}

// ── Yardımcı bileşenler ───────────────────────────────────────────────────────

function InfoRow({ label, s, children }: { label?: string; s?: ThemeStyles; children: React.ReactNode }) {
  if (!label) {
    return <div className="flex items-center gap-2 py-2">{children}</div>;
  }
  return (
    <div className="flex items-start gap-2 py-2">
      <span className={cn("w-28 shrink-0 text-xs font-black pt-0.5", s?.strong ?? "text-slate-400")}>{label}</span>
      <span className={cn("min-w-0 flex-1 text-sm font-semibold", s?.title ?? "text-white")}>{children}</span>
    </div>
  );
}

function canonicalSeasonValue(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/ş/g, "s");
  if (["summer", "yaz", "yazlik", "صيفي"].includes(normalized)) return "Summer";
  if (["winter", "kis", "kislik", "شتوي"].includes(normalized)) return "Winter";
  if (["spring", "ilkbahar", "ilkbaharlik", "mid-season", "midseason", "midsezon", "mevsimlik", "ربيعي", "خريفي", "محير"].includes(normalized)) return "Spring";
  return "";
}

function DetailField({ label, barcodeScanTitle, inputDir = "auto", onChange, prefix, s, type = "text", value }: {
  label: string; barcodeScanTitle?: string; onChange: (v: string) => void; s: ThemeStyles; type?: "number" | "text"; value: string; inputDir?: "auto" | "ltr" | "rtl"; prefix?: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className={cn("text-xs font-black", s.strong)}>{label}</span>
      <span className={cn("relative flex gap-2", barcodeScanTitle ? "items-center" : "block")}>
        {prefix ? (
          <span className={cn("pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-black", s.muted)}>
            {prefix}
          </span>
        ) : null}
        <input className={cn("min-h-11 min-w-0 flex-1 rounded-xl border px-3 text-sm font-semibold outline-none focus:ring-4", prefix && "pl-9", s.input)}
          type={type} min={type === "number" ? 0 : undefined}
          value={value} onChange={(e) => onChange(e.target.value)} dir={inputDir} />
        {barcodeScanTitle && <BarcodeScanButton s={s} title={barcodeScanTitle} onDetected={onChange} className="size-11 rounded-xl" />}
      </span>
    </label>
  );
}
