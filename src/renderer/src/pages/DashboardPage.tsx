import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  History,
  Send,
  TriangleAlert
} from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { TodayLogCard } from "@/components/dashboard/TodayLogCard";
import { MonthlySuccessChart } from "@/components/dashboard/MonthlySuccessChart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/state";
import { api } from "@/lib/api";
import { cn, formatDate, formatDateTimeWIB, statusLabel } from "@/lib/utils";

type Dashboard = {
  activeYear: number;
  periodLabel: string;
  counts: Record<string, number>;
  today: { date: string; dayName: string; status: string; log?: Record<string, string>; reason?: string };
  autoPost: {
    nextAutoPostAt: string | null;
    targetDate: string | null;
    dayName: string | null;
    timeLabel: string;
    timezone: string;
    enabled: boolean;
    workerStatus: string;
    sessionStatus: string;
    lastJobStatus: string;
    lastJobAt: string;
  };
  problems: Array<{ tanggal: string; status: string; alasan: string; aksi: string }>;
  recentHistory: Array<{ id: string; title: string; message: string; severity: string; created_at: string }>;
};

type SummaryTone = "blue" | "amber" | "emerald" | "rose";

const summaryCards: Array<{
  key: string;
  title: string;
  helper: string;
  icon: typeof ClipboardList;
  tone: SummaryTone;
}> = [
  { key: "today", title: "Log Hari Ini", helper: "Tanggal berjalan", icon: ClipboardList, tone: "blue" },
  { key: "missed", title: "Belum Terkirim", helper: "Tanggal lewat", icon: Send, tone: "amber" },
  { key: "submittedThisMonth", title: "Berhasil Bulan Ini", helper: "Sudah masuk SKP", icon: CheckCircle2, tone: "emerald" },
  { key: "attention", title: "Butuh Review", helper: "Validasi / error", icon: TriangleAlert, tone: "rose" }
];

