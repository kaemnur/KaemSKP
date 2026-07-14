import { useEffect, useState } from "react";
import { CheckCircle2, KeyRound, Save, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/field";
import { Notice } from "@/components/ui/state";
import { api, isVercelDeployTarget } from "@/lib/api";
import { cn, formatDateTimeWIB } from "@/lib/utils";

type Profile = {
  namaPegawai: string;
  nipUsername: string;
  password: string;
  hasPassword: boolean;
  unitKerja: string;
  jabatan: string;
  tahunSkpAktif: string;
  periodeSkp: string;
  baseUrlSkp: string;
  updatedAt?: string;
  storagePath: string;
};

type AuthStatus = {
  status: "connected" | "not_logged_in" | "expired" | "checking" | "error";
  message: string;
  lastCheckedAt: string;
};

const PASSWORD_MASK = "********";
const DISPLAY_MASK = "**********";

const emptyProfile: Profile = {
  namaPegawai: "",
  nipUsername: "",
  password: "",
  hasPassword: false,
  unitKerja: "",
  jabatan: "",
  tahunSkpAktif: "2026",
  periodeSkp: "2026-01-01 s/d 2026-12-31",
  baseUrlSkp: "https://skp.sdm.kemendikdasmen.go.id",
  storagePath: ""
};

export function ProfilePage(): JSX.Element {
  const [profile, setProfile] = useState<Profile>(emptyProfile);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<"load" | "save" | "login" | "delete" | null>("load");
  const [auth, setAuth] = useState<AuthStatus | null>(null);

  async function load(): Promise<void> {
    setBusy("load");
    try {
      const [profileResult, credentialStatus] = await Promise.all([
        api.getProfile() as Promise<Profile>,
        api.skpCredentialStatus() as Promise<{ configured: boolean }>
      ]);
      setProfile({
        ...emptyProfile,
        ...profileResult,
        password: "",
        hasPassword: credentialStatus.configured
      });
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function set(key: keyof Profile, value: string): void {
    setProfile((current) => ({ ...current, [key]: value }));
    setMessage(null);
  }

  async function save(): Promise<void> {
    setBusy("save");
    try {
      if (!profile.password && !profile.hasPassword) {
        throw new Error("Password SKP wajib diisi untuk menyimpan credential.");
      }
      if (profile.password) {
        await api.saveSkpCredentials({ username: profile.nipUsername, password: profile.password });
      }
      const payload = {
        nipUsername: profile.nipUsername,
        baseUrlSkp: profile.baseUrlSkp
      };
      const saved = (await api.saveProfile(payload)) as Profile;
      setProfile({ ...emptyProfile, ...saved, password: "", hasPassword: true });
      setMessage("Credential SKP tersimpan terenkripsi.");
    } finally {
      setBusy(null);
    }
  }

  async function testLogin(): Promise<void> {
    if (isVercelDeployTarget) {
      setAuth({ status: "not_logged_in", message: "Tes login interaktif hanya tersedia di desktop lokal. Worker production memakai Chromium headless.", lastCheckedAt: new Date().toISOString() });
      return;
    }
    setBusy("login");
    setAuth({ status: "checking", message: "Membuka login SKP...", lastCheckedAt: "" });
    try {
      setAuth((await api.testProfileLogin()) as AuthStatus);
    } finally {
      setBusy(null);
    }
  }

  async function clearCredentials(): Promise<void> {
    if (!window.confirm("Hapus username dan password SKP? Login berikutnya akan manual jika credential kosong.")) return;
    setBusy("delete");
    try {
      await api.deleteSkpCredentials();
      setProfile((current) => ({ ...current, password: "", hasPassword: false }));
      setMessage("Username dan password SKP dihapus.");
    } finally {
      setBusy(null);
    }
  }

  function useStoredCredential(): void {
    if (!profile.nipUsername || !profile.hasPassword) {
      setMessage("Lengkapi username dan password dulu, lalu simpan credential.");
      return;
    }
    setMessage("Credential ini sudah menjadi sumber login aktif.");
  }

  const hasStoredCredential = Boolean(profile.nipUsername || profile.hasPassword);
  const hasCompleteCredential = Boolean(profile.nipUsername && profile.hasPassword);
  const storedPasswordText = profile.hasPassword ? DISPLAY_MASK : "Belum disimpan";

  return (
    <div className="page-shell">
      <div className="section-heading">
        <div>
          <h2 className="section-title">Profil Login SKP</h2>
          <p className="section-description">Simpan username dan password SKP untuk auto-login lokal di perangkat ini.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={testLogin} disabled={busy !== null || isVercelDeployTarget}>
            <KeyRound size={16} />Tes Login SKP
          </Button>
          <Button onClick={save} disabled={busy !== null}>
            <Save size={16} />Simpan Credential
          </Button>
        </div>
      </div>

      {message && <Notice tone="success"><CheckCircle2 size={16} />{message}</Notice>}

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)] xl:items-start">
        <Card>
          <CardHeader>
            <CardTitle>Credential Login</CardTitle>
            <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
              Hanya username dan password yang dipakai untuk login otomatis ke SKP.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <Label>Username / NIP SKP</Label>
                <Input
                  value={profile.nipUsername}
                  onChange={(event) => set("nipUsername", event.target.value)}
                  autoComplete="username"
                  placeholder="Masukkan NIP atau username SKP"
                />
              </div>
              <div>
                <Label>Password SKP</Label>
                <Input type="password" value={profile.password} placeholder={profile.hasPassword ? "Isi untuk mengganti password" : "Password SKP"} onChange={(event) => set("password", event.target.value)} autoComplete="current-password" />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={save} disabled={busy !== null}>
                <Save size={16} />Simpan Credential
              </Button>
              <Button variant="secondary" onClick={testLogin} disabled={busy !== null || isVercelDeployTarget}>
                <KeyRound size={16} />Tes Login SKP
              </Button>
              <Button variant="secondary" onClick={clearCredentials} disabled={busy !== null || !hasStoredCredential}>
                <Trash2 size={16} />Hapus Username & Password
              </Button>
            </div>

            {auth && (
              <Notice tone={auth.status === "connected" ? "success" : auth.status === "checking" ? "info" : "warning"}>
                {auth.message}
                {auth.lastCheckedAt ? ` - ${formatDateTimeWIB(auth.lastCheckedAt)}` : ""}
              </Notice>
            )}
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader className="dashboard-card-header">
              <div>
                <CardTitle>Credential Tersimpan</CardTitle>
                <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">Password masked secara default.</p>
              </div>
              <Badge status={hasCompleteCredential ? "matched" : "needs_review"}>
                {hasCompleteCredential ? "Aktif" : "Belum lengkap"}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4 p-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/70">
                <CredentialLine label="Username/NIP" value={profile.nipUsername || "Belum disimpan"} />
                <div className="mt-3 flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Password</div>
                    <div className={cn("mt-1 min-h-6 truncate font-mono text-sm font-semibold tabular-nums text-slate-500 dark:text-slate-400")}>
                      {storedPasswordText}
                    </div>
                  </div>
                </div>
              </div>

              <Notice tone="info">
                <ShieldCheck size={16} /> Password disimpan terenkripsi dan tidak pernah dikirim kembali ke frontend.
              </Notice>

              {profile.updatedAt && <div className="text-xs text-slate-500 dark:text-slate-400">Update terakhir: {formatDateTimeWIB(profile.updatedAt)}</div>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>User Tersimpan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4">
              {hasStoredCredential ? (
                <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm shadow-slate-950/[0.03] dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-700 ring-1 ring-blue-100 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/20">
                      <UserRound size={17} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-950 dark:text-slate-100">{profile.nipUsername || "Username belum disimpan"}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Badge status={hasCompleteCredential ? "matched" : "needs_review"}>
                          {hasCompleteCredential ? "Digunakan" : "Belum lengkap"}
                        </Badge>
                        <span className="text-xs text-slate-500 dark:text-slate-400">Sumber login aktif</span>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={useStoredCredential} disabled={busy !== null}>
                      Gunakan
                    </Button>
                    <Button size="sm" variant="danger" onClick={clearCredentials} disabled={busy !== null}>
                      <Trash2 size={14} />Hapus
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm leading-6 text-slate-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-400">
                  Belum ada credential tersimpan. Jika kosong, Login SKP akan berjalan manual.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}

function CredentialLine({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-slate-950 dark:text-slate-100">{value}</div>
    </div>
  );
}
