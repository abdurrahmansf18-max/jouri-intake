import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { Locale, Theme, Toast, ToastType } from "./types";

// ── App context ───────────────────────────────────────────────────────────────

interface AppCtx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  showToast: (message: string, type?: ToastType) => void;
}

export const AppContext = createContext<AppCtx>({
  locale: "ar",
  setLocale: () => {},
  theme: "dark",
  setTheme: () => {},
  showToast: () => {},
});

export function useApp() {
  return useContext(AppContext);
}

// ── Toast state ───────────────────────────────────────────────────────────────

let _toastId = 0;

export function useToastState() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) { clearTimeout(timer); timers.current.delete(id); }
  }, []);

  const showToast = useCallback((message: string, type: ToastType = "success") => {
    const id = ++_toastId;
    setToasts(prev => [...prev.slice(-4), { id, message, type }]);
    const timer = setTimeout(() => dismiss(id), 3500);
    timers.current.set(id, timer);
  }, [dismiss]);

  return { toasts, showToast, dismiss };
}
