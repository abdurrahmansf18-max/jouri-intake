import type { ActivityLog, AiImageGenerateRequest, ParsedProduct, ProductRecord, ProductStatus, SizeStock } from "./types";

// Kimlik doğrulama artık session cookie ile yapılıyor (TOTP)
export function getStoredCode(): string { return ""; }
export function storeCode(_code: string) {}
export function clearCode() {}

function headers(extra?: Record<string, string>): Record<string, string> {
  return { ...extra };
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let code = "ERR_GENERAL";
    try {
      const body = await res.json();
      if (body?.detail?.code) code = body.detail.code;
      else if (typeof body?.detail === "string") code = body.detail;
    } catch { /* ignore */ }
    throw new Error(code);
  }
  return res.json() as Promise<T>;
}

export async function verifyCode(code: string): Promise<boolean> {
  const res = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  return res.ok;
}

export async function isAuthRequired(): Promise<boolean> {
  const res = await fetch("/api/auth/required");
  const data = await res.json();
  return data.required;
}

export async function checkAuth(): Promise<boolean> {
  const res = await fetch("/api/auth/check");
  return res.ok;
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}

export async function verifyEditLock(code: string): Promise<boolean> {
  const res = await fetch("/api/auth/verify-edit-lock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  return res.ok;
}

export async function fetchProducts(): Promise<ProductRecord[]> {
  const res = await fetch("/api/products", { headers: headers() });
  return handleResponse<ProductRecord[]>(res);
}

export type AiParseProvider = "gemini" | "gemma" | "parser";

export async function parseProductText(text: string, imageFile?: File): Promise<{ parsed: ParsedProduct, description: string, variants?: any[], provider?: AiParseProvider }> {
  let imageBase64: string | undefined;
  let imageMimeType: string | undefined;
  if (imageFile) {
    imageMimeType = imageFile.type || "image/jpeg";
    const buffer = await imageFile.arrayBuffer();
    // Convert to base64 using btoa
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    imageBase64 = window.btoa(binary);
  }

  const res = await fetch("/api/parse-product", {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ text, imageBase64, imageMimeType }),
  });
  return handleResponse(res);
}

export interface ProductUpdate {
  notes?: string;
  stockQuantity?: number;
  description?: string;
  sizeStocks?: SizeStock[];
  parsed?: Partial<ParsedProduct>;
}

export async function createProduct(
  description: string,
  images: File[],
  details?: {
    notes?: string;
    sizeStocks?: SizeStock[];
    parsed?: Partial<ParsedProduct>;
  },
  source?: string,
): Promise<ProductRecord> {
  const form = new FormData();
  form.append("description", description);
  for (const img of images) form.append("images", img);
  if (source) form.append("source", source);
  if (details) {
    if (details.notes !== undefined) form.append("notes", details.notes);
    if (details.sizeStocks !== undefined) {
      form.append("sizeStocksJson", JSON.stringify(details.sizeStocks));
    }
    if (details.parsed) {
      for (const [key, value] of Object.entries(details.parsed)) {
        if (value !== undefined && value !== null && !Array.isArray(value)) {
          form.append(key, String(value));
        }
      }
    }
  }
  const res = await fetch("/api/products", {
    method: "POST",
    headers: headers(),
    body: form,
  });
  return handleResponse<ProductRecord>(res);
}

export async function updateStatus(productId: string, status: ProductStatus): Promise<ProductRecord> {
  const res = await fetch(`/api/products/${productId}/status`, {
    method: "PATCH",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ status }),
  });
  return handleResponse<ProductRecord>(res);
}

export async function updateProduct(productId: string, update: ProductUpdate): Promise<ProductRecord> {
  const res = await fetch(`/api/products/${productId}`, {
    method: "PATCH",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify(update),
  });
  return handleResponse<ProductRecord>(res);
}

export async function sellProduct(productId: string, quantity = 1, size = "", note = ""): Promise<ProductRecord> {
  const res = await fetch(`/api/products/${productId}/sell`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ quantity, size: size || undefined, note }),
  });
  return handleResponse<ProductRecord>(res);
}

export async function resetSales(productId: string, stockQuantity?: number): Promise<ProductRecord> {
  const res = await fetch(`/api/products/${productId}/sales/reset`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ stockQuantity }),
  });
  return handleResponse<ProductRecord>(res);
}

export async function updateRelatedProducts(productId: string, relatedIds: string[]): Promise<ProductRecord> {
  const res = await fetch(`/api/products/${productId}/related`, {
    method: "PATCH",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ relatedIds }),
  });
  return handleResponse<ProductRecord>(res);
}

export async function bulkUpdateProducts(ids: string[], updates: any): Promise<ProductRecord[]> {
  const res = await fetch("/api/products/bulk/update", {
    method: "PATCH",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ productIds: ids, ...updates }), // Updated to use productIds
  });
  return handleResponse<ProductRecord[]>(res);
}

export async function bulkPushToShopify(ids: string[]): Promise<{ success: boolean; results: any[] }> {
  const res = await fetch("/api/products/bulk/shopify-push", {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ productIds: ids }),
  });
  return handleResponse<{ success: boolean; results: any[] }>(res);
}

export async function getAiPrompts(
  productId: string,
  sourceFileName: string,
  instructions = "",
  gender = "",
  age = "",
  size = ""
): Promise<Record<string, string>> {
  const res = await fetch(`/api/products/${productId}/ai-prompts`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ sourceFileName, instructions, gender, age, size }),
  });
  return handleResponse<Record<string, string>>(res);
}


