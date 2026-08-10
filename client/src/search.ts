import { normalizeCategory, normalizeProductType, normalizeText, searchTokens } from "./i18n";
import type { ProductRecord } from "./types";

export interface ProductSearchMatch {
  key: string;
  label: string;
  value: string;
  score: number;
}

export interface ProductSearchResult {
  record: ProductRecord;
  matches: ProductSearchMatch[];
  score: number;
}

interface SearchField {
  key: string;
  label: string;
  value: string;
  weight: number;
}

const FIELD_LABELS: Record<string, string> = {
  product_code: "Product code",
  title: "Title",
  season: "Season",
  category: "Category",
  product_type: "Product type",
  color: "Color",
  german_color: "German color",
  sizes: "Sizes",
  price: "Price",
  tags: "Tags",
  notes: "Notes",
  description: "Description",
  sold_sizes: "Sold sizes",
};

const TOKEN_ALIASES: Record<string, string[]> = {
  summer: ["summer", "yaz", "yazlik", "صيفي"],
  yaz: ["summer", "yaz", "yazlik", "صيفي"],
  yazlik: ["summer", "yaz", "yazlik", "صيفي"],
  winter: ["winter", "kis", "kislik", "شتوي"],
  kis: ["winter", "kis", "kislik", "شتوي"],
  kislik: ["winter", "kis", "kislik", "شتوي"],
  spring: ["spring", "ilkbahar", "ilkbaharlik", "ربيعي"],
  ilkbahar: ["spring", "ilkbahar", "ilkbaharlik", "ربيعي"],
  ilkbaharlik: ["spring", "ilkbahar", "ilkbaharlik", "ربيعي"],
  boys: ["boys", "boy", "erkek", "ولادي"],
  boy: ["boys", "boy", "erkek", "ولادي"],
  erkek: ["boys", "boy", "erkek", "ولادي"],
  girls: ["girls", "girl", "kiz", "بناتي"],
  girl: ["girls", "girl", "kiz", "بناتي"],
  kiz: ["girls", "girl", "kiz", "بناتي"],
  baby: ["baby", "bebe", "bebek", "newborn", "بيبي"],
  bebe: ["baby", "bebe", "bebek", "newborn", "بيبي"],
  bebek: ["baby", "bebe", "bebek", "newborn", "بيبي"],
};

function cleanValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.filter(Boolean).join(" ");
  return String(value).trim();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => normalizeText(v)).filter(Boolean)));
}

function expandedTokens(query: string): string[][] {
  return searchTokens(query).map((token) => unique([token, ...(TOKEN_ALIASES[token] ?? [])]));
}

export function buildProductSearchFields(record: ProductRecord, includeArchiveFields = false): SearchField[] {
  const p = record.parsed;
  const sizes = [
    p.sizesRaw,
    record.sizeStocks.map((s) => `${s.size} ${s.qty}`).join(" "),
  ].filter(Boolean).join(" ");
  const sizeCodes = record.sizeStocks.map((s) => s.code).filter(Boolean).join(" ");

  const fields: SearchField[] = [
    { key: "product_code", label: FIELD_LABELS.product_code, value: cleanValue([record.productCode, sizeCodes].filter(Boolean).join(" ")), weight: 160 },
    { key: "title", label: FIELD_LABELS.title, value: cleanValue(p.titleRaw), weight: 120 },
    { key: "season", label: FIELD_LABELS.season, value: cleanValue(p.season), weight: 110 },
    { key: "category", label: FIELD_LABELS.category, value: cleanValue(normalizeCategory(p.categorySuggestion)), weight: 100 },
    { key: "product_type", label: FIELD_LABELS.product_type, value: cleanValue(normalizeProductType(p.productTypeSuggestion)), weight: 95 },
    { key: "color", label: FIELD_LABELS.color, value: cleanValue(p.colorRaw), weight: 85 },
    { key: "german_color", label: FIELD_LABELS.german_color, value: cleanValue(p.colorGermanSuggestion), weight: 75 },
    { key: "sizes", label: FIELD_LABELS.sizes, value: cleanValue(sizes), weight: 70 },
    { key: "price", label: FIELD_LABELS.price, value: cleanValue([p.priceAmount, p.currency].filter(Boolean).join(" ")), weight: 65 },
    { key: "tags", label: FIELD_LABELS.tags, value: cleanValue(p.tags), weight: 55 },
    { key: "notes", label: FIELD_LABELS.notes, value: cleanValue(record.notes), weight: 45 },
    { key: "description", label: FIELD_LABELS.description, value: cleanValue(record.description), weight: 30 },
  ];

  if (includeArchiveFields) {
    fields.push({
      key: "sold_sizes",
      label: FIELD_LABELS.sold_sizes,
      value: cleanValue(record.soldSizes.map((s) => [s.size, s.note].filter(Boolean).join(" "))),
      weight: 80,
    });
  }

  return fields.filter((field) => field.value);
}

export function matchProductSearch(record: ProductRecord, query: string, includeArchiveFields = false): ProductSearchResult | null {
  const tokenGroups = expandedTokens(query);
  if (!tokenGroups.length) return { record, matches: [], score: 0 };

  const fields = buildProductSearchFields(record, includeArchiveFields);
  const matchesByKey = new Map<string, ProductSearchMatch>();
  let score = 0;

  for (const group of tokenGroups) {
    const tokenMatches: ProductSearchMatch[] = [];

    for (const field of fields) {
      const normalizedValue = normalizeText(field.value);
      const matchedToken = group.find((token) => normalizedValue.includes(token));
      if (!matchedToken) continue;

      const exact = normalizedValue === matchedToken;
      const starts = normalizedValue.startsWith(matchedToken);
      const fieldScore = field.weight + (exact ? 35 : starts ? 15 : 0);
      tokenMatches.push({ key: field.key, label: field.label, value: field.value, score: fieldScore });
    }

    if (!tokenMatches.length) return null;

    tokenMatches.sort((a, b) => b.score - a.score);
    const best = tokenMatches[0];
    score += best.score;

    for (const match of tokenMatches.slice(0, 3)) {
      const previous = matchesByKey.get(match.key);
      if (!previous || match.score > previous.score) {
        matchesByKey.set(match.key, match);
      }
    }
  }

  const matches = Array.from(matchesByKey.values()).sort((a, b) => b.score - a.score).slice(0, 4);
  return { record, matches, score };
}

export function searchProducts(records: ProductRecord[], query: string, includeArchiveFields = false): ProductSearchResult[] {
  const tokenGroups = expandedTokens(query);
  if (!tokenGroups.length) return records.map((record) => ({ record, matches: [], score: 0 }));

  return records
    .map((record) => matchProductSearch(record, query, includeArchiveFields))
    .filter((result): result is ProductSearchResult => !!result)
    .sort((a, b) => b.score - a.score || b.record.createdAt.localeCompare(a.record.createdAt));
}
