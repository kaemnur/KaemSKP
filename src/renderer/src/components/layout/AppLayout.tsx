import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { CalendarCheck, ClipboardList, FileText, Home, KeyRound, Loader2, LogOut, Moon, RefreshCw, Settings, Sun, UserRound } from "lucide-react";
import { AppLogo } from "@/components/layout/AppLogo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { isSupabaseFrontendConfigured, supabase } from "@/lib/supabase";
import { cn, formatRealtimeWIB, statusLabel } from "@/lib/utils";

const menu = [
  { to: "/beranda", label: "Beranda", icon: Home },
  { to: "/profil", label: "Profil", icon: UserRound },
  { to: "/rencana-skp", label: "Rencana SKP", icon: FileText },
  { to: "/log-harian", label: "Log Harian", icon: ClipboardList },
  { to: "/kirim-skp", label: "Kirim ke SKP", icon: RefreshCw },
  { to: "/skp-periodik", label: "SKP Periodik", icon: CalendarCheck },
  { to: "/pengaturan", label: "Pengaturan", icon: Settings }
];

const pageMeta = [
  { match: "/beranda", title: "Beranda", description: "Ringkasan cepat Log Harian dan sinkronisasi SKP." },
  { match: "/profil", title: "Profil", description: "Kelola username dan password SKP lokal perangkat ini." },
  { match: "/rencana-skp", title: "Rencana SKP", description: "Kelola rencana aktif, master SKP, mapping website, dan import PDF Rencana SKP." },
  { match: "/log-harian", title: "Log Harian", description: "Kelola daftar log, input manual, dan import Excel." },
  { match: "/kirim-skp", title: "Kirim ke SKP", description: "Kirim data lokal ke SKP dengan antrean dan progress yang jelas." },
  { match: "/skp-periodik", title: "SKP Periodik", description: "Generate realisasi triwulan, isi umpan balik, dan ajukan periodik dari Log Harian lokal." },
  { match: "/kalender-libur", title: "Kalender Libur", description: "Kelola tanggal merah dan hari nonaktif untuk Auto Post." },
  { match: "/pengaturan", title: "Pengaturan", description: "Atur preferensi aplikasi, auto run, mode submit, data lokal, dan session." }
];

type SkpStatus = {
  status: "connected" | "not_logged_in" | "expired" | "checking" | "error";
  message: string;
};

type ThemeMode = "light" | "dark";

function readStoredTheme(): ThemeMode {
  return localStorage.getItem("kaemskp-theme") === "dark" ? "dark" : "light";
}

