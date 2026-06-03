import { useEffect, useState } from "react";
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
import { deleteBackup, deleteDriveBackup, fetchBackups, runBackup, type BackupEntry, type BackupStatus } from "../api";
import { useApp } from "../context";
import { COPY, cn } from "../i18n";
import { DARK, LIGHT } from "../theme";

export default function BackupPage() {
  const { locale, theme, showToast } = useApp();
  const t = COPY[locale];
  const s = theme === "dark" ? DARK : LIGHT;

  const [status, setStatus] = useState<BackupStatus>({});
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [driveBackups, setDriveBackups] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deletingDrive, setDeletingDrive] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const dateLocale = locale === "ar" ? "ar" : "tr-TR";

  async function load() {
    setLoading(true);
    try {
      const data = await fetchBackups();
      setStatus(data.status);
      setBackups(data.backups);
      setDriveBackups(data.drive_backups ?? []);
    } catch {
      showToast(t.errors.ERR_GENERAL, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleRunBackup() {
    setRunning(true);
    try {
      const data = await runBackup();
      setStatus(data.status);
      setBackups(data.backups);
      setDriveBackups(data.drive_backups ?? []);
      showToast(t.backupManualDone, "success");
    } catch {
      showToast(t.backupManualFail, "error");
    } finally {
      setRunning(false);
    }
  }

  async function handleDelete(date: string) {
    if (!window.confirm(t.backupDeleteConfirm)) return;
    setDeleting(date);
    try {
      await deleteBackup(date);
      setBackups(prev => prev.filter(b => b.date !== date));
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
      setDriveBackups(prev => prev.filter(d => d !== date));
      showToast(t.backupDriveDeleted, "success");
    } catch {
      showToast(t.errors.ERR_GENERAL, "error");
    } finally {
      setDeletingDrive(null);
    }
  }

  const hasStatus = !!status.last_run;

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
            onClick={load}
            disabled={loading}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-extrabold transition",
              s.controlGroup, s.controlIdle,
            )}
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            <span>{t.backupRefresh}</span>
          </button>
        </div>
      </div>

      {/* Manuel yedekleme açıklaması */}
      <div className={cn("rounded-xl border px-4 py-3 text-xs font-semibold", s.subPanel)}>
        <span className={cn(s.muted)}>{t.backupManualInfo}</span>
      </div>

      {/* Status cards — 2 col on mobile, 4 on large */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">

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

        {/* DB size */}
        <div className={cn("rounded-xl border p-4", s.panel)}>
          <div className={cn("flex items-center gap-1.5 text-xs font-bold mb-2", s.muted)}>
            <Database className="size-3.5 shrink-0" />
            {t.backupDb}
          </div>
          <div className="text-xl font-black text-violet-400">{status.last_db_size ?? "-"}</div>
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
            {!hasStatus ? (
              <HardDrive className={cn("size-5", s.muted)} />
            ) : status.drive_ok ? (
              <CheckCircle2 className="size-5 text-emerald-400" />
            ) : (
              <AlertCircle className="size-5 text-red-400" />
            )}
            <span className={cn("text-sm font-extrabold", s.title)}>
              {!hasStatus ? "-" : status.drive_ok ? t.backupOk : t.backupFail}
            </span>
          </div>
          <div className={cn("mt-1 text-xs", s.muted)}>{t.backupDriveStorage}</div>
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
          <div>
            {backups.map((b) => (
              <div
                key={b.date}
                className={cn(
                  "flex flex-wrap items-center gap-3 px-4 py-4 border-b last:border-b-0 sm:px-5 sm:flex-nowrap",
                  s.panelBorder
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className={cn("text-sm font-extrabold", s.title)}>{b.date}</div>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  <div className="flex items-center gap-1.5">
                    <Database className={cn("size-3.5", s.muted)} />
                    <span className={cn("text-xs font-bold", s.muted)}>{b.db_size}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Images className={cn("size-3.5", s.muted)} />
                    <span className={cn("text-xs font-bold", s.muted)}>{b.img_size}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleDelete(b.date)}
                  disabled={deleting === b.date}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5",
                    "text-xs font-extrabold transition shrink-0",
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
          <div>
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
