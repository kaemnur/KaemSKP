import { useEffect, useMemo, useState } from "react";
import { CalendarDays, CheckCircle2, History, Inbox, ListChecks, Loader2, Play, RefreshCw, Square } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TodayLogCard } from "@/components/dashboard/TodayLogCard";
import { DatePickerField } from "@/components/ui/date-picker";
import { Input, Label, Select } from "@/components/ui/field";
import { EmptyState, Notice } from "@/components/ui/state";
import { DataTable, TableCard } from "@/components/ui/table";
import { TabButton, Tabs } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { cn, formatDate, formatDateID, formatDateTimeWIB, friendlyErrorMessage, statusLabel, todayDateKeyWIB, toDateInputValue } from "@/lib/utils";

type TabKey = "run" | "queue" | "calendar" | "history";
type Day = Record<string, string | number>;
type Detail = { day?: Day; logs: Array<Record<string, string>> };
type RunMode = "range" | "not_submitted" | "failed_only";
type JobItem = Record<string, string | number | null>;
type JobProgress = {
  success: true;
  jobId: string;
  total: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  running?: JobItem | null;
  items?: JobItem[];
  job?: Record<string, string | number | null>;
};
export function ControlSkpPage(): JSX.Element {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<TabKey>(normalizeTab(params.get("tab")));

  return (
    <div className="page-shell">
      <Tabs>
        {[
          ["run", "Kirim Data", Play],
          ["queue", "Antrean", ListChecks],
          ["calendar", "Kalender", CalendarDays],
          ["history", "Riwayat", History]
        ].map(([key, label, Icon]) => (
          <TabButton
            key={String(key)}
            active={tab === key}
            onClick={() => setTab(key as TabKey)}
          >
            <Icon size={16} />{String(label)}
          </TabButton>
        ))}
      </Tabs>

      {tab === "run" && <RunTab />}
      {tab === "queue" && <QueueTab />}
      {tab === "calendar" && <CalendarTab />}
      {tab === "history" && <HistoryTab />}
    </div>
  );
}

function normalizeTab(value: string | null): TabKey {
  if (value === "antrean" || value === "queue") return "queue";
  if (value === "kalender" || value === "calendar") return "calendar";
  if (value === "riwayat" || value === "history") return "history";
  return "run";
}

