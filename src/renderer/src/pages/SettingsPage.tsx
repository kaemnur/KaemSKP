import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { CalendarDays, Cloud, Database, KeyRound, Save, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePickerField } from "@/components/ui/date-picker";
import { Input, Label, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/state";
import { api, isVercelDeployTarget } from "@/lib/api";
import { formatDateTimeWIB } from "@/lib/utils";

type SkpAuthStatus = {
  status: "connected" | "not_logged_in" | "expired" | "checking" | "error";
  message: string;
  lastCheckedAt: string;
};

const submitModes = [
  ["fill_only", "Auto isi saja", "Aplikasi mengisi form SKP dan berhenti sebelum konfirmasi."],
  ["confirm", "Auto isi + konfirmasi", "Aplikasi mengisi form lalu menunggu konfirmasi akhir dari pengguna."],
  ["auto_save", "Auto isi + simpan otomatis", "Aplikasi mengisi dan menyimpan otomatis saat data valid."]
] as const;

export function SettingsPage(): JSX.Element {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [session, setSession] = useState<SkpAuthStatus | null>(null);
  const [supabaseStatus, setSupabaseStatus] = useState<Record<string, unknown> | null>(null);
  const [saved, setSaved] = useState(false);
  const [dataNotice, setDataNotice] = useState<string | null>(null);
  const [theme, setTheme] = useState(() => localStorage.getItem("kaemskp-theme") ?? "light");

  async function load(): Promise<void> {
    setSettings(await api.getSettings());
    setSupabaseStatus(await api.getSupabaseStatus());
  }

  useEffect(() => {
    void load();
  }, []);

  function set(key: string, value: string): void {
    setSettings({ ...settings, [key]: value });
    setSaved(false);
  }

  async function save(): Promise<void> {
    await api.updateSettings(settings);
    setSaved(true);
    await load();
  }

  async function checkSession(): Promise<void> {
    if (isVercelDeployTarget) {
      setSession({ status: "not_logged_in", message: "Cek session browser SKP dijalankan oleh worker production, bukan browser Vercel.", lastCheckedAt: new Date().toISOString() });
      return;
    }
    setSession({ status: "checking", message: "Sedang mengecek session SKP.", lastCheckedAt: "" });
    setSession(await api.checkSession());
  }

  async function clearSession(): Promise<void> {
    if (isVercelDeployTarget) {
      setSession({ status: "not_logged_in", message: "Hapus session lokal hanya tersedia di aplikasi desktop.", lastCheckedAt: new Date().toISOString() });
      return;
    }
    setSession(await api.clearSession());
  }

  async function backupDatabase(): Promise<void> {
    const result = await api.backupDatabase() as { backupPath: string };
    setDataNotice(`Backup tersimpan: ${result.backupPath}`);
  }

  async function restoreDatabase(file: File | null): Promise<void> {
    if (!file) return;
    if (!window.confirm("Restore database akan mengganti database lokal aktif. Lanjutkan?")) return;
    await api.restoreDatabase(file);
    setDataNotice("Database berhasil direstore. Muat ulang halaman jika data belum berubah.");
    await load();
  }

  async function clearLocalLogs(): Promise<void> {
    if (!window.confirm("Hapus semua data log lokal, import batch, dan antrean? Pengaturan dan master SKP tetap disimpan.")) return;
    await api.clearLocalLogs();
    setDataNotice("Data log lokal berhasil dihapus.");
  }

  function updateTheme(value: string): void {
    const next = value === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : value;
    localStorage.setItem("kaemskp-theme", next);
    document.documentElement.classList.toggle("dark", next === "dark");
    window.dispatchEvent(new CustomEvent("kaemskp-theme-change", { detail: next }));
    setTheme(value);
  }

  return (
    <div className="page-shell">
      <div className="section-heading">
        <div>
          <h2 className="section-title">Pengaturan</h2>
          <p className="section-description">Atur preferensi aplikasi, jadwal otomatis, mode submit, data lokal, dan session SKP.</p>
        </div>
      </div>
      {saved && <Notice tone="success">Pengaturan tersimpan.</Notice>}

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card className="xl:col-span-2">
          <CardHeader className="dashboard-card-header">
            <div>
              <CardTitle>Aplikasi</CardTitle>
              <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">Preferensi dasar untuk koneksi SKP dan tampilan aplikasi.</p>
            </div>
            <Button onClick={save}><Save size={16} />Simpan Pengaturan</Button>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="md:col-span-2">
              <Label>Base URL SKP</Label>
              <Input value={settings.skp_base_url ?? ""} onChange={(e) => set("skp_base_url", e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <Label>Link umpan balik periodik</Label>
              <Input
                value={settings.periodic_feedback_link ?? "https://drive.google.com/drive/folders/1ln6FSUk550YVlnToaoZ1EUalAVjuIBWB"}
                onChange={(e) => set("periodic_feedback_link", e.target.value)}
              />
            </div>
            <div>
              <Label>Port aplikasi</Label>
              <Input value="3726" readOnly className="bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-400" />
            </div>
            <div>
              <Label>Tema</Label>
              <Select value={theme} onChange={(event) => updateTheme(event.target.value)}>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="system">System</option>
              </Select>
            </div>
            <div>
              <Label>Mode tabel ringkas</Label>
              <Select value={settings.compact_table_mode ?? "true"} onChange={(e) => set("compact_table_mode", e.target.value)}>
                <option value="true">Aktif</option>
                <option value="false">Nonaktif</option>
              </Select>
            </div>
            <div className="md:col-span-2 xl:col-span-3">
              <div className="flex gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm leading-6 text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300">
                <ShieldAlert size={16} className="mt-0.5 shrink-0" />
                Credential login dikelola di menu Profil. .env.local hanya digunakan sebagai fallback developer.
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Auto Run</CardTitle>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Jadwal otomatis untuk menjalankan pengiriman pada perangkat ini.</p>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SettingSelect label="Auto Run" value={settings.auto_run_enabled ?? "false"} onChange={(value) => set("auto_run_enabled", value)}>
              <option value="true">Aktif</option>
              <option value="false">Tidak Aktif</option>
            </SettingSelect>
            <div>
              <Label>Jam mulai</Label>
              <Input type="time" value={settings.auto_run_start_time ?? "08:00"} onChange={(e) => set("auto_run_start_time", e.target.value)} />
            </div>
            <div>
              <Label>Batas waktu</Label>
              <Input type="time" value={settings.retry_until_time ?? "16:00"} onChange={(e) => set("retry_until_time", e.target.value)} />
            </div>
            <div>
              <Label>Retry interval (menit)</Label>
              <Input type="number" min="1" value={settings.retry_interval_minutes ?? "10"} onChange={(e) => set("retry_interval_minutes", e.target.value)} />
            </div>
            <div>
              <Label>Batas retry</Label>
              <Input value={`Sampai ${settings.retry_until_time ?? "16:00"} WIB`} readOnly className="bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-400" />
            </div>
            <SettingSelect label="Hanya hari kerja" value={settings.weekend_is_holiday ?? "true"} onChange={(value) => set("weekend_is_holiday", value)}>
              <option value="true">Ya</option>
              <option value="false">Tidak</option>
            </SettingSelect>
            <SettingSelect label="Jalankan log hari ini otomatis" value={settings.auto_run_today_enabled ?? "true"} onChange={(value) => set("auto_run_today_enabled", value)}>
              <option value="true">Ya</option>
              <option value="false">Tidak</option>
            </SettingSelect>
            <SettingSelect label="Retry gagal hari ini" value={settings.auto_run_retry_failed_today ?? "true"} onChange={(value) => set("auto_run_retry_failed_today", value)}>
              <option value="true">Ya</option>
              <option value="false">Tidak</option>
            </SettingSelect>
            <SettingSelect label="Jalankan saat Windows menyala" value={settings.auto_start ?? "false"} onChange={(value) => set("auto_start", value)}>
              <option value="false">Tidak</option>
              <option value="true">Ya</option>
            </SettingSelect>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Supabase Online</CardTitle>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Status koneksi frontend dan kesiapan backend worker.</p>
          </CardHeader>
          <CardContent className="space-y-3">
            <StatusRow icon={<Cloud size={16} />} label="Frontend" active={Boolean(supabaseStatus?.frontendReady)} />
            <StatusRow icon={<KeyRound size={16} />} label="Secret backend" active={Boolean(supabaseStatus?.secretKeyConfigured)} />
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
              {String(supabaseStatus?.message ?? "Status Supabase belum dimuat.")}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Mode Submit</CardTitle>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Pilih seberapa jauh automasi mengisi dan menyimpan data di SKP.</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {submitModes.map(([value, title, helper]) => (
              <button
                key={value}
                type="button"
                onClick={() => set("submit_mode", value)}
                className={`w-full rounded-lg border px-3 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${settings.submit_mode === value ? "border-blue-300 bg-blue-50 dark:border-blue-500/40 dark:bg-blue-500/10" : "border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800/45"}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-slate-950 dark:text-slate-100">{title}</span>
                  {settings.submit_mode === value && <Badge status="matched">Aktif</Badge>}
                </div>
                <div className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{helper}</div>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Kalender Libur</CardTitle>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Tanggal merah dipakai oleh countdown dan worker Auto Post.</p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm leading-6 text-slate-600 dark:text-slate-300">
              Kelola tanggal merah, cuti, dan hari tanpa rencana kerja dari kalender.
            </div>
            <Link to="/kalender-libur" className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-800 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-600 dark:hover:bg-slate-800">
              <CalendarDays size={16} />Buka Kalender
            </Link>
          </CardContent>
        </Card>

        {!isVercelDeployTarget && <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Data Lokal</CardTitle>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Lokasi database, backup, restore, dan pembersihan data log lokal.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid min-w-0 gap-3 lg:grid-cols-[1fr_260px]">
              <div>
                <Label>Lokasi database</Label>
                <div className="truncate rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">{settings.db_path}</div>
              </div>
              <DatePickerField id="local-managed-start-date" label="Tanggal awal data lokal" value={settings.local_managed_start_date ?? "2026-04-01"} onChange={(value) => set("local_managed_start_date", value)} />
            </div>
            <div className="flex flex-col gap-2 border-t border-slate-100 pt-4 dark:border-slate-800 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={() => api.openDataDir()}><Database size={16} />Buka Lokasi</Button>
              <Button variant="secondary" onClick={backupDatabase}>Backup Database</Button>
              <label className="inline-flex h-10 cursor-pointer items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800">
                Restore Database
                <input className="hidden" type="file" accept=".db" onChange={(event) => restoreDatabase(event.target.files?.[0] ?? null)} />
              </label>
              <Button variant="danger" onClick={clearLocalLogs}>Hapus Data Lokal</Button>
            </div>
            {dataNotice && <Notice tone="success">{dataNotice}</Notice>}
          </CardContent>
        </Card>}

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Session SKP</CardTitle>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Cek koneksi session browser SKP atau hapus session lokal saat login perlu diulang.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="text-sm leading-6 text-slate-600 dark:text-slate-300">
                Username dan password tidak diatur di sini. Kelola credential login dari menu Profil agar tidak tumpang tindih dengan preferensi aplikasi.
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                {isVercelDeployTarget && <Notice tone="warning">Fitur session lokal tersedia melalui aplikasi desktop atau worker production.</Notice>}
                {!isVercelDeployTarget && <>
                <Button variant="secondary" onClick={checkSession}><KeyRound size={16} />Cek Session</Button>
                <Button variant="secondary" onClick={clearSession}>Hapus Session</Button>
                </>}
                <Link to="/profil" className="inline-flex h-10 items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-800 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-600 dark:hover:bg-slate-800">
                  Buka Profil
                </Link>
              </div>
            </div>
            {session && (
              <Badge status={session.status}>
                {session.message}
                {session.lastCheckedAt ? ` - ${formatDateTimeWIB(session.lastCheckedAt)}` : ""}
              </Badge>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function StatusRow({ icon, label, active }: { icon: ReactNode; label: string; active: boolean }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-slate-100 px-3 py-2 text-sm dark:border-slate-800">
      <div className="flex min-w-0 items-center gap-2 text-slate-600 dark:text-slate-300">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <Badge status={active ? "success" : "waiting_date"}>{active ? "Siap" : "Belum"}</Badge>
    </div>
  );
}

function SettingSelect({
  label,
  value,
  onChange,
  children
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <div>
      <Label>{label}</Label>
      <Select value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </Select>
    </div>
  );
}
