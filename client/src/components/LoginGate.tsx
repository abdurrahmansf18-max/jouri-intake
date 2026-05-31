import { useState } from "react";
import { Languages, Loader2, LockKeyhole, Moon, ShieldCheck, Sun } from "lucide-react";
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
      className={cn("min-h-screen flex flex-col items-center justify-center px-4 py-10", s.page)}
      dir={t.dir}
    >
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
          isDark ? "shadow-violet-950/40 border-white/10 bg-[#151d34]" : "shadow-slate-200 border-slate-200 bg-white",
        )}
      >
        {/* Logo */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className={cn(
            "flex size-16 items-center justify-center rounded-2xl mb-4",
            "shadow-lg",
            isDark
              ? "bg-violet-500 shadow-violet-950/50"
              : "bg-violet-600 shadow-violet-200",
          )}>
            <LockKeyhole className="size-8 text-white" />
          </div>

          <h1 className={cn("text-3xl font-black tracking-tight", s.title)}>
            {t.appTitle}
          </h1>

          {/* Admin badge */}
          <span className={cn(
            "mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-extrabold",
            isDark
              ? "bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30"
              : "bg-violet-50 text-violet-700 ring-1 ring-violet-200",
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
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder={t.codePlaceholder}
              autoComplete="one-time-code"
              required
              className={cn(
                "min-h-12 rounded-xl border px-4 text-lg font-extrabold tracking-[0.4em] outline-none transition focus:ring-4 text-center",
                s.input,
                error && "border-red-400 focus:ring-red-500/15",
              )}
            />
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
          isDark ? "text-violet-400" : "text-violet-600",
        )}>
          {t.loginDeveloperName}
        </span>
      </p>
    </main>
  );
}
