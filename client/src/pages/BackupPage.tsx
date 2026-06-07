import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  CloudUpload,
  Database,
  HardDrive,
  Images,
  Loader2,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import { deleteBackup, deleteDriveBackup, runBackup } from "../api";
import { useApp } from "../context";
import { COPY, cn } from "../i18n";
import { DARK, LIGHT } from "../theme";
import { queryKeys, useBackupsQuery, type BackupOverview } from "../queries";

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
  const driveState = !hasStatus || status.drive_ok == null
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
  const driveErrorText = status.drive_error && status.drive_error.length > 110
    ? `${status.drive_error.slice(0, 110)}...`
    : status.drive_error;

  return (
    <div className="grid gap-5">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className={cn("text-2xl font-black tracking-tight", s.title)}>{t.backupTitle}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {/* Manuel yedekle */}
          <button
            type="button"
            onClick={handleRunBackup}
            disabled={running || loading}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-extrabold transition",
              "border-violet-400/30 bg-violet-400/10 text-violet-300 hover:bg-violet-400/20 active:scale-95 disabled:opacity-50",
            )}
          >
            {running ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            <span>{running ? t.backupRunning : t.backupRunManual}</span>
          </button>
          {/* Yenile */}
          <button
            type="button"
            onClick={() => backupsQuery.refetch()}
            disabled={loading || backupsQuery.isFetching}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-extrabold transition",
              s.controlGroup, s.controlIdle,
            )}
          >
            <RefreshCw className={cn("size-4", (loading || backupsQuery.isFetching) && "animate-spin")} />
            <span>{t.backupRefresh}</span>
          </button>
        </div>
      </div>

      {/* Manuel yedekleme açıklaması */}
      <div className={cn("rounded-xl border px-4 py-3 text-xs font-semibold", s.subPanel)}>
        <span className={cn(s.muted)}>{t.backupManualInfo}</span>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">

        {/* Last backup */}
        <div className={cn("col-span-2 rounded-xl border p-4 sm:col-span-1", s.panel)}>
          <div className={cn("flex items-center gap-1.5 text-xs font-bold mb-2", s.muted)}>
            <Clock className="size-3.5 shrink-0" />
            {t.backupLastRun}
          </div>
          <div className={cn("text-sm font-extrabold leading-5", s.title)}>
            {hasStatus
              ? new Date(status.last_run!).toLocaleString(dateLocale)
              : t.backupNever}
          </div>
          <div className={cn("mt-1.5 text-xs leading-4", s.muted)}>{t.backupSchedule}</div>
        </div>

        {/* Primary DB dump size */}
        <div className={cn("rounded-xl border p-4", s.panel)}>
          <div className={cn("flex items-center gap-1.5 text-xs font-bold mb-2", s.muted)}>
            <Database className="size-3.5 shrink-0" />
            {t.backupDbSql}
          </div>
          <div className="text-xl font-black text-violet-400">{dbSqlSize}</div>
          {status.last_db_sql_error ? (
            <div className="mt-1 break-words text-[11px] font-semibold leading-4 text-red-400/80">
              {t.backupDbSqlErrorPrefix} {status.last_db_sql_error}
            </div>
          ) : (
            <div className={cn("mt-1 text-xs", s.muted)}>{t.backupDbPrimary}</div>
          )}
        </div>

        {/* JSON export size */}
        <div className={cn("rounded-xl border p-4", s.panel)}>
          <div className={cn("flex items-center gap-1.5 text-xs font-bold mb-2", s.muted)}>
            <Database className="size-3.5 shrink-0" />
            {t.backupJsonExport}
          </div>
          <div className="text-xl font-black text-violet-300">{dbJsonSize}</div>
          <div className={cn("mt-1 text-xs", s.muted)}>{t.backupLocalStorage}</div>
        </div>

        {/* Images size */}
        <div className={cn("rounded-xl border p-4", s.panel)}>
          <div className={cn("flex items-center gap-1.5 text-xs font-bold mb-2", s.muted)}>
            <Images className="size-3.5 shrink-0" />
            {t.backupImages}
          </div>
          <div className="text-xl font-black text-sky-400">{status.last_img_size ?? "-"}</div>
          <div className={cn("mt-1 text-xs", s.muted)}>{t.backupLocalStorage}</div>
        </div>

        {/* Drive status */}
        <div className={cn("rounded-xl border p-4", s.panel)}>
          <div className={cn("flex items-center gap-1.5 text-xs font-bold mb-2", s.muted)}>
            <CloudUpload className="size-3.5 shrink-0" />
            {t.backupDrive}
          </div>
          <div className="flex items-center gap-2">
            {driveState === "unknown" ? (
              <HardDrive className={cn("size-5", s.muted)} />
            ) : driveState === "ok" ? (
              <CheckCircle2 className="size-5 text-emerald-400" />
            ) : (
              <AlertCircle className="size-5 text-red-400" />
            )}
            <span className={cn("text-sm font-extrabold", s.title)}>
              {driveState === "unknown" ? "-" : driveState === "ok" ? t.backupOk : t.backupFail}
            </span>
          </div>
          <div className={cn("mt-1 text-xs", driveState === "fail" ? "text-red-400" : s.muted)}>
            {driveStorageText}
          </div>
          {driveState === "fail" && driveErrorText ? (
            <div className="mt-1 text-[11px] font-semibold leading-4 text-red-400/80">
              {t.backupDriveErrorPrefix} {driveErrorText}
            </div>
          ) : null}
        </div>

      </div>

      {/* VPS Backup list */}
      <div className={cn("rounded-xl border", s.panel)}>
        <div className={cn("flex items-center justify-between px-4 py-4 border-b sm:px-5", s.panelBorder)}>
          <h2 className={cn("text-base font-extrabold flex items-center gap-2", s.title)}>
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
          <div className="flex flex-col items-center gap-3 py-12">
            <HardDrive className={cn("size-10", s.emptyIcon)} />
            <p className={cn("text-sm font-semibold", s.muted)}>{t.backupEmpty}</p>
          </div>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            {backups.map((b) => (
              <div
                key={b.date}
                className={cn(
                  "grid gap-3 px-4 py-4 border-b last:border-b-0 sm:grid-cols-[minmax(8rem,1fr)_auto_auto] sm:items-center sm:px-5",
                  s.panelBorder
                )}
              >
                <div className="min-w-0">
                  <div className={cn("whitespace-nowrap text-sm font-extrabold", s.title)}>{b.date}</div>
                </div>

                <div className="grid gap-2 text-xs sm:flex sm:items-center sm:gap-4">
                  <div className="flex items-center gap-1.5 whitespace-nowrap">
                    <Database className={cn("size-3.5", s.muted)} />
                    <span className={cn("font-bold", s.muted)}>db.sql {b.db_sql_size ?? b.db_size}</span>
                  </div>
                  <div className="flex items-center gap-1.5 whitespace-nowrap">
                    <Database className={cn("size-3.5", s.muted)} />
                    <span className={cn("font-bold", s.muted)}>db.json {b.db_json_size ?? "-"}</span>
                  </div>
                  <div className="flex items-center gap-1.5 whitespace-nowrap">
                    <Images className={cn("size-3.5", s.muted)} />
                    <span className={cn("font-bold", s.muted)}>{b.img_size}</span>
                  </div>
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
      </div>

      {/* Drive Backup list */}
      <div className={cn("rounded-xl border", s.panel)}>
        <div className={cn("flex items-center justify-between px-4 py-4 border-b sm:px-5", s.panelBorder)}>
          <h2 className={cn("text-base font-extrabold flex items-center gap-2", s.title)}>
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
          <div className="flex flex-col items-center gap-3 py-12">
            <CloudUpload className={cn("size-10", s.emptyIcon)} />
            <p className={cn("text-sm font-semibold", s.muted)}>{t.backupDriveEmpty}</p>
          </div>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            {driveBackups.map((date) => (
              <div
                key={date}
                className={cn(
                  "flex items-center gap-3 px-4 py-4 border-b last:border-b-0 sm:px-5",
                  s.panelBorder
                )}
              >
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <CloudUpload className="size-3.5 shrink-0 text-sky-400" />
                  <span className={cn("text-sm font-extrabold", s.title)}>{date}</span>
                </div>

                <button
                  type="button"
                  onClick={() => handleDeleteDrive(date)}
                  disabled={deletingDrive === date}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5",
                    "text-xs font-extrabold transition shrink-0",
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
      </div>

      {/* How it works info box */}
      <div className={cn("rounded-xl border p-4", s.subPanel)}>
        <div className={cn("font-extrabold mb-3 text-sm", s.title)}>{t.backupHowTitle}</div>
        <ul className={cn("grid gap-2 text-xs leading-5", s.muted)}>
          {[t.backupHow1, t.backupHow2, t.backupHow3, t.backupHow4, t.backupHow5].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span className="mt-1.5 size-1.5 rounded-full bg-violet-400 shrink-0" />
              {item}
            </li>
          ))}
        </ul>
      </div>

    </div>
  );
}
