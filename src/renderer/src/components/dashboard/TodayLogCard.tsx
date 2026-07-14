import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, ClipboardList, Loader2, Play, RefreshCw, Send } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { api, isVercelDeployTarget } from "@/lib/api";
import { cn, formatDate, formatDateTimeWIB, friendlyErrorMessage, statusLabel, todayDateKeyWIB } from "@/lib/utils";

type TodayLogState = "no_log" | "not_submitted" | "queued" | "running" | "submitted" | "failed" | "future" | "needs_review" | "error";
type TodayLogPayload = {
  id: string;
  tanggal: string;
  namaAktivitas: string | null;
  deskripsi: string | null;
  kodeSkp: string | null;
  namaSkp: string | null;
  statusLocal: string;
  statusSkp: string;
  lastSyncAt: string | null;
  lastError: string | null;
  lastErrorCode: string | null;
  currentUrl: string | null;
  automationStep: string | null;
  screenshotPath: string | null;
};
type TodayLogStatus = {
  success: boolean;
  date: string;
  displayDate: string;
  hasLog: boolean;
  logCount: number;
  state: TodayLogState;
  sessionStatus: string;
  requiresLogin: boolean;
  canSubmit: boolean;
  message: string;
  activeQueue: { id: string; jobId: string; status: string; startedAt: string | null; finishedAt: string | null } | null;
  log: TodayLogPayload | null;
};