export function AppLayout(): JSX.Element {
  const location = useLocation();
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authUserEmail, setAuthUserEmail] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState<"checking" | "login" | "logout" | null>("checking");
  const [authError, setAuthError] = useState<string | null>(null);
  const [session, setSession] = useState<SkpStatus>({ status: "checking", message: "Mengecek session..." });
  const [busy, setBusy] = useState<"check" | "login" | null>(null);
  const [clock, setClock] = useState(formatRealtimeWIB());
  const [theme, setTheme] = useState<ThemeMode>(readStoredTheme);

  const meta = useMemo(
    () => pageMeta.find((item) => location.pathname.startsWith(item.match)) ?? pageMeta[0],
    [location.pathname]
  );

  async function loadSession(): Promise<void> {
    if (!authUserEmail) return;
    setSession(await api.authStatus());
  }

  async function loginSupabase(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!supabase) {
      setAuthError("Konfigurasi Supabase frontend belum lengkap.");
      return;
    }
    setAuthBusy("login");
    setAuthError(null);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: authEmail.trim(), password: authPassword });
      if (error) throw error;
      setAuthUserEmail(data.user.email ?? authEmail.trim());
      setAuthPassword("");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Login Supabase gagal.");
    } finally {
      setAuthBusy(null);
    }
  }

  async function logoutSupabase(): Promise<void> {
    if (!supabase) return;
    setAuthBusy("logout");
    await supabase.auth.signOut();
    setAuthUserEmail(null);
    setSession({ status: "not_logged_in", message: "Belum login ke SKP." });
    setAuthBusy(null);
  }

  async function checkSession(): Promise<void> {
    setBusy("check");
    setSession({ status: "checking", message: "Mengecek session..." });
    try {
      setSession(await api.checkSession());
    } finally {
      setBusy(null);
    }
  }

  async function login(): Promise<void> {
    setBusy("login");
    setSession({ status: "checking", message: "Membuka login SKP..." });
    try {
      setSession(await api.openLogin());
    } finally {
      setBusy(null);
    }
  }

  function setAndStoreTheme(next: ThemeMode): void {
    setTheme(next);
    localStorage.setItem("kaemskp-theme", next);
    window.dispatchEvent(new CustomEvent("kaemskp-theme-change", { detail: next }));
  }

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    document.title = meta.title ? `KaemSKP - ${meta.title}` : "KaemSKP";
  }, [meta.title]);

  useEffect(() => {
    if (!authUserEmail) return undefined;
    void loadSession();
    const sessionTimer = window.setInterval(() => void loadSession(), 15000);
    return () => window.clearInterval(sessionTimer);
  }, [authUserEmail]);

  useEffect(() => {
    const clockTimer = window.setInterval(() => setClock(formatRealtimeWIB()), 1000);
    const themeListener = (): void => setTheme(readStoredTheme());
    window.addEventListener("kaemskp-theme-change", themeListener);
    return () => {
      window.clearInterval(clockTimer);
      window.removeEventListener("kaemskp-theme-change", themeListener);
    };
  }, []);

  useEffect(() => {
    if (!supabase) {
      setAuthBusy(null);
      return undefined;
    }
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setAuthUserEmail(data.session?.user.email ?? null);
      setAuthBusy(null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, sessionValue) => {
      setAuthUserEmail(sessionValue?.user.email ?? null);
      setAuthBusy(null);
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const needsLogin = ["not_logged_in", "expired", "error"].includes(session.status);

  if (!isSupabaseFrontendConfigured) {
    return <AuthShell title="Supabase belum dikonfigurasi" message="VITE_SUPABASE_URL dan VITE_SUPABASE_PUBLISHABLE_KEY wajib tersedia di frontend." />;
  }

  if (!authUserEmail) {
    return (
      <AuthShell title="Login KaemSKP" message="Masuk dengan email user Supabase yang sudah dibuat.">
        <form className="mt-5 space-y-3" onSubmit={loginSupabase}>
          <input
            className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900"
            type="email"
            value={authEmail}
            onChange={(event) => setAuthEmail(event.target.value)}
            placeholder="Email Supabase"
            autoComplete="email"
            required
          />
          <input
            className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900"
            type="password"
            value={authPassword}
            onChange={(event) => setAuthPassword(event.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            required
          />
          {authError && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">{authError}</div>}
          <Button className="w-full" disabled={authBusy !== null}>
            {authBusy === "login" || authBusy === "checking" ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound size={16} />}
            {authBusy === "login" || authBusy === "checking" ? "Masuk..." : "Login"}
          </Button>
        </form>
      </AuthShell>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground transition-colors lg:flex-row">
      <aside className="shrink-0 border-b border-slate-200 bg-white/95 dark:border-slate-800 dark:bg-slate-950 lg:flex lg:w-64 lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-4 py-4 dark:border-slate-800 lg:block">
          <AppLogo />
          <div className="hidden rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-500 dark:border-slate-800 dark:text-slate-400 sm:block lg:mt-4 lg:inline-flex">
            Port 3726
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 py-3 lg:flex-1 lg:flex-col lg:overflow-visible lg:py-4" aria-label="Menu utama">
          {menu.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "group inline-flex h-10 shrink-0 items-center gap-3 rounded-md px-3 text-sm font-medium text-slate-600 transition duration-200 hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-100 lg:w-full",
                  isActive && "bg-blue-50 text-blue-700 shadow-sm shadow-blue-950/[0.03] ring-1 ring-blue-100 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/20"
                )
              }
            >
              <item.icon size={17} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="hidden border-t border-slate-100 px-4 py-4 text-xs leading-5 text-slate-500 dark:border-slate-800 dark:text-slate-400 lg:block">
          Data dan sesi tersimpan di perangkat ini.
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm shadow-slate-950/[0.02] backdrop-blur dark:border-slate-800 dark:bg-slate-950/90 sm:px-5 xl:px-6">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold text-slate-950 dark:text-slate-100">{meta.title}</h1>
              <p className="line-clamp-2 text-sm leading-6 text-slate-500 dark:text-slate-400">{meta.description}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="hidden rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium tabular-nums text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 md:block">
                {clock}
              </div>
              <Badge status={session.status} className="min-h-9 max-w-full">
                {busy === "check" ? "Mengecek session..." : statusLabel(session.status)}
              </Badge>
              <div className="hidden max-w-[220px] truncate rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 md:block">
                {authUserEmail}
              </div>
              <Button size="sm" variant="secondary" disabled={busy !== null} onClick={checkSession}>
                {busy === "check" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw size={14} />}
                {busy === "check" ? "Mengecek..." : "Cek"}
              </Button>
              {needsLogin && (
                <Button size="sm" disabled={busy !== null} onClick={login}>
                  {busy === "login" ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound size={14} />}
                  {busy === "login" ? "Membuka..." : "Login SKP"}
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                aria-label={theme === "dark" ? "Gunakan light mode" : "Gunakan dark mode"}
                title={theme === "dark" ? "Light mode" : "Dark mode"}
                onClick={() => setAndStoreTheme(theme === "dark" ? "light" : "dark")}
              >
                {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
              </Button>
              <Button size="icon" variant="ghost" aria-label="Logout Supabase" title="Logout" disabled={authBusy !== null} onClick={logoutSupabase}>
                {authBusy === "logout" ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut size={17} />}
              </Button>
            </div>
          </div>
          <div className="mt-2 text-xs font-medium tabular-nums text-slate-500 dark:text-slate-400 md:hidden">{clock}</div>
        </header>
        <div className="min-h-0 flex-1">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function AuthShell({ title, message, children }: { title: string; message: string; children?: ReactNode }): JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <AppLogo />
        <h1 className="mt-5 text-lg font-semibold text-slate-950 dark:text-slate-100">{title}</h1>
        <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{message}</p>
        {children}
      </div>
    </div>
  );
}
