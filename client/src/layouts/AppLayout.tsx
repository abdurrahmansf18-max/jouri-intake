import { NavLink, useLocation } from "react-router-dom";
import {
  ArchiveIcon,
  HardDrive,
  LayoutDashboard,
  Languages,
  LogOut,
  Moon,
  PackageCheck,
  PackagePlus,
  ShoppingBag,
  Sun,
} from "lucide-react";
import { useApp } from "../context";
import { COPY, cn } from "../i18n";
import { DARK, LIGHT } from "../theme";
import type { Locale } from "../types";

interface NavItem {
  to: string;
  labelKey: "navDashboard" | "navAddProduct" | "navProducts" | "navArchive" | "navBackup";
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", labelKey: "navDashboard", icon: <LayoutDashboard className="size-5" /> },
  { to: "/add",       labelKey: "navAddProduct", icon: <PackagePlus className="size-5" /> },
  { to: "/products",  labelKey: "navProducts",   icon: <ShoppingBag className="size-5" /> },
  { to: "/archive",   labelKey: "navArchive",    icon: <ArchiveIcon className="size-5" /> },
  { to: "/backup",    labelKey: "navBackup",     icon: <HardDrive className="size-5" /> },
];

interface Props {
  children: React.ReactNode;
  onLogout?: () => void;
}

export default function AppLayout({ children, onLogout }: Props) {
  const { locale, setLocale, theme, setTheme } = useApp();
  const t = COPY[locale];
  const s = theme === "dark" ? DARK : LIGHT;
  const dir = locale === "ar" ? "rtl" : "ltr";

  return (
    <div className={cn("min-h-screen flex flex-col", s.page)} dir={dir}>
      {/* ── Top Navbar ── */}
      <header className={cn("sticky top-0 z-40 border-b", s.header)}>
        <div className="flex h-14 items-center gap-3 px-3 sm:px-5">
          {/* Logo */}
          <div className="flex min-w-0 items-center gap-2.5">
            <div className={cn("flex size-8 items-center justify-center rounded-lg", s.logo)}>
              <PackageCheck className="size-4" />
            </div>
            <span className={cn("max-w-[8rem] truncate text-base font-black tracking-tight sm:max-w-none", s.title)}>{t.appTitle}</span>
          </div>

          {/* Controls */}
          <div className="ms-auto flex shrink-0 items-center gap-1.5">
            {/* Language toggle */}
            <div className={cn("hidden sm:inline-flex items-center gap-0.5 rounded-lg border p-1", s.controlGroup)}>
              <Languages className={cn("mx-1 size-3.5", s.muted)} />
              {(["tr", "ar"] as Locale[]).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLocale(l)}
                  className={cn(
                    "rounded-md px-2 py-1 text-xs font-extrabold transition",
                    locale === l ? s.controlActive : s.controlIdle,
                  )}
                >
                  {l === "tr" ? "TR" : "عربي"}
                </button>
              ))}
            </div>

            {/* Theme toggle */}
            <button
              type="button"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className={cn("inline-flex size-8 items-center justify-center rounded-lg border transition", s.controlGroup, s.controlIdle)}
              title={theme === "dark" ? t.lightMode : t.darkMode}
              aria-label={theme === "dark" ? t.lightMode : t.darkMode}
            >
              {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>

            {/* Mobile lang toggle */}
            <button
              type="button"
              onClick={() => setLocale(locale === "tr" ? "ar" : "tr")}
              className={cn("sm:hidden inline-flex size-8 items-center justify-center rounded-lg border transition text-xs font-extrabold", s.controlGroup, s.controlIdle)}
              aria-label="Toggle language"
            >
              {locale === "tr" ? "ع" : "TR"}
            </button>

            {/* Logout */}
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className={cn("inline-flex size-8 items-center justify-center rounded-lg border transition", s.controlGroup, s.controlIdle)}
                title={t.logout}
                aria-label={t.logout}
              >
                <LogOut className="size-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0">
        {/* Desktop sidebar */}
        <aside className={cn("hidden md:flex flex-col w-52 shrink-0 border-e py-4 gap-1 px-2", s.header, s.panelBorder)}>
          {NAV_ITEMS.map((item) => (
            <SidebarNavLink key={item.to} item={item} locale={locale} />
          ))}
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 overflow-y-auto pb-20 md:pb-0">
          <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 sm:py-6">
            {children}
          </div>
        </main>
      </div>

      {/* ── Mobile bottom nav ── */}
      <nav className={cn("md:hidden fixed bottom-0 inset-x-0 z-40 flex border-t", s.header)}>
        {NAV_ITEMS.map((item) => (
          <MobileNavLink key={item.to} item={item} locale={locale} />
        ))}
      </nav>
    </div>
  );
}

function SidebarNavLink({ item, locale }: { item: NavItem; locale: Locale }) {
  const t = COPY[locale];
  const { theme } = useApp();
  const s = theme === "dark" ? DARK : LIGHT;

  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-extrabold transition",
          isActive
            ? cn(s.controlActive, "shadow-sm")
            : s.controlIdle,
        )
      }
    >
      {item.icon}
      {t[item.labelKey]}
    </NavLink>
  );
}

function MobileNavLink({ item, locale }: { item: NavItem; locale: Locale }) {
  const t = COPY[locale];
  const { theme } = useApp();
  const s = theme === "dark" ? DARK : LIGHT;
  const location = useLocation();
  const isActive = location.pathname === item.to;

  return (
    <NavLink
      to={item.to}
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[10px] font-extrabold transition",
        isActive ? (theme === "dark" ? "text-violet-400" : "text-violet-600") : s.muted,
      )}
    >
      {item.icon}
      <span>{t[item.labelKey]}</span>
    </NavLink>
  );
}