export function TodayLogCard({
  compact = false,
  onChanged
}: {
  compact?: boolean;
  onChanged?: () => void | Promise<void>;
}): JSX.Element {
  const [status, setStatus] = useState<TodayLogStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  async function load(showLoading = false): Promise<void> {
    if (showLoading) setLoading(true);
    try {
      const next = normalizeTodayLogStatus(await api.getTodayLogStatus());
      setStatus(next);
      setError(next.success ? null : next.message);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Status log hari ini gagal dimuat.";
      setStatus(buildErrorStatus(message));
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(true);
    const timer = window.setInterval(() => void load(false), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  async function runNow(): Promise<void> {
    if (!status?.canSubmit || busy || syncing) return;
    if (isVercelDeployTarget) {
      setError("Kirim manual dari Vercel dinonaktifkan. Worker Railway menjalankan Auto Post production.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.runToday();
      await load(false);
      await onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Log hari ini gagal diproses.");
      await load(false);
    } finally {
      setBusy(false);
    }
  }

  async function reconcileToday(): Promise<void> {
    if (!status?.log || busy || syncing) return;
    setSyncing(true);
    setError(null);
    try {
      const result = await api.reconcileLog(status.log.id) as { success: boolean; foundOnSkp: boolean; message: string };
      if (!result.success || !result.foundOnSkp) setError(result.message);
      await load(false);
      await onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cek status ke SKP gagal.");
      await load(false);
    } finally {
      setSyncing(false);
    }
  }

  const condition = useMemo(() => getCondition(status, busy, syncing, loading), [status, busy, syncing, loading]);
  const log = status?.log ?? null;
  const errorSummary = friendlyErrorMessage(log?.lastError);
  const skpText = log?.kodeSkp ? `${log.kodeSkp}${log.namaSkp ? ` - ${log.namaSkp}` : ""}` : "-";

  return (
    <>
      <Card className="h-full">
        <CardHeader className="dashboard-card-header">
          <div className="min-w-0">
            <CardTitle>Log Hari Ini</CardTitle>
            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{status?.displayDate ?? "Memuat tanggal hari ini..."}</p>
          </div>
          <Badge status={condition.badgeStatus}>
            {busy && <Loader2 className="h-3 w-3 animate-spin" />}
            {condition.badgeLabel}
          </Badge>
        </CardHeader>
        <CardContent className={cn("space-y-4 p-4", compact && "pt-2")}>
          <div className="flex min-w-0 items-start gap-3">
            <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-md shadow-sm ring-1", condition.iconClass)}>
              {condition.icon}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">{condition.title}</div>
              <div className={cn("mt-1 line-clamp-2 text-sm leading-6", condition.messageClass)}>
                {condition.message}
              </div>
              {error && <div className="mt-1 line-clamp-2 text-xs leading-5 text-red-700 dark:text-red-300">{error}</div>}
            </div>
          </div>

          {busy && (
            <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300">
              <Loader2 className="h-4 w-4 animate-spin" />
              Sedang mengirim log hari ini...
            </div>
          )}

          {syncing && (
            <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300">
              <Loader2 className="h-4 w-4 animate-spin" />
              Sedang mengecek status di SKP...
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <InfoRow label="Tanggal" value={status?.displayDate ?? "-"} />
            <InfoRow label="Aktivitas" value={log?.namaAktivitas ?? "-"} />
            <InfoRow label="SKP terkait" value={skpText} wide />
            <InfoRow label="Status lokal" value={<Badge status={log?.statusLocal ?? status?.state}>{log ? statusLabel(log.statusLocal) : statusLabel(status?.state)}</Badge>} />
            <InfoRow label="Status SKP" value={<Badge status={log?.statusSkp ?? status?.state}>{log ? statusLabel(log.statusSkp) : statusLabel(status?.state)}</Badge>} />
            <InfoRow label="Terakhir sinkron" value={formatDateTimeWIB(log?.lastSyncAt)} />
          </div>

          {log?.deskripsi && !compact && (
            <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-600 dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-300">
              <div className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">Deskripsi</div>
              <div className="line-clamp-2">{log.deskripsi}</div>
            </div>
          )}

          <div className="flex flex-col gap-2 border-t border-slate-100 pt-3 dark:border-slate-800 sm:flex-row sm:flex-wrap sm:justify-end">
            {condition.actions.includes("input") && <ActionLink to={`/log-harian?tab=input-manual&tanggal=${status?.date ?? ""}`} icon={<ClipboardList size={16} />} label="Input Log Hari Ini" />}
            {condition.actions.includes("queue") && <ActionLink to="/kirim-skp?tab=antrean" icon={<RefreshCw size={16} />} label="Lihat Antrean" variant="secondary" />}
            {condition.actions.includes("data") && <ActionLink to={`/log-harian?tab=daftar-log&date=${status?.date ?? ""}`} icon={<ClipboardList size={16} />} label="Lihat Data" variant="secondary" />}
            {condition.actions.includes("send") && (
              <Button disabled={busy || syncing || !status?.canSubmit || isVercelDeployTarget} onClick={() => void runNow()} className="w-full sm:w-auto">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send size={16} />}
                Kirim Sekarang
              </Button>
            )}
            {condition.actions.includes("sync") && (
              <Button variant="secondary" disabled={busy || syncing || !log} onClick={() => void reconcileToday()} className="w-full sm:w-auto">
                {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw size={16} />}
                Sinkronkan Status
              </Button>
            )}
            {condition.actions.includes("retry") && (
              <Button disabled={busy || syncing || !status?.canSubmit || isVercelDeployTarget} onClick={() => void runNow()} className="w-full sm:w-auto">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play size={16} />}
                Coba Lagi
              </Button>
            )}
            {condition.actions.includes("error") && (
              <Button variant="secondary" disabled={!log?.lastError && !log?.lastErrorCode} onClick={() => setDetailOpen(true)} className="w-full sm:w-auto">
                <AlertTriangle size={16} />Detail Error
              </Button>
            )}
            {condition.actions.includes("reload") && (
              <Button variant="secondary" disabled={loading} onClick={() => void load(true)} className="w-full sm:w-auto">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw size={16} />}
                Coba Muat Ulang
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      {detailOpen && log && <ErrorDetailModal log={log} summary={errorSummary} onClose={() => setDetailOpen(false)} />}
    </>
  );
}

function InfoRow({ label, value, wide = false }: { label: string; value: ReactNode; wide?: boolean }): JSX.Element {
  return (
    <div className={cn("min-w-0 rounded-md border border-slate-100 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900", wide && "sm:col-span-2")}>
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 min-w-0 truncate text-sm font-medium text-slate-900 dark:text-slate-100">{value || "-"}</div>
    </div>
  );
}

function ActionLink({ to, icon, label, variant = "primary" }: { to: string; icon: ReactNode; label: string; variant?: "primary" | "secondary" }): JSX.Element {
  return (
    <Link
      to={to}
      className={cn(
        "inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border px-4 text-sm font-medium shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:w-auto",
        variant === "primary" && "border-blue-700 bg-blue-700 text-white hover:bg-blue-800 dark:border-blue-500 dark:bg-blue-500 dark:text-slate-950 dark:hover:bg-blue-400",
        variant === "secondary" && "border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-slate-600 dark:hover:bg-slate-800"
      )}
    >
      {icon}
      {label}
    </Link>
  );
}

function ErrorDetailModal({ log, summary, onClose }: { log: TodayLogPayload; summary: ReturnType<typeof friendlyErrorMessage>; onClose: () => void }): JSX.Element {
  const parsed = parseLastError(log);
  const rows = [
    ["Kode Error", log.lastErrorCode || parsed.errorCode || summary.code],
    ["Pesan Error", parsed.message || summary.message],
    ["Tahap Automasi", log.automationStep || parsed.automationStep],
    ["Halaman Saat Error", log.currentUrl || parsed.currentUrl],
    ["Validasi Website", parsed.validationText],
    ["Opsi SKP Website", parsed.availableSkpOptions],
    ["Screenshot Error", log.screenshotPath || parsed.screenshotPath],
    ["Terakhir Sinkron", formatDateTimeWIB(log.lastSyncAt)]
  ];
  return (
    <Modal title="Detail Error Log Hari Ini" description="Ringkasan error terakhir untuk log hari ini." onClose={onClose}>
      <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className={["Pesan Error", "Halaman Saat Error", "Validasi Website", "Opsi SKP Website", "Screenshot Error"].includes(label) ? "md:col-span-2" : ""}>
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
            <div className="mt-1 whitespace-pre-wrap rounded-md bg-slate-50 px-3 py-2 dark:bg-slate-950">{value || "-"}</div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function parseLastError(log: TodayLogPayload): {
  errorCode: string;
  message: string;
  currentUrl: string;
  automationStep: string;
  validationText: string;
  availableSkpOptions: string;
  screenshotPath: string;
} {
  if (!log.lastError) {
    return { errorCode: "", message: "", currentUrl: "", automationStep: "", validationText: "", availableSkpOptions: "", screenshotPath: "" };
  }
  try {
    const parsed = JSON.parse(log.lastError) as Record<string, string | string[] | null>;
    return {
      errorCode: String(parsed.error_code ?? ""),
      message: String(parsed.error_message ?? parsed.message ?? ""),
      currentUrl: String(parsed.current_url ?? ""),
      automationStep: String(parsed.automation_step ?? parsed.step ?? ""),
      validationText: String(parsed.validation_text ?? ""),
      availableSkpOptions: Array.isArray(parsed.available_skp_options) ? parsed.available_skp_options.join("\n") : String(parsed.available_skp_options ?? ""),
      screenshotPath: String(parsed.screenshot_path ?? "")
    };
  } catch {
    return { errorCode: "", message: log.lastError, currentUrl: "", automationStep: "", validationText: "", availableSkpOptions: "", screenshotPath: "" };
  }
}

function normalizeTodayLogStatus(value: unknown): TodayLogStatus {
  if (!value || typeof value !== "object") {
    throw new Error("Endpoint status log hari ini belum mengembalikan JSON valid.");
  }
  const record = value as Partial<TodayLogStatus> & { message?: string };
  const state = isTodayLogState(record.state) ? record.state : "error";
  const success = record.success !== false && state !== "error";
  return {
    success,
    date: typeof record.date === "string" && record.date ? record.date : todayDateKeyWIB(),
    displayDate: typeof record.displayDate === "string" && record.displayDate ? record.displayDate : displayDateTodayWIB(),
    hasLog: Boolean(record.hasLog),
    logCount: Number(record.logCount ?? 0),
    state: success ? state : "error",
    sessionStatus: typeof record.sessionStatus === "string" ? record.sessionStatus : "error",
    requiresLogin: Boolean(record.requiresLogin),
    canSubmit: Boolean(record.canSubmit),
    message: typeof record.message === "string" && record.message ? record.message : success ? "" : "Gagal membaca log hari ini",
    activeQueue: record.activeQueue ?? null,
    log: record.log ?? null
  };
}

function buildErrorStatus(message: string): TodayLogStatus {
  const date = todayDateKeyWIB();
  return {
    success: false,
    date,
    displayDate: displayDateTodayWIB(date),
    hasLog: false,
    logCount: 0,
    state: "error",
    sessionStatus: "error",
    requiresLogin: false,
    canSubmit: false,
    message: message || "Gagal membaca log hari ini",
    activeQueue: null,
    log: null
  };
}

function isTodayLogState(value: unknown): value is TodayLogState {
  return ["no_log", "not_submitted", "queued", "running", "submitted", "failed", "future", "needs_review", "error"].includes(String(value ?? ""));
}

function displayDateTodayWIB(date = todayDateKeyWIB()): string {
  const weekday = new Intl.DateTimeFormat("id-ID", { weekday: "long", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
  const label = weekday ? weekday.charAt(0).toUpperCase() + weekday.slice(1) : "Hari ini";
  return `${label}, ${formatDate(date)}`;
}

function getCondition(status: TodayLogStatus | null, busy: boolean, syncing: boolean, loading: boolean): {
  title: string;
  message: string;
  badgeStatus: string;
  badgeLabel: string;
  icon: JSX.Element;
  iconClass: string;
  messageClass: string;
  actions: Array<"input" | "send" | "sync" | "retry" | "data" | "queue" | "error" | "reload">;
} {
  if (!status && loading) {
    return {
      title: "Memuat status",
      message: "Sedang mengecek log hari ini.",
      badgeStatus: "checking",
      badgeLabel: "Mengecek",
      icon: <Loader2 className="h-4 w-4 animate-spin" />,
      iconClass: "bg-blue-50 text-blue-700 ring-blue-100 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/20",
      messageClass: "text-slate-500 dark:text-slate-400",
      actions: []
    };
  }

  if (!status || status.state === "error") {
    return {
      title: "Gagal memuat log hari ini",
      message: status?.message || "Gagal membaca log hari ini.",
      badgeStatus: "error",
      badgeLabel: "Gagal memuat",
      icon: <AlertTriangle size={17} />,
      iconClass: "bg-red-50 text-red-700 ring-red-100 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/20",
      messageClass: "text-red-700 dark:text-red-300",
      actions: ["reload"]
    };
  }

  if (syncing) {
    return {
      title: "Mengecek di SKP",
      message: "Sistem sedang mencocokkan log hari ini dengan data di website SKP.",
      badgeStatus: "running",
      badgeLabel: "Mengecek",
      icon: <Loader2 className="h-4 w-4 animate-spin" />,
      iconClass: "bg-blue-50 text-blue-700 ring-blue-100 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/20",
      messageClass: "text-blue-700 dark:text-blue-300",
      actions: ["data"]
    };
  }

  if (busy || status.state === "running") {
    return {
      title: "Sedang dikirim",
      message: "Sistem sedang mengirim log hari ini ke SKP.",
      badgeStatus: "running",
      badgeLabel: "Sedang dikirim",
      icon: <Loader2 className="h-4 w-4 animate-spin" />,
      iconClass: "bg-blue-50 text-blue-700 ring-blue-100 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/20",
      messageClass: "text-blue-700 dark:text-blue-300",
      actions: ["queue", "data"]
    };
  }

  if (status.requiresLogin) {
    return {
      title: "Perlu login SKP",
      message: "Login SKP diperlukan sebelum log hari ini bisa dikirim.",
      badgeStatus: "not_logged_in",
      badgeLabel: "Perlu login",
      icon: <AlertTriangle size={17} />,
      iconClass: "bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/20",
      messageClass: "text-amber-700 dark:text-amber-300",
      actions: status.state === "failed" ? ["retry", "data", "error"] : ["send", "data"]
    };
  }

  if (status.state === "no_log") {
    return {
      title: "Belum ada log hari ini",
      message: "Belum ada data log untuk tanggal hari ini.",
      badgeStatus: "no_log",
      badgeLabel: "Belum ada",
      icon: <ClipboardList size={17} />,
      iconClass: "bg-slate-50 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
      messageClass: "text-slate-500 dark:text-slate-400",
      actions: ["input"]
    };
  }

  if (status.state === "queued") {
    return {
      title: "Masuk antrean",
      message: "Log hari ini sedang menunggu proses kirim.",
      badgeStatus: "queued",
      badgeLabel: "Masuk antrean",
      icon: <RefreshCw size={17} />,
      iconClass: "bg-blue-50 text-blue-700 ring-blue-100 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/20",
      messageClass: "text-blue-700 dark:text-blue-300",
      actions: ["queue"]
    };
  }

  if (status.state === "submitted") {
    return {
      title: "Terkirim",
      message: "Log hari ini sudah masuk SKP.",
      badgeStatus: "submitted",
      badgeLabel: "Terkirim",
      icon: <CheckCircle2 size={17} />,
      iconClass: "bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/20",
      messageClass: "text-emerald-700 dark:text-emerald-300",
      actions: ["data"]
    };
  }

  if (status.state === "failed") {
    const message = friendlyErrorMessage(status.log?.lastError).message;
    return {
      title: "Gagal dikirim",
      message,
      badgeStatus: "failed",
      badgeLabel: "Gagal",
      icon: <AlertTriangle size={17} />,
      iconClass: "bg-red-50 text-red-700 ring-red-100 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/20",
      messageClass: "text-red-700 dark:text-red-300",
      actions: ["sync", "retry", "data", "error"]
    };
  }

  if (status.state === "needs_review") {
    return {
      title: "Perlu dicek",
      message: status.message || "Log hari ini perlu dicek sebelum dikirim.",
      badgeStatus: "needs_review",
      badgeLabel: "Perlu dicek",
      icon: <AlertTriangle size={17} />,
      iconClass: "bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/20",
      messageClass: "text-amber-700 dark:text-amber-300",
      actions: status.log?.lastError ? ["data", "error"] : ["data"]
    };
  }

  if (status.state === "future") {
    return {
      title: "Menunggu tanggal",
      message: "Log hari ini belum masuk waktu pengiriman.",
      badgeStatus: "future",
      badgeLabel: "Menunggu",
      icon: <CalendarClock size={17} />,
      iconClass: "bg-slate-50 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
      messageClass: "text-slate-500 dark:text-slate-400",
      actions: ["data"]
    };
  }

  return {
    title: "Belum dikirim",
    message: "Log hari ini sudah tersedia dan belum masuk SKP.",
    badgeStatus: "not_submitted",
    badgeLabel: "Belum dikirim",
    icon: <Send size={17} />,
    iconClass: "bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/20",
    messageClass: "text-amber-700 dark:text-amber-300",
    actions: ["send", "data"]
  };
}
