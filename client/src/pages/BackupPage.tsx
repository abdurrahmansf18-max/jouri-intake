import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  CloudUpload,
  Database,
  FileText,
  HardDrive,
  Images,
  Layers3,
  Loader2,
  RefreshCw,
  Save,
  Server,
  Trash2,
} from "lucide-react";
import { deleteBackup, deleteDriveBackup, runBackup } from "../api";
import { useApp } from "../context";
import { COPY, cn } from "../i18n";
import { DARK, LIGHT } from "../theme";
import { queryKeys, useBackupsQuery, type BackupOverview } from "../queries";

type DriveState = "unknown" | "ok" | "fail";

export default function BackupPage() {
  const { locale, theme, showToast } = useApp();
  const t = COPY[locale];
  const s = theme === "dark" ? DARK : LIGHT;

  const [deleting, setDeleting] = useState<string | null>(null);
  const [deletingDrive, setDeletingDrive] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const queryClient = useQueryClient();
  const backupsQuery = useBackupsQuery();

  const dateLocale = locale === "ar" ? "ar" : "tr-TR";
  const status = backupsQuery.data?.status ?? {};
  const dbStatus = status.database ?? {};
  const storage = status.storage ?? {};
  const backups = backupsQuery.data?.backups ?? [];
  const driveBackups = backupsQuery.data?.drive_backups ?? [];
  const loading = backupsQuery.isLoading;
  const running = starting || !!status.running;
  const refetchBackups = backupsQuery.refetch;

  useEffect(() => {
    if (!status.running) return;
    const timer = window.setInterval(() => {
      refetchBackups();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [refetchBackups, status.running]);

  async function handleRunBackup() {
    setStarting(true);
    try {
      const data = await runBackup();
      queryClient.setQueryData(queryKeys.backups, data);
      if (data.status.running) {
        showToast(t.backupManualStarted, "success");
      } else if (data.status.last_db_sql_error) {
        showToast(t.backupManualSqlFail, "error");
      } else if (data.status.drive_ok === false) {
        showToast(t.backupManualPartialFail, "error");
      } else {
        showToast(t.backupManualDone, "success");
      }
    } catch {
      showToast(t.backupManualFail, "error");
    } finally {
      setStarting(false);
    }
  }

  async function handleDelete(date: string) {
    if (!window.confirm(t.backupDeleteConfirm)) return;
    setDeleting(date);
    try {
      await deleteBackup(date);
      queryClient.setQueryData<BackupOverview>(queryKeys.backups, (current) => current
        ? { ...current, backups: current.backups.filter((b) => b.date !== date) }
        : current);
      showToast(t.backupDeleted, "success");
    } catch {
      showToast(t.errors.ERR_GENERAL, "error");
    } finally {
      setDeleting(null);
    }
  }

  async function handleDeleteDrive(date: string) {
    if (!window.confirm(t.backupDriveDeleteConfirm)) return;
    setDeletingDrive(date);
    try {
      await deleteDriveBackup(date);
      queryClient.setQueryData<BackupOverview>(queryKeys.backups, (current) => current
        ? { ...current, drive_backups: current.drive_backups.filter((d) => d !== date) }
        : current);
      showToast(t.backupDriveDeleted, "success");
    } catch {
      showToast(t.errors.ERR_GENERAL, "error");
    } finally {
      setDeletingDrive(null);
    }
  }

  const hasStatus = !!status.last_run;
  const driveState: DriveState = !hasStatus || status.drive_ok == null
    ? "unknown"
    : status.drive_ok
      ? "ok"
      : "fail";
  const driveStorageText = driveState === "ok"
    ? t.backupDriveStorage
    : driveState === "fail"
      ? t.backupDriveStorageFail
      : t.backupDriveStorageUnknown;
  const dbSqlSize = storage.database?.last_sql_size ?? status.last_db_sql_size ?? status.last_db_size ?? "-";
  const dbJsonSize = storage.database?.last_json_size ?? status.last_db_json_size ?? "-";
  const photoFiles = storage.vps?.last_photo_files ?? status.last_photo_files;
  const photoUnique = storage.vps?.last_photo_unique_blobs ?? status.last_photo_unique_blobs;
  const photoDedupeText = photoFiles && photoUnique ? `${photoUnique}/${photoFiles}` : "-";
  const localizedDriveError = localizeDriveError(status.drive_error, locale);
  const driveErrorText = localizedDriveError && localizedDriveError.length > 120
    ? `${localizedDriveError.slice(0, 120)}...`
    : localizedDriveError;
  const lastRunText = hasStatus
    ? new Date(status.last_run!).toLocaleString(dateLocale)
    : t.backupNever;
  const runningStepText = stepLabel(status.running_step, t);
  const statusOrder = ["pending", "ai_enhanced", "published", "sold_archive"];
  const productsByStatus = dbStatus.products_by_status ?? {};

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className={cn("text-2xl font-black tracking-tight", s.title)}>{t.backupTitle}</h1>
          <p className={cn("mt-1 text-sm font-semibold", s.muted)}>{t.backupPageSubtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleRunBackup}
            disabled={running || loading}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-extrabold transition",
              "border-violet-400/30 bg-violet-400/10 text-violet-300 hover:bg-violet-400/20 active:scale-95 disabled:opacity-50",
            )}
          >
            {running ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            <span>{running ? t.backupRunning : t.backupRunManual}</span>
          </button>
          <button
            type="button"
            onClick={() => backupsQuery.refetch()}
            disabled={loading || backupsQuery.isFetching}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-extrabold transition",
              s.controlGroup, s.controlIdle,
            )}
          >
            <RefreshCw className={cn("size-4", (loading || backupsQuery.isFetching) && "animate-spin")} />
            <span>{t.backupRefresh}</span>
          </button>
        </div>
      </div>

      {running ? (
        <section className={cn("rounded-xl border px-4 py-3 sm:px-5", s.subPanel)}>
          <div className="flex flex-wrap items-center gap-3">
            <Loader2 className="size-4 animate-spin text-violet-300" />
            <div className="min-w-0">
              <div className={cn("text-sm font-black", s.title)}>{t.backupLiveStatusTitle}</div>
              <div className={cn("mt-0.5 text-xs font-semibold", s.muted)}>{runningStepText}</div>
            </div>
          </div>
        </section>
      ) : null}

      <section className={cn("rounded-xl border", s.panel)}>
        <div className={cn("grid divide-y md:grid-cols-4 md:divide-x md:divide-y-0", s.divider)}>
          <MetricBlock
            icon={<Clock className="size-4" />}
            label={t.backupLastRun}
            value={lastRunText}
            detail={running ? runningStepText : t.backupSchedule}
            accent="text-violet-300"
            s={s}
          />
          <MetricBlock
            icon={<Database className="size-4" />}
            label={t.backupDb}
            value={dbSqlSize}
            detail={`${t.backupJsonExport}: ${dbJsonSize}`}
            accent="text-emerald-300"
            s={s}
          />
          <MetricBlock
            icon={<Server className="size-4" />}
            label={t.backupLocalSnapshot}
            value={`${backups.length}`}
            detail={`${t.backupImages}: ${storage.vps?.last_photo_size ?? status.last_img_size ?? "-"}`}
            accent="text-amber-300"
            s={s}
          />
          <MetricBlock
            icon={<CloudUpload className="size-4" />}
            label={t.backupDrive}
            value={driveState === "unknown" ? "-" : driveState === "ok" ? t.backupOk : t.backupFail}
            detail={driveStorageText}
            accent={driveState === "fail" ? "text-red-300" : "text-sky-300"}
            s={s}
          />
        </div>
        {driveState === "fail" && driveErrorText ? (
          <div className={cn("border-t px-4 py-3 text-xs font-semibold leading-5 text-red-400 sm:px-5", s.panelBorder)}>
            {t.backupDriveErrorPrefix} {driveErrorText}
          </div>
        ) : null}
      </section>

      <section className={cn("rounded-xl border", s.panel)}>
        <div className={cn("border-b px-4 py-4 sm:px-5", s.panelBorder)}>
          <h2 className={cn("text-base font-extrabold", s.title)}>{t.backupStorageTitle}</h2>
          <p className={cn("mt-1 text-xs font-semibold leading-5", s.muted)}>{t.backupStorageSubtitle}</p>
        </div>

        <div className={cn("grid divide-y lg:grid-cols-3 lg:divide-x lg:divide-y-0", s.divider)}>
          <StorageCard
            icon={<Database className="size-5" />}
            title={t.backupStorageDatabase}
            status={t.backupLiveData}
            rows={[
              [t.backupStorageEngine, storage.database?.engine ?? "PostgreSQL"],
              [t.backupStorageContains, storeLabels(storage.database?.stores, t).join(", ")],
              [t.backupStorageTables, (storage.database?.tables ?? ["products", "activity_logs"]).join(", ")],
              [t.backupStorageSize, `db.sql ${dbSqlSize} / db.json ${dbJsonSize}`],
            ]}
            chips={statusOrder.map((key) => `${statusLabel(key, t)} ${productsByStatus[key] ?? 0}`)}
            s={s}
          />
          <StorageCard
            icon={<HardDrive className="size-5" />}
            title={t.backupStorageVps}
            status={`${backups.length} ${t.backupRestorePointShort}`}
            rows={[
              [t.backupStoragePath, storage.vps?.root ?? "/backups/YYYY-MM-DD"],
              [t.backupStorageContains, (storage.vps?.files ?? []).join(", ")],
              [t.backupImages, `${storage.vps?.last_photo_size ?? status.last_img_size ?? "-"} / ${photoDedupeText}`],
            ]}
            chips={[t.backupLocalStorage, t.backupStorageSnapshotMode]}
            s={s}
          />
          <StorageCard
            icon={<CloudUpload className="size-5" />}
            title={t.backupStorageDrive}
            status={`${driveBackups.length} ${t.backupRestorePointShort}`}
            rows={[
              [t.backupStoragePath, storage.drive?.root ?? "gdrive:jouri-backups"],
              [t.backupStorageLayout, storage.drive?.layout ?? status.drive_layout ?? "-"],
              [t.backupStorageDbPath, storage.drive?.db_path ?? status.drive_db_path ?? "-"],
              [t.backupStorageManifestPath, storage.drive?.manifest_path ?? status.drive_manifest_path ?? "-"],
              [t.backupStoragePhotoPath, storage.drive?.photos_path ?? status.drive_photos_path ?? "-"],
            ]}
            chips={[t.backupDriveSmartLayout, dedupeLabel(storage.drive?.dedupe, t)]}
            s={s}
          />
        </div>

        <div className={cn("border-t px-4 py-4 sm:px-5", s.panelBorder)}>
          <div className="grid gap-2 md:grid-cols-4">
            {(storage.workflow ?? ["database_dump", "local_snapshot", "photo_manifest", "drive_sync"]).map((step) => (
              <div key={step} className={cn("rounded-lg px-3 py-2 text-xs font-bold leading-5 ring-1", s.pill)}>
                {workflowLabel(step, t)}
              </div>
            ))}
          </div>
        </div>
      </section>

      <BackupList
        title={t.backupAvailable}
        icon={<HardDrive className="size-4 text-violet-400" />}
        count={backups.length}
        loading={loading}
        emptyText={t.backupEmpty}
        emptyIcon={<HardDrive className={cn("size-10", s.emptyIcon)} />}
        s={s}
      >
        {backups.map((b) => (
          <div
            key={b.date}
            className={cn(
              "grid gap-3 border-b px-4 py-4 last:border-b-0 sm:grid-cols-[minmax(8rem,1fr)_auto_auto] sm:items-center sm:px-5",
              s.panelBorder
            )}
          >
            <div className="min-w-0">
              <div className={cn("whitespace-nowrap text-sm font-extrabold", s.title)}>{b.date}</div>
              <div className={cn("mt-1 text-xs font-semibold", s.muted)}>{t.backupLocalSnapshot}</div>
            </div>
            <div className="grid gap-2 text-xs sm:flex sm:items-center sm:gap-4">
              <FileMetric icon={<Database className="size-3.5" />} label={`db.sql ${b.db_sql_size ?? b.db_size}`} s={s} />
              <FileMetric icon={<FileText className="size-3.5" />} label={`db.json ${b.db_json_size ?? "-"}`} s={s} />
              <FileMetric icon={<Images className="size-3.5" />} label={b.img_size} s={s} />
              {b.photo_files && b.photo_unique_blobs ? (
                <FileMetric icon={<Layers3 className="size-3.5" />} label={`${b.photo_files}/${b.photo_unique_blobs}`} s={s} />
              ) : null}
            </div>
            <DeleteButton
              label={t.backupDelete}
              loading={deleting === b.date}
              onClick={() => handleDelete(b.date)}
              s={s}
            />
          </div>
        ))}
      </BackupList>

      <BackupList
        title={t.backupDriveAvailable}
        icon={<CloudUpload className="size-4 text-sky-400" />}
        count={driveBackups.length}
        loading={loading}
        emptyText={t.backupDriveEmpty}
        emptyIcon={<CloudUpload className={cn("size-10", s.emptyIcon)} />}
        s={s}
      >
        {driveBackups.map((date) => (
          <div
            key={date}
            className={cn(
              "grid gap-3 border-b px-4 py-4 last:border-b-0 sm:grid-cols-[minmax(8rem,1fr)_auto_auto] sm:items-center sm:px-5",
              s.panelBorder
            )}
          >
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <CloudUpload className="size-3.5 shrink-0 text-sky-400" />
                <span className={cn("truncate text-sm font-extrabold", s.title)}>{date}</span>
              </div>
              <div className={cn("mt-1 text-xs font-semibold", s.muted)}>{t.backupRestorePointShort}</div>
            </div>
            <div className="grid gap-2 text-xs sm:flex sm:items-center sm:gap-4">
              <FileMetric icon={<Database className="size-3.5" />} label="db.sql / db.json" s={s} />
              <FileMetric icon={<FileText className="size-3.5" />} label="manifest" s={s} />
              <FileMetric icon={<Images className="size-3.5" />} label={t.backupPhotoPoolShort} s={s} />
            </div>
            <DeleteButton
              label={t.backupDelete}
              loading={deletingDrive === date}
              onClick={() => handleDeleteDrive(date)}
              s={s}
            />
          </div>
        ))}
      </BackupList>
    </div>
  );
}

