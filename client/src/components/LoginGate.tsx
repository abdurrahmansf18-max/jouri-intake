import { useState } from "react";
import { Eye, EyeOff, Languages, Loader2, LockKeyhole, Moon, ShieldCheck, Sun } from "lucide-react";
import type { Locale, Theme } from "../types";
import { cn, COPY } from "../i18n";
import { DARK, LIGHT } from "../theme";

interface Props {
  locale: Locale; setLocale: (l: Locale) => void;
  theme: Theme; setTheme: (t: Theme) => void;
  onLogin: (code: string) => Promise<void>;
}

export default function LoginGate({ locale, setLocale, theme, setTheme, onLogin }: Props) {
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const t = COPY[locale];
  const s = theme === "dark" ? DARK : LIGHT;
  const isDark = theme === "dark";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(false);
    try {
      await onLogin(code);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      className={cn("relative min-h-screen flex flex-col items-center justify-center px-4 py-10 overflow-hidden", s.page)}
      dir={t.dir}
    >
      {/* Soft professional background glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className={cn(
          "absolute -top-32 -start-32 h-96 w-96 rounded-full blur-[120px]",
          isDark ? "bg-emerald-700 opacity-[0.24]" : "bg-emerald-400 opacity-25",
        )} />
        <div className={cn(
          "absolute -bottom-32 -end-32 h-96 w-96 rounded-full blur-[120px]",
          isDark ? "bg-amber-700 opacity-[0.18]" : "bg-amber-400 opacity-20",
        )} />
        <div className={cn(
          "absolute top-1/2 start-1/2 -translate-x-1/2 -translate-y-1/2 h-72 w-72 rounded-full blur-[100px]",
          isDark ? "bg-stone-600 opacity-[0.18]" : "bg-emerald-300 opacity-15",
        )} />
        <div className={cn(
          "absolute top-10 end-10 h-48 w-48 rounded-full blur-[80px]",
          isDark ? "bg-lime-700 opacity-[0.12]" : "bg-lime-300 opacity-15",
        )} />
        <div className={cn(
          "absolute bottom-10 start-10 h-48 w-48 rounded-full blur-[80px]",
          isDark ? "bg-orange-700 opacity-[0.12]" : "bg-orange-300 opacity-15",
        )} />
      </div>
      {/* Controls — top */}
      <div className="mb-6 flex gap-2">
        <div className={cn("inline-flex items-center gap-1 rounded-xl border p-1", s.controlGroup)}>
          <Languages className={cn("mx-1 size-3.5", s.muted)} />
          {(["tr", "ar"] as Locale[]).map(l => (
            <button
              key={l}
              type="button"
              onClick={() => setLocale(l)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-extrabold transition",
                locale === l ? s.controlActive : s.controlIdle,
              )}
            >
              {l === "tr" ? "TR" : "عربي"}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setTheme(isDark ? "light" : "dark")}
          className={cn(
            "inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-extrabold transition",
            s.controlGroup, s.controlIdle,
          )}
        >
          {isDark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
          <span className="hidden sm:inline">{isDark ? t.lightMode : t.darkMode}</span>
        </button>
      </div>

      {/* Card */}
      <section
        className={cn(
          "w-full max-w-sm rounded-2xl border p-8",
          "shadow-2xl",
          isDark ? "shadow-black/40 border-white/10 bg-[#1b1c16]" : "shadow-slate-200 border-slate-200 bg-white",
        )}
      >
        {/* Logo */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className={cn(
            "flex size-16 items-center justify-center rounded-2xl mb-4",
            "shadow-lg",
            isDark
              ? "bg-emerald-500 shadow-emerald-950/50"
              : "bg-emerald-600 shadow-emerald-200",
          )}>
            <LockKeyhole className="size-8 text-white" />
          </div>

          <h1 className={cn("text-3xl font-black tracking-tight", s.title)}>
            {t.loginTitle}
          </h1>

          {/* Admin badge */}
          <span className={cn(
            "mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-extrabold",
            isDark
              ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
              : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
          )}>
            <ShieldCheck className="size-3.5" />
            {t.loginAdminLabel}
          </span>

          <p className={cn("mt-4 text-sm leading-6", s.muted)}>
            {t.accessIntro}
          </p>
        </div>

        {/* Form */}
        <form className="grid gap-4" onSubmit={submit}>
          <label className="grid gap-2">
            <span className={cn("text-sm font-extrabold", s.strong)}>{t.accessCode}</span>
            <div className="relative">
            <input
              type={showCode ? "text" : "password"}
              maxLength={32}
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder={t.codePlaceholder}
              autoComplete="one-time-code"
              required
              className={cn(
                "min-h-12 w-full rounded-xl border pe-10 ps-4 text-lg font-extrabold tracking-[0.4em] outline-none transition focus:ring-4 text-center",
                s.input,
                error && "border-red-400 focus:ring-red-500/15",
              )}
            />
            <button
              type="button"
              onClick={() => setShowCode((v) => !v)}
              className={cn("absolute inset-y-0 end-3 flex items-center", s.muted)}
            >
              {showCode ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
            </div>
          </label>

          {error && (
            <p className={cn("rounded-xl border px-4 py-3 text-sm font-semibold text-center", s.error)}>
              {t.wrongCode}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className={cn(
              "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4",
              "text-sm font-extrabold transition disabled:opacity-70",
              s.primary,
            )}
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            {loading ? t.loading : t.login}
          </button>
        </form>
      </section>

      {/* Developer credit */}
      <p className={cn("mt-6 text-xs font-semibold", s.muted)}>
        {t.loginDeveloper}
        {locale === "ar" ? " : " : ": "}
        <span className={cn(
          "font-extrabold",
          isDark ? "text-emerald-400" : "text-emerald-600",
        )}>
          {t.loginDeveloperName}
        </span>
      </p>
    </main>
  );
}