export async function restoreSize(productId: string, size: string): Promise<ProductRecord> {
  const res = await fetch(`/api/products/${productId}/restore-size`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ size }),
  });
  return handleResponse<ProductRecord>(res);
}

export async function restoreProduct(productId: string, stockQuantity = 1): Promise<ProductRecord> {
  const res = await fetch(`/api/products/${productId}/restore`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ stockQuantity }),
  });
  return handleResponse<ProductRecord>(res);
}

export async function addProductImages(productId: string, files: File[]): Promise<ProductRecord> {
  const form = new FormData();
  files.forEach((f) => form.append("images", f));
  const res = await fetch(`/api/products/${encodeURIComponent(productId)}/images`, {
    method: "POST",
    headers: headers(),
    body: form,
  });
  return handleResponse<ProductRecord>(res);
}

export async function enhanceProductImage(productId: string, fileName: string, prompt?: string): Promise<ProductRecord> {
  const res = await fetch(`/api/products/${encodeURIComponent(productId)}/images/ai-generate`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ sourceFileName: fileName, instructions: prompt || "" }),
  });
  return handleResponse<ProductRecord>(res);
}

export async function generateAiProductImages(
  productId: string,
  request: AiImageGenerateRequest,
): Promise<ProductRecord> {
  const res = await fetch(`/api/products/${encodeURIComponent(productId)}/images/ai-generate`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify(request),
  });
  return handleResponse<ProductRecord>(res);
}

export async function pushToShopify(productId: string): Promise<ProductRecord> {
  const res = await fetch(`/api/products/${encodeURIComponent(productId)}/shopify-push`, {
    method: "POST",
    headers: headers(),
  });
  return handleResponse<ProductRecord>(res);
}

export async function rewriteDescription(productId: string): Promise<{ description: string }> {
  const res = await fetch(`/api/products/${encodeURIComponent(productId)}/rewrite-description`, {
    method: "POST",
    headers: headers(),
  });
  return handleResponse<{ description: string }>(res);
}

export async function deleteProductImage(
  productId: string,
  kind: "originals" | "enhanced",
  fileName: string,
): Promise<ProductRecord> {
  const res = await fetch(
    `/api/products/${encodeURIComponent(productId)}/images/${kind}/${encodeURIComponent(fileName)}`,
    { method: "DELETE", headers: headers() },
  );
  return handleResponse<ProductRecord>(res);
}

export async function markProductImageAsAi(productId: string, fileName: string): Promise<ProductRecord> {
  const res = await fetch(
    `/api/products/${encodeURIComponent(productId)}/images/originals/${encodeURIComponent(fileName)}/mark-ai`,
    { method: "PATCH", headers: headers() },
  );
  return handleResponse<ProductRecord>(res);
}


export async function deleteProduct(productId: string): Promise<void> {
  const res = await fetch(`/api/products/${productId}`, {
    method: "DELETE",
    headers: headers(),
  });
  await handleResponse<{ ok: boolean }>(res);
}

export async function fetchLogs(limit = 50): Promise<ActivityLog[]> {
  const res = await fetch(`/api/logs?limit=${limit}`, { headers: headers() });
  return handleResponse<ActivityLog[]>(res);
}

export async function deleteLog(logId: number): Promise<void> {
  const res = await fetch(`/api/logs/${logId}`, { method: "DELETE", headers: headers() });
  await handleResponse(res);
}

export interface BackupEntry {
  date: string;
  db_size: string;
  db_sql_size?: string;
  db_json_size?: string;
  db_primary?: "db.sql" | "db.json";
  img_size: string;
}

export interface BackupStatus {
  last_run?: string;
  last_date?: string;
  last_db_size?: string;
  last_db_sql_size?: string;
  last_db_json_size?: string;
  last_db_sql_error?: string | null;
  last_img_size?: string;
  drive_ok?: boolean;
  drive_error?: string | null;
  running?: boolean;
  running_started_at?: string | null;
  backups?: BackupEntry[];
}

export async function fetchBackups(): Promise<{ status: BackupStatus; backups: BackupEntry[]; drive_backups: string[] }> {
  const res = await fetch("/api/backups", { headers: headers() });
  return handleResponse(res);
}

export async function deleteBackup(date: string): Promise<void> {
  const res = await fetch(`/api/backups/${date}`, { method: "DELETE", headers: headers() });
  await handleResponse(res);
}

export async function deleteDriveBackup(date: string): Promise<void> {
  const res = await fetch(`/api/backups/drive/${date}`, { method: "DELETE", headers: headers() });
  await handleResponse(res);
}

export async function runBackup(): Promise<{ status: BackupStatus; backups: BackupEntry[]; drive_backups: string[] }> {
  const res = await fetch("/api/backups/run", { method: "POST", headers: headers() });
  return handleResponse(res);
}

export function productImageUrl(
  productId: string,
  fileName: string,
  kind?: "originals" | "enhanced" | "thumbnails",
  folder?: "originals" | "enhanced" | "thumbnails"
): string {
  // Öncelik sırası: açık kind parametresi > folder alanı > ai_ prefix tespiti > varsayılan thumbnails
  const resolvedKind = kind ?? folder ?? (fileName.startsWith("ai_") || fileName.startsWith("ai-") ? "enhanced" : "thumbnails");
  return `/api/products/${encodeURIComponent(productId)}/images/${resolvedKind}/${encodeURIComponent(fileName)}`;
}
