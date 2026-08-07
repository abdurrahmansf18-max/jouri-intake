import { QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  fetchBackups,
  fetchLogs,
  fetchProducts,
  type BackupEntry,
  type BackupStatus,
} from "./api";
import { useProductSync } from "./hooks/useProductSync";
import type { ActivityLog, ProductRecord } from "./types";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 30,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export const queryKeys = {
  products: ["products"] as const,
  logsRoot: ["logs"] as const,
  logs: (limit: number) => ["logs", limit] as const,
  backups: ["backups"] as const,
};

export type BackupOverview = {
  status: BackupStatus;
  backups: BackupEntry[];
  drive_backups: string[];
};

export function useProductsQuery() {
  return useQuery<ProductRecord[]>({
    queryKey: queryKeys.products,
    queryFn: fetchProducts,
  });
}

export function useLogsQuery(limit = 50) {
  return useQuery<ActivityLog[]>({
    queryKey: queryKeys.logs(limit),
    queryFn: () => fetchLogs(limit),
  });
}

export function useBackupsQuery() {
  return useQuery<BackupOverview>({
    queryKey: queryKeys.backups,
    queryFn: fetchBackups,
    staleTime: 1000 * 30,
  });
}

export function useProductCacheActions() {
  const client = useQueryClient();
  return {
    upsertProduct(product: ProductRecord) {
      client.setQueryData<ProductRecord[]>(queryKeys.products, (current: ProductRecord[] | undefined) => mergeProductIntoList(current ?? [], product));
    },
    removeProduct(id: string) {
      client.setQueryData<ProductRecord[]>(queryKeys.products, (current: ProductRecord[] | undefined) => (current ?? []).filter((p: ProductRecord) => p.id !== id));
    },
    invalidateProducts() {
      client.invalidateQueries({ queryKey: queryKeys.products });
    },
  };
}

export function useProductCacheSync() {
  const actions = useProductCacheActions();
  const client = useQueryClient();
  const refreshLogs = () => {
    client.invalidateQueries({ queryKey: queryKeys.logsRoot });
  };
  useProductSync({
    onProductUpdated(product) {
      actions.upsertProduct(product);
      refreshLogs();
    },
    onProductCreated(product) {
      actions.upsertProduct(product);
      refreshLogs();
    },
    onProductDeleted(id) {
      actions.removeProduct(id);
      refreshLogs();
    },
  });
}

export function mergeProductIntoList(products: ProductRecord[], product: ProductRecord): ProductRecord[] {
  const exists = products.some((p) => p.id === product.id);
  if (exists) {
    return products.map((p) => (p.id === product.id ? product : p));
  }
  return [product, ...products];
}
