import { CheckCircle2, X, XCircle } from "lucide-react";
import type { Locale, Theme, Toast } from "../types";
import { cn } from "../i18n";

interface Props {
  toasts: Toast[];
  onDismiss: (id: number) => void;
  locale: Locale;
  theme: Theme;
}

export default function ToastContainer({ toasts, onDismiss, locale, theme }: Props) {
  if (!toasts.length) return null;
  const isDark = theme === "dark";
  const dir = locale === "ar" ? "rtl" : "ltr";

  return (
    <div
      className="fixed top-4 inset-x-0 z-[100] flex flex-col items-center gap-2 px-4 pointer-events-none sm:items-end sm:inset-x-auto sm:start-auto sm:end-4"
      dir={dir}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            "pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-xl border px-4 py-3 shadow-2xl shadow-black/20 text-sm font-semibold transition-all",
            toast.type === "success"
              ? isDark
                ? "border-emerald-400/30 bg-emerald-900/80 text-emerald-100 backdrop-blur"
                : "border-emerald-200 bg-emerald-50 text-emerald-800"
              : isDark
              ? "border-red-400/30 bg-red-900/80 text-red-100 backdrop-blur"
              : "border-red-200 bg-red-50 text-red-700"
          )}
        >
          {toast.type === "success"
            ? <CheckCircle2 className="size-5 shrink-0" />
            : <XCircle className="size-5 shrink-0" />
          }
          <span className="flex-1">{toast.message}</span>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            className="shrink-0 rounded-md p-0.5 opacity-60 hover:opacity-100 transition"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