function MetricBlock({
  icon,
  label,
  value,
  detail,
  accent,
  s,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  accent: string;
  s: typeof DARK | typeof LIGHT;
}) {
  return (
    <div className="min-w-0 p-4 sm:p-5">
      <div className={cn("mb-2 flex items-center gap-2 text-xs font-bold", s.muted)}>
        <span className={accent}>{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className={cn("truncate text-xl font-black leading-7", accent)}>{value}</div>
      <div className={cn("mt-1 line-clamp-2 text-xs font-semibold leading-5", s.muted)}>{detail}</div>
    </div>
  );
}

function StorageCard({
  icon,
  title,
  status,
  rows,
  chips,
  s,
}: {
  icon: React.ReactNode;
  title: string;
  status: string;
  rows: Array<[string, string]>;
  chips: string[];
  s: typeof DARK | typeof LIGHT;
}) {
  return (
    <div className="min-w-0 p-4 sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className={cn("grid size-10 shrink-0 place-items-center rounded-lg ring-1", s.iconBox)}>
            {icon}
          </div>
          <div className="min-w-0">
            <div className={cn("truncate text-sm font-extrabold", s.title)}>{title}</div>
            <div className={cn("mt-0.5 text-xs font-semibold", s.muted)}>{status}</div>
          </div>
        </div>
      </div>
      <div className="grid gap-2">
        {rows.filter(([, value]) => !!value && value !== "-").map(([label, value]) => (
          <div key={label} className="min-w-0">
            <div className={cn("text-[11px] font-black uppercase", s.muted)}>{label}</div>
            <div className={cn("mt-0.5 break-words text-xs font-semibold leading-5", s.title)}>{value}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {chips.filter(Boolean).map((chip) => (
          <span key={chip} className={cn("rounded-md px-2 py-1 text-[11px] font-black ring-1", s.pill)}>
            {chip}
          </span>
        ))}
      </div>
    </div>
  );
}

function BackupList({
  title,
  icon,
  count,
  loading,
  emptyText,
  emptyIcon,
  s,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  loading: boolean;
  emptyText: string;
  emptyIcon: React.ReactNode;
  s: typeof DARK | typeof LIGHT;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("rounded-xl border", s.panel)}>
      <div className={cn("flex items-center justify-between border-b px-4 py-4 sm:px-5", s.panelBorder)}>
        <h2 className={cn("flex items-center gap-2 text-base font-extrabold", s.title)}>
          {icon}
          {title}
        </h2>
        <span className={cn("text-sm font-black", s.muted)}>{count}</span>
      </div>
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-8 animate-spin text-violet-400" />
        </div>
      ) : count === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12">
          {emptyIcon}
          <p className={cn("text-sm font-semibold", s.muted)}>{emptyText}</p>
        </div>
      ) : (
        <div className="max-h-80 overflow-y-auto">{children}</div>
      )}
    </section>
  );
}