function RunTab(): JSX.Element {
  const today = todayDateKeyWIB();
  const [dateFrom, setDateFrom] = useState(toDateInputValue("2026-04-01"));
  const [dateTo, setDateTo] = useState(toDateInputValue(today));
  const [mode, setMode] = useState<RunMode>("not_submitted");
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    const load = async (): Promise<void> => {
      const next = await api.getRunJob(jobId) as JobProgress;
      if (cancelled) return;
      setProgress(next);
      const status = String(next.job?.status ?? "");
      if (["finished", "finished_with_error", "stopped"].includes(status)) setBusy(false);
    };
    void load();
    const timer = window.setInterval(load, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [jobId]);

  async function runSelected(override?: { dateFrom: string; dateTo: string; mode: RunMode }): Promise<void> {
    setWarning(null);
    setMessage(null);
    const from = toDateInputValue(override?.dateFrom ?? dateFrom);
    const to = toDateInputValue(override?.dateTo ?? dateTo);
    const selectedMode = override?.mode ?? mode;
    if (!from || !to) {
      setWarning("Tanggal wajib dipilih dengan format valid, contoh 01/04/2026.");
      return;
    }
    if (from > to) {
      setWarning("Tanggal Mulai tidak boleh lebih besar dari Tanggal Akhir.");
      return;
    }
    if (to > today) setWarning(`Tanggal masa depan tidak diproses. Periode otomatis dibatasi sampai ${formatDateID(today)}.`);
    const preview = await api.previewRunRange({ dateFrom: from, dateTo: to, mode: selectedMode }) as { total: number; dateFrom: string; dateTo: string };
    const message = `Akan mengirim ${preview.total} data dari ${formatDateID(preview.dateFrom)} sampai ${formatDateID(preview.dateTo)}.`;
    if (preview.total === 0) {
      setWarning(`${message} Tidak ada data yang perlu diproses.`);
      return;
    }
    if (!window.confirm(`${message}\n\nLanjutkan proses batch?`)) return;
    setBusy(true);
    const started = await api.runRange({ dateFrom: from, dateTo: to, mode: selectedMode }) as JobProgress;
    setJobId(started.jobId);
    setProgress(started);
  }

  async function previewSelected(): Promise<void> {
    setWarning(null);
    setMessage(null);
    const from = toDateInputValue(dateFrom);
    const to = toDateInputValue(dateTo);
    if (!from || !to) {
      setWarning("Tanggal wajib dipilih dengan format valid, contoh 01/04/2026.");
      return;
    }
    if (from > to) {
      setWarning("Tanggal Mulai tidak boleh lebih besar dari Tanggal Akhir.");
      return;
    }
    const preview = await api.previewRunRange({ dateFrom: from, dateTo: to, mode }) as { total: number; dateFrom: string; dateTo: string };
    setMessage(`Preview: ${preview.total} data siap diproses dari ${formatDateID(preview.dateFrom)} sampai ${formatDateID(preview.dateTo)}.`);
  }

  return (
    <div className="space-y-5">
      <TodayLogCard />
      <Card>
        <CardHeader>
          <CardTitle>Jalankan Sinkronisasi</CardTitle>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Pilih rentang tanggal dan mode kirim. Sistem akan menampilkan preview jumlah data sebelum batch dimulai.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
            <DatePickerField id="run-date-from" label="Tanggal Mulai" value={dateFrom} onChange={setDateFrom} />
            <DatePickerField id="run-date-to" label="Tanggal Akhir" value={dateTo} onChange={setDateTo} />
            <div className="lg:col-span-2">
              <Label>Mode Kirim</Label>
              <Select value={mode} onChange={(e) => setMode(e.target.value as RunMode)}>
                <option value="range">Kirim data dalam rentang tanggal</option>
                <option value="not_submitted">Kirim hanya yang belum terkirim</option>
                <option value="failed_only">Kirim ulang yang gagal</option>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-2 border-t border-slate-100 pt-4 dark:border-slate-800 sm:flex-row sm:justify-end">
            <Button variant="secondary" disabled={busy} onClick={() => void previewSelected()}>
              <ListChecks size={16} />Preview Jumlah Data
            </Button>
            {busy && <Button variant="secondary" disabled={!jobId} onClick={() => jobId && api.stopRunJob(jobId)}><Square size={16} />Stop Proses</Button>}
            <Button disabled={busy} onClick={() => void runSelected()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play size={16} />}
              Kirim Data Terpilih
            </Button>
          </div>
          {busy && <Notice tone="warning">Jangan tutup aplikasi sampai proses selesai.</Notice>}
          {message && <Notice tone="success"><CheckCircle2 size={16} />{message}</Notice>}
          {warning && <Notice tone="warning">{warning}</Notice>}
        </CardContent>
      </Card>
      {progress && <BatchProgress progress={progress} />}
    </div>
  );
}

function ProgressBox({ label, value, small = false }: { label: string; value: string | number; small?: boolean }): JSX.Element {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase text-slate-500">{label}</div>
        <div className={cn("mt-2 font-semibold", small ? "truncate text-sm" : "text-2xl")}>{value}</div>
      </CardContent>
    </Card>
  );
}

