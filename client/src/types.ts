export type ProductStatus = "pending" | "ai_enhanced" | "published" | "sold_archive";

export interface ParsedProduct {
  titleRaw: string;
  categorySuggestion: string;
  productTypeSuggestion: string;
  priceAmount: string;
  currency: string;
  colorRaw: string;
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
}

export interface ImageFolder { path: string; relativePath: string; }
export interface ImageFolders { originals: ImageFolder; enhanced: ImageFolder; }

export interface SizeStock {
  size: string;
  qty: number;
}

export interface SaleRecord {
  soldAt: string;
  quantity: number;
  size?: string | null;
  note: string;
}

export interface ProductRecord {
  id: string;
  createdAt: string;
  folderName: string;
  folderPath: string;
  imageFolders: ImageFolders;
  description: string;
  parsed: ParsedProduct;
  images: SavedImage[];
  status: ProductStatus;
  notes: string;
  stockQuantity: number;
  soldQuantity: number;
  lastSoldAt?: string | null;
  saleHistory: SaleRecord[];
  sizeStocks: SizeStock[];
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
