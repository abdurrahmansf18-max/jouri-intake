import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { checkAuth, clearCode, isAuthRequired, logout, storeCode, verifyCode } from "./api";
import { AppContext, useToastState } from "./context";
import LoginGate from "./components/LoginGate";
import AppLayout from "./layouts/AppLayout";
import DashboardPage from "./pages/DashboardPage";
import AddProductPage from "./pages/AddProductPage";
import ProductsPage from "./pages/ProductsPage";
import ArchivePage from "./pages/ArchivePage";
import BackupPage from "./pages/BackupPage";
import ToastContainer from "./components/Toast";
import type { Locale, Theme } from "./types";

const LOCALE_KEY = "jouri-locale";
const THEME_KEY = "jouri-theme";

export default function App() {
  const [locale, setLocaleState] = useState<Locale>("ar");
  const [theme, setThemeState] = useState<Theme>("dark");
  const [authed, setAuthed] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [checking, setChecking] = useState(true);
  const { toasts, showToast, dismiss } = useToastState();

  function setLocale(l: Locale) {
    setLocaleState(l);
    localStorage.setItem(LOCALE_KEY, l);
  }

  function setTheme(t: Theme) {
    setThemeState(t);
    localStorage.setItem(THEME_KEY, t);
  }

  // Restore preferences — default to Arabic
  useEffect(() => {
    const savedLocale = localStorage.getItem(LOCALE_KEY) as Locale | null;
    const savedTheme = localStorage.getItem(THEME_KEY) as Theme | null;
    setLocaleState(savedLocale ?? "ar");
    setThemeState(savedTheme ?? "dark");
  }, []);

  // Apply direction and background
  useEffect(() => {
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = locale;
    document.body.style.background = theme === "dark" ? "#0e1324" : "#f6f7fb";
  }, [locale, theme]);

  // Check auth on mount
  useEffect(() => {
    async function check() {
      try {
        const required = await isAuthRequired();
        setAuthRequired(required);
        if (!required) { setAuthed(true); setChecking(false); return; }
        const ok = await checkAuth();
        if (ok) setAuthed(true);
      } catch { /* API not ready */ } finally {
        setChecking(false);
      }
    }
    check();
  }, []);

  async function handleLogin(code: string) {
    const ok = await verifyCode(code);
    if (ok) { storeCode(code); setAuthed(true); }
    else throw new Error("ERR_WRONG_CODE");
  }

  async function handleLogout() {
    try { await logout(); } catch { /* ignore */ }
    clearCode();
    setAuthed(false);
  }

  if (checking) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${theme === "dark" ? "bg-[#0e1324]" : "bg-[#f6f7fb]"}`}>
        <div className="w-8 h-8 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (authRequired && !authed) {
    return (
      <AppContext.Provider value={{ locale, setLocale, theme, setTheme, showToast }}>
        <LoginGate
          locale={locale}
          setLocale={setLocale}
          theme={theme}
          setTheme={setTheme}
          onLogin={handleLogin}
        />
      </AppContext.Provider>
    );
  }

  return (
    <AppContext.Provider value={{ locale, setLocale, theme, setTheme, showToast }}>
      <BrowserRouter>
        <AppLayout onLogout={authRequired ? handleLogout : undefined}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/add" element={<AddProductPage />} />
            <Route path="/products" element={<ProductsPage />} />
            <Route path="/archive" element={<ArchivePage />} />
            <Route path="/backup" element={<BackupPage />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </AppLayout>
      </BrowserRouter>
      <ToastContainer toasts={toasts} onDismiss={dismiss} locale={locale} theme={theme} />
    </AppContext.Provider>
  );
}
