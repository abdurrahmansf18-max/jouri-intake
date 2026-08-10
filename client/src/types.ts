export type ProductStatus = "pending" | "ai_enhanced" | "published" | "sold_archive";

export interface ParsedProduct {
  titleRaw: string;
  categorySuggestion: string;
  productTypeSuggestion: string;
  priceAmount: string;
  currency: string;
  colorRaw: string;
  season: string;
  colorGermanSuggestion: string;
  sizesRaw: string;
  tags: string[];
}

export interface SavedImage {
  fileName: string;
  originalName: string;
  mimeType: string;
  size: number;
  relativePath: string;
  folder?: "originals" | "enhanced";  // Hangi klasörde olduğunu belirtir
}

export interface AiImageGenerateRequest {
  sourceFileName: string;
  sourceFolder?: "originals" | "enhanced";
  gender?: string;
  age?: string;
  size?: string;
  instructions?: string;
}

export interface ImageFolder { path: string; relativePath: string; }
export interface ImageFolders { originals: ImageFolder; enhanced: ImageFolder; }

export interface SizeStock {
  size: string;
  qty: number;
  code?: string;
}

export interface SoldSizeEntry {
  size: string;
  soldAt: string;
  note: string;
  source?: "manual" | "shopify" | string | null;
  orderName?: string | null;
}

export interface SaleRecord {
  soldAt: string;
  quantity: number;
  size?: string | null;
  note: string;
  source?: "manual" | "shopify" | string;
  orderId?: string | null;
  orderName?: string | null;
  lineItemId?: string | null;
}

export interface ShopifyVariantLink {
  size: string;
  variantId: string;
  inventoryItemId?: string | null;
  sku?: string | null;
}

export interface ShopifyOrderHistoryEntry {
  processedKey: string;
  orderId: string;
  orderName: string;
  lineItemId: string;
  variantId?: string | null;
  size?: string | null;
  quantity: number;
  status: string;
  message: string;
  syncedAt: string;
}

export interface ShopifySyncInfo {
  productId?: string | null;
  handle?: string | null;
  syncedAt?: string | null;
  lastInventorySyncAt?: string | null;
  lastOrderSyncAt?: string | null;
  lastError?: string | null;
  variants?: ShopifyVariantLink[];
  orderHistory?: ShopifyOrderHistoryEntry[];
}

export interface ProductRecord {
  id: string;
  productCode: string;
  createdAt: string;
  folderName: string;
  folderPath: string;
  imageFolders: ImageFolders;
  description: string;
  parsed: ParsedProduct;
  images: SavedImage[];
  status: ProductStatus;
  notes: string;
  isDiscounted: boolean;
  compareAtPriceAmount: string;
  discountNote: string;
  isFinalSale: boolean;
  isLimitedTimeDeal: boolean;
  stockQuantity: number;
  soldQuantity: number;
  lastSoldAt?: string | null;
  saleHistory: SaleRecord[];
  sizeStocks: SizeStock[];
  soldSizes: SoldSizeEntry[];
  relatedProducts: string[];
  shopify?: ShopifySyncInfo;
}

export interface ActivityLog {
  id: number;
  created_at: string;
  action: string;
  product_id: string | null;
  product_title: string | null;
  details: Record<string, unknown> | null;
}

export type Locale = "tr" | "ar";
export type Theme = "dark" | "light";
export type StatusFilter = ProductStatus | "all";

export type ToastType = "success" | "error";
export interface Toast {
  id: number;
  message: string;
  type: ToastType;
}
