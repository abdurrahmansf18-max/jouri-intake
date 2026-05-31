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
  Trash2,
} from "lucide-react";
import { deleteBackup, fetchBackups, type BackupEntry, type BackupStatus } from "../api";
import { useApp } from "../context";
import { COPY, cn } from "../i18n";
import { DARK, LIGHT } from "../theme";

export default function BackupPage() {
  const { locale, theme, showToast } = useApp();
  const t = COPY[locale];
  const s = theme === "dark" ? DARK : LIGHT;

  const [status, setStatus] = useState<BackupStatus>({});
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const dateLocale = locale === "ar" ? "ar" : "tr-TR";

  async function load() {
    setLoading(true);
    try {
      const data = await fetchBackups();
      setStatus(data.status);
      setBackups(data.backups);
    } catch {
      showToast(t.errors.ERR_GENERAL, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

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

  const hasStatus = status.last_run;

  return (
    <div className="grid gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className={cn("text-2xl font-black tracking-tight", s.title)}>{t.backupTitle}</h1>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className={cn("inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-extrabold transition", s.controlGroup, s.controlIdle)}
        >
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          {loading ? t.loading : locale === "ar" ? "تحديث" : "Yenile"}
        </button>
      </div>

      {/* Status cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Last backup */}
        <div className={cn("rounded-xl border p-4", s.panel)}>
          <div className={cn("flex items-center gap-2 text-xs font-bold mb-2", s.muted)}>
            <Clock className="size-4" />
            {t.backupLastRun}
          </div>
          <div className={cn("text-sm font-extrabold", s.title)}>
            {hasStatus
              ? new Date(status.last_run!).toLocaleString(dateLocale)
              : t.backupNever}
          </div>
          <div className={cn("mt-1 text-xs", s.muted)}>{t.backupSchedule}</div>
        </div>

        {/* DB size */}
        <div className={cn("rounded-xl border p-4", s.panel)}>
          <div className={cn("flex items-center gap-2 text-xs font-bold mb-2", s.muted)}>
            <Database className="size-4" />
            {t.backupDb}
          </div>
          <div className={cn("text-lg font-black text-violet-400")}>
            {status.last_db_size ?? "-"}
          </div>
          <div className={cn("mt-1 text-xs", s.muted)}>{t.backupLocalStorage}</div>
        </div>

        {/* Images size */}
        <div className={cn("rounded-xl border p-4", s.panel)}>
          <div className={cn("flex items-center gap-2 text-xs font-bold mb-2", s.muted)}>
            <Images className="size-4" />
            {t.backupImages}
          </div>
          <div className={cn("text-lg font-black text-sky-400")}>
            {status.last_img_size ?? "-"}
          </div>
          <div className={cn("mt-1 text-xs", s.muted)}>{t.backupLocalStorage}</div>
        </div>

        {/* Drive status */}
        <div className={cn("rounded-xl border p-4", s.panel)}>
          <div className={cn("flex items-center gap-2 text-xs font-bold mb-2", s.muted)}>
            <CloudUpload className="size-4" />
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

      {/* Backup list */}
      <div className={cn("rounded-xl border", s.panel)}>
        <div className={cn("flex items-center justify-between px-5 py-4 border-b", s.panelBorder)}>
          <h2 className={cn("text-base font-extrabold", s.title)}>{t.backupAvailable}</h2>
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
          <div className="divide-y" style={{ borderColor: "transparent" }}>
            {backups.map((b) => (
              <div
                key={b.date}
                className={cn("flex items-center gap-4 px-5 py-4 border-b last:border-b-0", s.panelBorder)}
              >
                {/* Date */}
                <div className="flex-1 min-w-0">
                  <div className={cn("text-sm font-extrabold", s.title)}>{b.date}</div>
                </div>

                {/* DB */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <Database className={cn("size-3.5", s.muted)} />
                  <span className={cn("text-xs font-bold", s.muted)}>{b.db_size}</span>
                </div>

                {/* Images */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <Images className={cn("size-3.5", s.muted)} />
                  <span className={cn("text-xs font-bold", s.muted)}>{b.img_size}</span>
                </div>

                {/* Delete */}
                <button
                  type="button"
                  onClick={() => handleDelete(b.date)}
                  disabled={deleting === b.date}
                  className={cn(
                    "inline-flex size-8 shrink-0 items-center justify-center rounded-lg border transition",
                    s.error,
                    "opacity-60 hover:opacity-100"
                  )}
                  title={locale === "ar" ? "حذف" : "Sil"}
                >
                  {deleting === b.date
                    ? <Loader2 className="size-3.5 animate-spin" />
                    : <Trash2 className="size-3.5" />
                  }
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Info */}
      <div className={cn("rounded-xl border p-4 text-sm", s.subPanel)}>
        <div className={cn("font-extrabold mb-2", s.title)}>
          {locale === "ar" ? "كيف يعمل النسخ الاحتياطي؟" : "Yedekleme nasıl çalışır?"}
        </div>
        <div className={cn("grid gap-1.5 text-xs leading-5", s.muted)}>
          <div>• {locale === "ar" ? "كل ليلة الساعة 02:00 يعمل تلقائياً" : "Her gece 02:00'de otomatik çalışır"}</div>
          <div>• {locale === "ar" ? "قاعدة البيانات: كل المنتجات والمبيعات والسجلات" : "Veritabanı: tüm ürünler, satışlar, loglar"}</div>
          <div>• {locale === "ar" ? "الصور: نسخ تدريجي (الملفات الجديدة فقط)" : "Görseller: artımlı kopyalama (sadece yeni dosyalar)"}</div>
          <div>• {locale === "ar" ? "يُرفع إلى Google Drive تلقائياً" : "Google Drive'a otomatik yüklenir"}</div>
          <div>• {locale === "ar" ? "يُحذف تلقائياً بعد 30 يوماً" : "30 günden eski yedekler otomatik silinir"}</div>
        </div>
      </div>
    </div>
  );
}