function BatchProgress({ progress }: { progress: JobProgress }): JSX.Element {
  const completed = progress.successCount + progress.failedCount + progress.skippedCount;
  const total = Math.max(progress.total, progress.items?.length ?? 0, 1);
  const percent = Math.round((completed / total) * 100);
  const running = progress.running;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Progress Batch</CardTitle>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Status total, berhasil, gagal, dilewati, dan item yang sedang diproses.</p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">{percent}% selesai</span>
            <span className="text-slate-500 dark:text-slate-400">{completed}/{total} data</span>
          </div>
          <div className="progress-track">
            <div className="progress-value" style={{ width: `${percent}%` }} />
          </div>
        </div>
        <section className="grid grid-cols-1 gap-4 md:grid-cols-5">
          <ProgressBox label="Total" value={progress.total} />
          <ProgressBox label="Sedang Diproses" value={running ? String(running.kode_log ?? running.nama_aktivitas ?? "1") : "-"} small />
          <ProgressBox label="Berhasil" value={progress.successCount} />
          <ProgressBox label="Gagal" value={progress.failedCount} />
          <ProgressBox label="Dilewati" value={progress.skippedCount} />
        </section>
        {running && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300">
            <div className="font-medium">Data yang sedang diproses</div>
            <div className="mt-1">{formatDateID(String(running.tanggal ?? ""))} - {String(running.nama_aktivitas ?? "-")}</div>
            <div className="text-xs opacity-80">{String(running.kode_skp ?? "-")}</div>
          </div>
        )}
        <div className="space-y-2">
          {(progress.items ?? []).slice(0, 12).map((item) => (
            <div key={String(item.id)} className={cn("flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2 text-sm transition dark:border-slate-800", item.status === "running" && "animate-pulse bg-blue-50 ring-1 ring-blue-200 dark:bg-blue-500/10 dark:ring-blue-500/30")}>
              <div className="min-w-0">
                <div className="truncate font-medium">{String(item.nama_aktivitas ?? "-")}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">{formatDateID(String(item.tanggal ?? ""))} - {String(item.kode_skp ?? "-")}</div>
              </div>
              <Badge status={String(item.status)} />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function QueueTab(): JSX.Element {
  const [items, setItems] = useState<Array<Record<string, string | number>>>([]);

  async function load(): Promise<void> {
    setItems(await api.listSyncQueue(200));
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(load, 2000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="space-y-4">
      <div className="section-heading">
        <div>
          <h2 className="section-title">Antrean Sinkronisasi</h2>
          <p className="section-description">Daftar data yang menunggu atau sedang diproses oleh batch SKP.</p>
        </div>
        <Button variant="secondary" onClick={load}><RefreshCw size={16} />Refresh</Button>
      </div>
      <TableCard>
          <DataTable className="min-w-[960px]">
            <thead>
              <tr><th className="px-4 py-3">Tanggal</th><th className="px-4 py-3">Nama Aktivitas</th><th className="px-4 py-3">SKP</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Percobaan</th><th className="px-4 py-3">Error Terakhir</th></tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={String(item.id)}>
                  <td className="px-4 py-3">{formatDateID(String(item.tanggal ?? ""))}</td>
                  <td className="px-4 py-3">{String(item.nama_aktivitas ?? "-")}</td>
                  <td className="px-4 py-3">{String(item.kode_skp ?? "-")}</td>
                  <td className="px-4 py-3"><Badge status={String(item.status)} /></td>
                  <td className="px-4 py-3">{String(item.attempt_count ?? 0)}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatQueueMessage(item.error_message)}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td className="px-4 py-8" colSpan={6}>
                    <EmptyState title="Belum ada antrean proses" description="Antrean akan muncul ketika proses kirim batch sedang berjalan atau menunggu retry." icon={<Inbox size={18} />} />
                  </td>
                </tr>
              )}
            </tbody>
          </DataTable>
      </TableCard>
    </div>
  );
}

function formatQueueMessage(value: unknown): string {
  const text = String(value ?? "").trim();
  return text ? friendlyErrorMessage(text).message : "-";
}

function CalendarTab(): JSX.Element {
  const [month, setMonth] = useState("2026-04");
  const [days, setDays] = useState<Day[]>([]);
  const [selected, setSelected] = useState<Detail | null>(null);

  async function load(): Promise<void> {
    setDays(await api.listCalendar(month));
  }

  useEffect(() => {
    void load();
  }, [month]);

  const blanks = useMemo(() => {
    if (days.length === 0) return 0;
    const first = new Date(`${days[0].date}T00:00:00`).getDay();
    return first === 0 ? 6 : first - 1;
  }, [days]);

  async function select(date: string): Promise<void> {
    setSelected(await api.calendarDetail(date));
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
      <section className="space-y-5">
        <div className="section-heading">
          <div>
            <h2 className="section-title">Kalender Status</h2>
            <p className="section-description">Januari-Maret tidak dihitung sebagai masalah saat data lokal mulai April.</p>
          </div>
          <Input className="max-w-48" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-7 gap-2 text-center text-xs font-semibold uppercase text-slate-500">
              {["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"].map((day) => <div key={day}>{day}</div>)}
            </div>
            <div className="mt-3 grid grid-cols-7 gap-2">
              {Array.from({ length: blanks }).map((_, index) => <div key={`blank-${index}`} className="aspect-square" />)}
              {days.map((day) => (
                <button
                  key={String(day.date)}
                  onClick={() => select(String(day.date))}
                  className={cn(
                    "flex aspect-square flex-col items-start justify-between rounded-md border p-2 text-left transition hover:ring-2 hover:ring-blue-200",
                    day.status === "submitted" && "border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10",
                    day.status === "has_log" && "border-blue-200 bg-blue-50 dark:border-blue-500/30 dark:bg-blue-500/10",
                    ["needs_review", "missing"].includes(String(day.status)) && "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10",
                    day.status === "failed" && "border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10",
                    ["weekend", "public_holiday", "leave", "no_plan"].includes(String(day.status)) && "border-gray-200 bg-gray-100 dark:border-slate-700 dark:bg-slate-800",
                    ["future", "waiting_date"].includes(String(day.status)) && "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950"
                  )}
                >
                  <span className="text-sm font-semibold text-slate-950 dark:text-slate-100">{String(day.date).slice(-2)}</span>
                  <span className="text-[11px] leading-tight text-slate-600 dark:text-slate-300">{statusLabel(String(day.status))}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>
      <aside>
        <Card className="sticky top-24">
          <CardHeader><CardTitle>Detail Tanggal</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {!selected?.day && <div className="text-sm text-slate-500">Klik tanggal untuk melihat detail.</div>}
            {selected?.day && (
              <>
                <div>
                  <div className="text-lg font-semibold">{formatDate(String(selected.day.date))}</div>
                  <div className="text-sm text-slate-500">{selected.day.day_name}</div>
                </div>
                <Badge status={String(selected.day.status)} />
                <div className="text-sm leading-6 text-slate-600 dark:text-slate-300">{selected.day.reason_note || selected.day.holiday_name || "Data log tersedia."}</div>
                <div className="space-y-2">
                  {selected.logs.map((log) => (
                    <div key={log.id} className="rounded-lg border border-slate-100 p-3 text-sm dark:border-slate-800">
                      <div className="font-medium">{log.nama_aktivitas}</div>
                      <div className="text-xs text-slate-500">{log.kode_log} - {log.kode_skp}</div>
                    </div>
                  ))}
                  {selected.logs.length === 0 && <div className="text-sm text-slate-500">Tidak ada log pada tanggal ini.</div>}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function HistoryTab(): JSX.Element {
  const [items, setItems] = useState<Array<Record<string, string>>>([]);

  useEffect(() => {
    api.listSyncHistory(200).then(setItems);
  }, []);

  return (
    <TableCard>
        <DataTable className="min-w-[960px]">
          <thead>
            <tr><th className="px-4 py-3">Waktu</th><th className="px-4 py-3">Aksi</th><th className="px-4 py-3">Tanggal Log</th><th className="px-4 py-3">Hasil</th><th className="px-4 py-3">Pesan</th><th className="px-4 py-3">Screenshot Error</th></tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={`${item.waktu}-${index}`}>
                <td className="px-4 py-3">{formatDateTimeWIB(item.waktu)}</td>
                <td className="px-4 py-3 font-medium">{item.aksi}</td>
                <td className="px-4 py-3">{item.tanggal_log ? formatDate(item.tanggal_log) : "-"}</td>
                <td className="px-4 py-3"><Badge status={item.hasil}>{statusLabel(item.hasil)}</Badge></td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatHistoryMessage(item.pesan)}</td>
                <td className="px-4 py-3">{item.screenshot_error ?? "-"}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td className="px-4 py-8" colSpan={6}>
                  <EmptyState title="Belum ada riwayat sinkronisasi" description="Riwayat akan muncul setelah proses kirim satuan atau batch selesai." icon={<History size={18} />} />
                </td>
              </tr>
            )}
          </tbody>
        </DataTable>
    </TableCard>
  );
}

function formatHistoryMessage(value?: string | null): string {
  if (!value) return "-";
  return friendlyErrorMessage(value).message;
}