export function DashboardPage(): JSX.Element {
  const [data, setData] = useState<Dashboard | null>(null);

  async function load(): Promise<void> {
    setData(await api.getStatus());
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const totalLocal = data ? data.counts.syncTotal ?? 0 : 0;
  const syncPercent = useMemo(() => {
    if (!data || totalLocal === 0) return 0;
    return Math.min(100, Math.round(((data.counts.syncSubmitted ?? 0) / totalLocal) * 100));
  }, [data, totalLocal]);

  if (!data) {
    return (
      <div className="page-shell">
        <LoadingState label="Memuat beranda..." />
      </div>
    );
  }

  const activeYear = data.activeYear || 2026;

  return (
    <div className="page-shell dashboard-shell">
      <section className="dashboard-summary-grid" aria-label="Ringkasan SKP">
        {summaryCards.map((card) => (
          <DashboardStatCard key={card.key} card={card} value={data.counts[card.key] ?? 0} />
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,0.85fr)_minmax(300px,0.85fr)] xl:items-stretch">
        <MonthlySuccessChart year={activeYear} />
        <SyncProgressCard counts={data.counts} totalLocal={totalLocal} syncPercent={syncPercent} />
        <AutoPostCard autoPost={data.autoPost} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        <RecentActivityCard items={data.recentHistory.slice(0, 3)} total={data.recentHistory.length} />
        <TodayLogCard onChanged={load} />
      </section>
    </div>
  );
}

function AutoPostCard({ autoPost }: { autoPost: Dashboard["autoPost"] }): JSX.Element {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const remaining = formatCountdown(autoPost.nextAutoPostAt, now);

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="dashboard-card-header">
        <div>
          <CardTitle>Auto Post Berikutnya</CardTitle>
          <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">Jadwal dihitung oleh backend.</p>
        </div>
        <Badge status={autoPost.enabled ? "ready" : "skipped"}>{autoPost.enabled ? "Aktif" : "Nonaktif"}</Badge>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3 dark:border-slate-800 dark:bg-slate-950/70">
          <div className="text-xs font-semibold uppercase tracking-normal text-slate-500 dark:text-slate-400">Target</div>
          <div className="mt-1 text-lg font-semibold text-slate-950 dark:text-slate-100">
            {autoPost.targetDate ? formatDate(autoPost.targetDate) : "-"}
          </div>
          <div className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            {autoPost.dayName ? `${capitalize(autoPost.dayName)} - ${autoPost.timeLabel}` : autoPost.timeLabel}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2">
          <CountdownBox label="Hari" value={remaining.days} />
          <CountdownBox label="Jam" value={remaining.hours} />
          <CountdownBox label="Menit" value={remaining.minutes} />
          <CountdownBox label="Detik" value={remaining.seconds} />
        </div>

        <div className="mt-auto grid gap-2 text-sm">
          <StatusLine label="Worker" value={statusLabel(autoPost.workerStatus)} status={autoPost.workerStatus} />
          <StatusLine label="Session SKP" value={statusLabel(autoPost.sessionStatus)} status={autoPost.sessionStatus} />
          <StatusLine label="Job terakhir" value={autoPost.lastJobStatus || "Belum ada job"} status={autoPost.lastJobStatus} />
        </div>
      </CardContent>
    </Card>
  );
}

function CountdownBox({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-100 bg-white px-2 py-2 text-center dark:border-slate-800 dark:bg-slate-900">
      <div className="text-lg font-semibold tabular-nums text-slate-950 dark:text-slate-100">{value}</div>
      <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{label}</div>
    </div>
  );
}

function StatusLine({ label, value, status }: { label: string; value: string; status?: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-slate-100 px-3 py-2 dark:border-slate-800">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <Badge status={status ?? "ready"} className="max-w-[11rem] justify-center truncate">
        {value}
      </Badge>
    </div>
  );
}

function formatCountdown(target: string | null, now: number): { days: string; hours: string; minutes: string; seconds: string } {
  if (!target) return { days: "00", hours: "00", minutes: "00", seconds: "00" };
  const diff = Math.max(0, new Date(target).getTime() - now);
  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return {
    days: String(days).padStart(2, "0"),
    hours: String(hours).padStart(2, "0"),
    minutes: String(minutes).padStart(2, "0"),
    seconds: String(seconds).padStart(2, "0")
  };
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function DashboardStatCard({
  card,
  value
}: {
  card: (typeof summaryCards)[number];
  value: number;
}): JSX.Element {
  const Icon = card.icon;

  return (
    <div className={cn("dashboard-stat-card", statBorderClass(card.tone))}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-200">{card.title}</div>
          <div className="mt-0.5 truncate text-xs leading-5 text-slate-500 dark:text-slate-400">{card.helper}</div>
        </div>
        <div className={cn("dashboard-stat-icon", statIconClass(card.tone))}>
          <Icon size={17} />
        </div>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="text-2xl font-semibold tabular-nums text-slate-950 dark:text-slate-100">{value}</div>
        <div className={cn("h-1.5 w-14 rounded-full", statBarClass(card.tone))} />
      </div>
    </div>
  );
}

function SyncProgressCard({
  counts,
  totalLocal,
  syncPercent
}: {
  counts: Record<string, number>;
  totalLocal: number;
  syncPercent: number;
}): JSX.Element {
  const submitted = counts.syncSubmitted ?? 0;
  const waiting = counts.syncWaiting ?? 0;
  const failed = counts.syncFailed ?? 0;
  const sentPercent = totalLocal > 0 ? (submitted / totalLocal) * 100 : 0;
  const waitingPercent = totalLocal > 0 ? (waiting / totalLocal) * 100 : 0;
  const failedPercent = totalLocal > 0 ? (failed / totalLocal) * 100 : 0;
  const statusText =
    totalLocal === 0
      ? "Belum ada data log."
      : failed > 0
        ? `${failed} log gagal atau perlu review.`
        : waiting > 0
          ? `${waiting} log masih menunggu dikirim.`
          : `${submitted} dari ${totalLocal} log sudah masuk SKP.`;
  const donutStyle = {
    "--sync-sent": "#2563eb",
    "--sync-waiting": "#f59e0b",
    "--sync-failed": "#ef4444",
    "--sync-empty": "hsl(var(--muted))",
    background:
      totalLocal === 0
        ? "conic-gradient(var(--sync-empty) 0 100%)"
        : `conic-gradient(var(--sync-sent) 0 ${sentPercent}%, var(--sync-waiting) ${sentPercent}% ${sentPercent + waitingPercent}%, var(--sync-failed) ${
            sentPercent + waitingPercent
          }% ${sentPercent + waitingPercent + failedPercent}%, var(--sync-empty) ${sentPercent + waitingPercent + failedPercent}% 100%)`
  } as CSSProperties;

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="dashboard-card-header">
        <div>
          <CardTitle>Progres Sinkronisasi</CardTitle>
          <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">Terkirim dibanding seluruh log lokal.</p>
        </div>
        <Badge status={failed > 0 ? "failed" : waiting > 0 ? "ready" : "submitted"}>
          {totalLocal === 0 ? "Kosong" : failed > 0 ? "Perlu cek" : waiting > 0 ? "Berjalan" : "Selesai"}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-between gap-3 p-4">
        <div className="flex flex-col items-center">
          <div className="sync-donut" style={donutStyle} role="img" aria-label={`Progres sinkronisasi ${syncPercent}%`}>
            <div className="sync-donut-hole">
              <div className="text-2xl font-semibold tabular-nums text-slate-950 dark:text-slate-100">{syncPercent}%</div>
              <div className="text-[11px] font-semibold uppercase tracking-normal text-slate-500 dark:text-slate-400">Tersinkron</div>
            </div>
          </div>
          <div className="mt-3 max-w-[16rem] text-center text-sm leading-6 text-slate-500 dark:text-slate-400">{statusText}</div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <SyncLegendRow label="Total log" value={totalLocal} dotClassName="bg-slate-300 dark:bg-slate-600" />
          <SyncLegendRow label="Terkirim" value={submitted} dotClassName="bg-blue-600 dark:bg-blue-400" />
          <SyncLegendRow label="Menunggu / Antrean" value={waiting} dotClassName="bg-amber-500 dark:bg-amber-400" />
          <SyncLegendRow label="Gagal" value={failed} dotClassName="bg-red-500 dark:bg-red-400" />
        </div>

        {totalLocal === 0 && (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-center text-xs leading-5 text-slate-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-400">
            Belum ada data log.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SyncLegendRow({ label, value, dotClassName }: { label: string; value: number; dotClassName: string }): JSX.Element {
  return (
    <div className="min-w-0 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950/70">
      <div className="flex min-w-0 items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", dotClassName)} />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 font-semibold tabular-nums text-slate-950 dark:text-slate-100">{value}</div>
    </div>
  );
}

function RecentActivityCard({ items, total }: { items: Dashboard["recentHistory"]; total: number }): JSX.Element {
  return (
    <Card>
      <CardHeader className="dashboard-card-header">
        <div>
          <CardTitle>Aktivitas Terakhir</CardTitle>
          <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">3 catatan terbaru dari sinkronisasi.</p>
        </div>
        <Link to="/kirim-skp?tab=riwayat" className="dashboard-card-link">
          Lihat Riwayat <ArrowRight size={14} />
        </Link>
      </CardHeader>
      <CardContent className="p-4">
        <div className="grid gap-2">
          {items.map((item) => (
            <div key={item.id} className="dashboard-feed-item">
              <div className={cn("dashboard-feed-icon", historyToneClass(item.severity))}>
                <History size={15} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <div className="min-w-0 truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{item.title}</div>
                  <div className="shrink-0 text-xs tabular-nums text-slate-400">{formatDateTimeWIB(item.created_at)}</div>
                </div>
                <div className="mt-1 line-clamp-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{item.message}</div>
              </div>
            </div>
          ))}
          {total === 0 && (
            <CompactEmptyState
              icon={<CalendarClock size={16} />}
              title="Belum ada aktivitas"
              description="Riwayat akan muncul setelah data mulai diproses."
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function CompactEmptyState({ icon, title, description }: { icon: ReactNode; title: string; description: string }): JSX.Element {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 dark:border-slate-700 dark:bg-slate-950/60">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white text-slate-500 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:ring-slate-800">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</div>
        <div className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</div>
      </div>
    </div>
  );
}

function statBorderClass(tone: SummaryTone): string {
  const classes: Record<SummaryTone, string> = {
    blue: "hover:border-blue-200 dark:hover:border-blue-500/30",
    amber: "hover:border-amber-200 dark:hover:border-amber-500/30",
    emerald: "hover:border-emerald-200 dark:hover:border-emerald-500/30",
    rose: "hover:border-rose-200 dark:hover:border-rose-500/30"
  };
  return classes[tone];
}

function statIconClass(tone: SummaryTone): string {
  const classes: Record<SummaryTone, string> = {
    blue: "bg-blue-50 text-blue-700 ring-blue-100 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/20",
    amber: "bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/20",
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/20",
    rose: "bg-rose-50 text-rose-700 ring-rose-100 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/20"
  };
  return classes[tone];
}

function statBarClass(tone: SummaryTone): string {
  const classes: Record<SummaryTone, string> = {
    blue: "bg-blue-500/70 dark:bg-blue-400/80",
    amber: "bg-amber-500/70 dark:bg-amber-400/80",
    emerald: "bg-emerald-500/70 dark:bg-emerald-400/80",
    rose: "bg-rose-500/70 dark:bg-rose-400/80"
  };
  return classes[tone];
}

function historyToneClass(severity: string): string {
  if (severity === "success") return "bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/20";
  if (severity === "warning") return "bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/20";
  if (severity === "danger" || severity === "error") return "bg-rose-50 text-rose-700 ring-rose-100 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/20";
  return "bg-blue-50 text-blue-700 ring-blue-100 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/20";
}