function FileMetric({
  icon,
  label,
  s,
}: {
  icon: React.ReactNode;
  label: string;
  s: typeof DARK | typeof LIGHT;
}) {
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      <span className={cn("shrink-0", s.muted)}>{icon}</span>
      <span className={cn("font-bold", s.muted)}>{label}</span>
    </div>
  );
}

function DeleteButton({
  label,
  loading,
  onClick,
  s,
}: {
  label: string;
  loading: boolean;
  onClick: () => void;
  s: typeof DARK | typeof LIGHT;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-lg border px-3 py-1.5",
        "text-xs font-extrabold transition sm:justify-self-end",
        s.error, "opacity-70 hover:opacity-100 disabled:opacity-40"
      )}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function storeLabels(values: string[] | undefined, t: Record<string, any>) {
  const map: Record<string, string> = {
    product_content: t.backupStoreProductContent,
    stock_sales: t.backupStoreStockSales,
    image_metadata: t.backupStoreImageMetadata,
    shopify_sync: t.backupStoreShopifySync,
    activity_logs: t.backupStoreActivityLogs,
  };
  return (values ?? []).map((value) => map[value] ?? value);
}

function workflowLabel(step: string, t: Record<string, any>) {
  const map: Record<string, string> = {
    database_dump: t.backupWorkflowDatabaseDump,
    local_snapshot: t.backupWorkflowLocalSnapshot,
    photo_manifest: t.backupWorkflowPhotoManifest,
    drive_sync: t.backupWorkflowDriveSync,
  };
  return map[step] ?? step;
}

