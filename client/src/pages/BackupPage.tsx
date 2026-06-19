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
  PackageCheck,
  RefreshCw,
  Save,
  Server,
  ShieldCheck,
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
  const backups = backupsQuery.data?.backups ?? [];
  const driveBackups = backupsQuery.data?.drive_backups ?? [];
  const loading = backupsQuery.isLoading;
  const running = starting || !!status.running;
  const refetchBackups = backupsQuery.refetch;

  useEffect(() => {
    if (!status.running) return;
    const timer = window.setInterval(() => {
      refetchBackups();
    }, 5000);
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
  const dbSqlSize = status.last_db_sql_size ?? status.last_db_size ?? "-";
  const dbJsonSize = status.last_db_json_size ?? "-";
  const photoBlobText = status.last_photo_files && status.last_photo_unique_blobs
    ? `${status.last_photo_files} ${t.backupFilesShort} / ${status.last_photo_unique_blobs} ${t.backupUniqueBlobsShort}`
    : t.backupLocalStorage;
  const photoDedupeText = status.last_photo_files && status.last_photo_unique_blobs
    ? `${status.last_photo_unique_blobs}/${status.last_photo_files}`
    : "-";
  const localizedDriveError = localizeDriveError(status.drive_error, locale);
  const driveErrorText = localizedDriveError && localizedDriveError.length > 110
    ? `${localizedDriveError.slice(0, 110)}...`
    : localizedDriveError;
  const lastRunText = hasStatus
    ? new Date(status.last_run!).toLocaleString(dateLocale)
    : t.backupNever;
  const driveLayoutText = status.drive_layout ?? t.backupDriveLayoutUnknown;
  const latestActivityText = dbStatus.latest_activity_at
    ? new Date(dbStatus.latest_activity_at).toLocaleString(dateLocale)
    : "-";
  const productsByStatus = dbStatus.products_by_status ?? {};
  const statusOrder = ["pending", "ai_enhanced", "published", "sold_archive"];

  const architecture = [
    {
      icon: <Database className="size-5" />,
      title: t.backupArchDbTitle,
      body: t.backupArchDbBody,
      meta: dbSqlSize,
      path: status.drive_db_path,
    },
    {
      icon: <FileText className="size-5" />,
      title: t.backupArchManifestTitle,
      body: t.backupArchManifestBody,
      meta: `${driveBackups.length} ${t.backupRestorePointShort}`,
      path: status.drive_manifest_path,
    },
    {
      icon: <Images className="size-5" />,
      title: t.backupArchPhotosTitle,
      body: t.backupArchPhotosBody,
      meta: photoBlobText,
      path: status.drive_photos_path,
    },
  ];

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

      <section className={cn("rounded-xl border", s.panel)}>
        <div className={cn("grid gap-0 divide-y md:grid-cols-4 md:divide-x md:divide-y-0", s.divider)}>
          <MetricBlock
            icon={<Clock className="size-4" />}
            label={t.backupLastRun}
            value={lastRunText}
            detail={running ? t.backupRunning : t.backupSchedule}
            accent="text-violet-300"
            s={s}
          />
          <MetricBlock
            icon={<Server className="size-4" />}
            label={t.backupLocalSnapshot}
            value={`${backups.length}`}
            detail={t.backupLocalStorage}
            accent="text-emerald-300"
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
          <MetricBlock
            icon={<Layers3 className="size-4" />}
            label={t.backupSmartDedupe}
            value={photoDedupeText}
            detail={t.backupDriveSmartLayout}
            accent="text-amber-300"
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
        <div className={cn("flex flex-wrap items-center justify-between gap-3 border-b px-4 py-4 sm:px-5", s.panelBorder)}>
          <div className="flex items-center gap-2">
            <Database className="size-5 text-emerald-300" />
            <div>
              <h2 className={cn("text-base font-extrabold", s.title)}>{t.backupDatabaseTitle}</h2>
              <p className={cn("mt-0.5 text-xs font-semibold", s.muted)}>{t.backupDatabaseSubtitle}</p>
            </div>
          </div>
          <span className={cn("rounded-full px-3 py-1 text-[11px] font-black ring-1", s.pill)}>
            {t.backupLiveData}
          </span>
        </div>

        <div className={cn("grid divide-y md:grid-cols-4 md:divide-x md:divide-y-0", s.divider)}>
          <MetricBlock
            icon={<PackageCheck className="size-4" />}
            label={t.backupDbProducts}
            value={formatNumber(dbStatus.products_total)}
            detail={t.backupDbProductsDetail}
            accent="text-emerald-300"
            s={s}
          />
          <MetricBlock
            icon={<Layers3 className="size-4" />}
            label={t.backupDbStock}
            value={formatNumber(dbStatus.stock_total)}
            detail={`${t.backupDbSold}: ${formatNumber(dbStatus.sold_total)}`}
            accent="text-violet-300"
            s={s}
          />
          <MetricBlock
            icon={dbStatus.shopify_errors ? <AlertCircle className="size-4" /> : <CheckCircle2 className="size-4" />}
            label={t.backupDbShopify}
            value={`${formatNumber(dbStatus.shopify_synced)} / ${formatNumber(dbStatus.products_total)}`}
            detail={dbStatus.shopify_errors ? `${t.backupDbShopifyErrors}: ${dbStatus.shopify_errors}` : t.backupDbShopifyOk}
            accent={dbStatus.shopify_errors ? "text-red-300" : "text-sky-300"}
            s={s}
          />
          <MetricBlock
            icon={<Clock className="size-4" />}
            label={t.backupDbActivity}
            value={formatNumber(dbStatus.activity_logs)}
            detail={latestActivityText}
            accent="text-amber-300"
            s={s}
          />
        </div>

        <div className={cn("border-t px-4 py-4 sm:px-5", s.panelBorder)}>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {statusOrder.map((statusKey) => (
              <StatusPill
                key={statusKey}
                label={statusLabel(statusKey, t)}
                value={productsByStatus[statusKey] ?? 0}
                s={s}
              />
            ))}
          </div>
        </div>
      </section>

      <section className={cn("rounded-xl border", s.panel)}>
        <div className={cn("flex flex-wrap items-center justify-between gap-3 border-b px-4 py-4 sm:px-5", s.panelBorder)}>
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-violet-300" />
            <div>
              <h2 className={cn("text-base font-extrabold", s.title)}>{t.backupArchitectureTitle}</h2>
              <p className={cn("mt-0.5 text-xs font-semibold", s.muted)}>{t.backupArchitectureSubtitle}</p>
            </div>
          </div>
          <span className={cn("rounded-full px-3 py-1 text-[11px] font-black ring-1", s.pill)}>
            {driveLayoutText}
          </span>
        </div>

        <div className={cn("grid divide-y lg:grid-cols-3 lg:divide-x lg:divide-y-0", s.divider)}>
          {architecture.map((item) => (
            <div key={item.title} className="min-w-0 p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <div className={cn("grid size-10 shrink-0 place-items-center rounded-lg ring-1", s.iconBox)}>
                  {item.icon}
                </div>
                <div className="min-w-0">
                  <div className={cn("text-sm font-extrabold", s.title)}>{item.title}</div>
                  <p className={cn("mt-1 text-xs font-semibold leading-5", s.muted)}>{item.body}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className={cn("rounded-md px-2 py-1 text-[11px] font-black ring-1", s.pill)}>
                      {item.meta}
                    </span>
                    {item.path ? (
                      <span className={cn("max-w-full truncate rounded-md px-2 py-1 text-[11px] font-bold ring-1", s.pill)}>
                        {item.path}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className={cn("border-t px-4 py-4 sm:px-5", s.panelBorder)}>
          <div className="grid gap-3 md:grid-cols-3">
            <StatusLine
              icon={<CheckCircle2 className="size-4 text-emerald-400" />}
              label={t.backupConsistencyTitle}
              value={t.backupConsistencyBody}
              s={s}
            />
            <StatusLine
              icon={<HardDrive className="size-4 text-violet-300" />}
              label={t.backupRestoreMapTitle}
              value={t.backupRestoreMapBody}
              s={s}
            />
            <StatusLine
              icon={<CloudUpload className="size-4 text-sky-400" />}
              label={t.backupDriveRestorePoints}
              value={`${driveBackups.length} ${t.backupRestorePointShort}`}
              s={s}
            />
          </div>
        </div>
      </section>

      <section className={cn("rounded-xl border", s.panel)}>
        <div className={cn("flex items-center justify-between border-b px-4 py-4 sm:px-5", s.panelBorder)}>
          <h2 className={cn("flex items-center gap-2 text-base font-extrabold", s.title)}>
            <HardDrive className="size-4 text-violet-400" />
            {t.backupAvailable}
          </h2>
          <span className={cn("text-sm font-black", s.muted)}>{backups.length}</span>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="size-8 animate-spin text-violet-400" />
          </div>
        ) : backups.length === 0 ? (
          <EmptyState icon={<HardDrive className={cn("size-10", s.emptyIcon)} />} text={t.backupEmpty} s={s} />
        ) : (
          <div className="max-h-80 overflow-y-auto">
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
                    <FileMetric
                      icon={<Layers3 className="size-3.5" />}
                      label={`${b.photo_files}/${b.photo_unique_blobs}`}
                      s={s}
                    />
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={() => handleDelete(b.date)}
                  disabled={deleting === b.date}
                  className={cn(
                    "inline-flex w-fit items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5",
                    "text-xs font-extrabold transition sm:justify-self-end",
                    s.error, "opacity-70 hover:opacity-100 disabled:opacity-40"
                  )}
                >
                  {deleting === b.date
                    ? <Loader2 className="size-3.5 animate-spin" />
                    : <Trash2 className="size-3.5" />
                  }
                  <span className="hidden sm:inline">{t.backupDelete}</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={cn("rounded-xl border", s.panel)}>
        <div className={cn("flex items-center justify-between border-b px-4 py-4 sm:px-5", s.panelBorder)}>
          <h2 className={cn("flex items-center gap-2 text-base font-extrabold", s.title)}>
            <CloudUpload className="size-4 text-sky-400" />
            {t.backupDriveAvailable}
          </h2>
          <span className={cn("text-sm font-black", s.muted)}>{driveBackups.length}</span>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="size-8 animate-spin text-sky-400" />
          </div>
        ) : driveBackups.length === 0 ? (
          <EmptyState icon={<CloudUpload className={cn("size-10", s.emptyIcon)} />} text={t.backupDriveEmpty} s={s} />
        ) : (
          <div className="max-h-80 overflow-y-auto">
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

                <button
                  type="button"
                  onClick={() => handleDeleteDrive(date)}
                  disabled={deletingDrive === date}
                  className={cn(
                    "inline-flex w-fit items-center gap-1.5 rounded-lg border px-3 py-1.5",
                    "text-xs font-extrabold transition sm:justify-self-end",
                    s.error, "opacity-70 hover:opacity-100 disabled:opacity-40"
                  )}
                >
                  {deletingDrive === date
                    ? <Loader2 className="size-3.5 animate-spin" />
                    : <Trash2 className="size-3.5" />
                  }
                  <span className="hidden sm:inline">{t.backupDelete}</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
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

function StatusLine({
  icon,
  label,
  value,
  s,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  s: typeof DARK | typeof LIGHT;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <div className={cn("text-xs font-black", s.title)}>{label}</div>
        <div className={cn("mt-0.5 text-xs font-semibold leading-5", s.muted)}>{value}</div>
      </div>
    </div>
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

function EmptyState({
  icon,
  text,
  s,
}: {
  icon: React.ReactNode;
  text: string;
  s: typeof DARK | typeof LIGHT;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-12">
      {icon}
      <p className={cn("text-sm font-semibold", s.muted)}>{text}</p>
    </div>
  );
}

function StatusPill({
  label,
  value,
  s,
}: {
  label: string;
  value: number;
  s: typeof DARK | typeof LIGHT;
}) {
  return (
    <div className={cn("flex min-w-0 items-center justify-between gap-3 rounded-lg px-3 py-2 ring-1", s.pill)}>
      <span className="truncate text-xs font-bold">{label}</span>
      <span className="shrink-0 text-sm font-black">{value}</span>
    </div>
  );
}

function formatNumber(value: number | null | undefined) {
  if (value == null) return "-";
  return new Intl.NumberFormat("tr-TR").format(value);
}

function statusLabel(
  status: string,
  t: {
    statusPending: string;
    statusAiEnhanced: string;
    statusPublished: string;
    statusSoldArchive: string;
  },
) {
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
