import type { ActivityLog, ParsedProduct, ProductRecord, ProductStatus } from "./types";

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

export async function fetchProducts(): Promise<ProductRecord[]> {
  const res = await fetch("/api/products", { headers: headers() });
  return handleResponse<ProductRecord[]>(res);
}

export interface ProductUpdate {
  notes?: string;
  stockQuantity?: number;
  parsed?: Partial<ParsedProduct>;
}

export async function createProduct(
  description: string,
  images: File[],
  details?: ProductUpdate & { titleRaw?: string; priceAmount?: string; colorRaw?: string; sizesRaw?: string; stockQuantity?: number }
): Promise<ProductRecord> {
  const form = new FormData();
  form.append("description", description);
  for (const img of images) form.append("images", img);
  if (details) {
    if (details.notes !== undefined) form.append("notes", details.notes);
    if (details.stockQuantity !== undefined) form.append("stockQuantity", String(details.stockQuantity));
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

export async function sellProduct(productId: string, quantity = 1, note = ""): Promise<ProductRecord> {
  const res = await fetch(`/api/products/${productId}/sell`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ quantity, note }),
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

export async function restoreProduct(productId: string, stockQuantity = 1): Promise<ProductRecord> {
  const res = await fetch(`/api/products/${productId}/restore`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ stockQuantity }),
  });
  return handleResponse<ProductRecord>(res);
}

export async function addProductImages(productId: string, images: File[]): Promise<ProductRecord> {
  const form = new FormData();
  for (const img of images) form.append("images", img);
  const res = await fetch(`/api/products/${productId}/images`, {
    method: "POST",
    headers: headers(),
    body: form,
  });
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
  img_size: string;
}

export interface BackupStatus {
  last_run?: string;
  last_date?: string;
  last_db_size?: string;
  last_img_size?: string;
  drive_ok?: boolean;
  backups?: BackupEntry[];
}

export async function fetchBackups(): Promise<{ status: BackupStatus; backups: BackupEntry[] }> {
  const res = await fetch("/api/backups", { headers: headers() });
  return handleResponse(res);
}

export async function deleteBackup(date: string): Promise<void> {
  const res = await fetch(`/api/backups/${date}`, { method: "DELETE", headers: headers() });
  await handleResponse(res);
}

export function productImageUrl(
  productId: string,
  fileName: string,
  kind: "originals" | "enhanced" = "originals"
): string {
  return `/api/products/${encodeURIComponent(productId)}/images/${kind}/${encodeURIComponent(fileName)}`;
}