function stepLabel(step: string | null | undefined, t: Record<string, any>) {
  const map: Record<string, string> = {
    queued: t.backupStepQueued,
    database_dump: t.backupStepDatabaseDump,
    json_export: t.backupStepJsonExport,
    local_snapshot: t.backupStepLocalSnapshot,
    manifest: t.backupStepManifest,
    drive_sync: t.backupStepDriveSync,
  };
  return map[step || ""] ?? t.backupStepWorking;
}

function dedupeLabel(value: string | undefined, t: Record<string, any>) {
  if (value === "sha256_photo_blobs") return t.backupDedupeSha256;
  return value ?? "";
}

function statusLabel(status: string, t: Record<string, any>) {
  if (status === "pending") return t.statusPending;
  if (status === "ai_enhanced") return t.statusAiEnhanced;
  if (status === "published") return t.statusPublished;
  if (status === "sold_archive") return t.statusSoldArchive;
  return status;
}

function localizeDriveError(error: string | null | undefined, locale: "tr" | "ar") {
  if (!error) return error;
  const lower = error.toLowerCase();

  if (lower.includes("rclone yapılandırması okunamadı") || lower.includes("rclone configuration") || lower.includes("config file")) {
    return locale === "ar"
      ? "تعذر قراءة إعدادات rclone."
      : "rclone yapılandırması okunamadı.";
  }
  if (lower.includes("rclone komutu bulunamadı") || lower.includes("rclone command") || lower.includes("executable file not found")) {
    return locale === "ar"
      ? "لم يتم العثور على أمر rclone."
      : "rclone komutu bulunamadı.";
  }
  if (lower.includes("google drive yetki") || lower.includes("invalid_grant") || lower.includes("token")) {
    return locale === "ar"
      ? "يجب تجديد صلاحية Google Drive."
      : "Google Drive yetki anahtarı yenilenmeli.";
  }
  if (lower.includes("kota") || lower.includes("quota") || lower.includes("rate_limit")) {
    return locale === "ar"
      ? "تم تجاوز حد Google Drive API."
      : "Google Drive API kota limiti aşıldı.";
  }
  if (lower.includes("zaman aşımı") || lower.includes("timeout") || lower.includes("timed out")) {
    return locale === "ar"
      ? "انتهت مهلة مزامنة Google Drive."
      : "Google Drive senkronu zaman aşımına uğradı.";
  }

  return error;
}
