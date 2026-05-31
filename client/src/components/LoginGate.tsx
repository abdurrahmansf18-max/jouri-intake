import { useState } from "react";
import { LockKeyhole, Languages, Sun, Moon } from "lucide-react";
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
    <main className={cn("min-h-screen grid place-items-center px-4 py-8", s.page)} dir={t.dir}>
      <section className={cn("w-full max-w-md rounded-xl border p-6 shadow-2xl shadow-black/20", s.panel)}>
        <div className="mb-5 flex justify-end gap-2">
          <div className={cn("inline-flex items-center gap-1 rounded-lg border p-1", s.controlGroup)}>
            <Languages className={cn("mx-1 size-4", s.muted)} />
            {(["tr", "ar"] as Locale[]).map(l => (
              <button key={l} type="button"
                className={cn("rounded-md px-2.5 py-1.5 text-xs font-extrabold transition", locale === l ? s.controlActive : s.controlIdle)}
                onClick={() => setLocale(l)}
              >{l === "tr" ? "TR" : "عربي"}</button>
            ))}
          </div>
          <button type="button"
            className={cn("inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-extrabold transition", s.controlGroup, s.controlIdle)}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            <span>{theme === "dark" ? t.lightMode : t.darkMode}</span>
          </button>
        </div>

        <div className={cn("flex size-12 items-center justify-center rounded-xl", s.logo)}>
          <LockKeyhole className="size-6" />
        </div>
        <h1 className={cn("mt-5 text-2xl font-black tracking-tight", s.title)}>{t.appTitle}</h1>
        <p className={cn("mt-2 text-sm leading-6", s.muted)}>{t.accessIntro}</p>

        <form className="mt-5 grid gap-3" onSubmit={submit}>
          <label className="grid gap-2">
            <span className={cn("text-sm font-bold", s.strong)}>{t.accessCode}</span>
            <input
              type="password" value={code} onChange={e => setCode(e.target.value)}
              placeholder={t.codePlaceholder} autoComplete="one-time-code" required
              className={cn("min-h-12 rounded-lg border px-4 text-base outline-none transition focus:ring-4", s.input, error && "border-red-400")}
            />
          </label>
          {error && <p className={cn("text-sm font-semibold rounded-lg border px-4 py-3", s.error)}>{t.wrongCode}</p>}
          <button type="submit" disabled={loading}
            className={cn("inline-flex min-h-12 items-center justify-center rounded-lg px-4 text-sm font-extrabold transition disabled:opacity-70", s.primary)}
          >
            {loading ? t.loading : t.login}
          </button>
        </form>
      </section>
    </main>
  );
}
