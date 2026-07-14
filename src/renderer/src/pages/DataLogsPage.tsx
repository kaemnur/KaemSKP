import { useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, ClipboardList, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DatePickerField } from "@/components/ui/date-picker";
import { Input, Label, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyState, Notice } from "@/components/ui/state";
import { DataTable, TableCard } from "@/components/ui/table";
import { api } from "@/lib/api";
import { cn, formatDate, formatDateID, formatDateTimeWIB, parseDateID, statusLabel, toDateInputValue } from "@/lib/utils";

type Log = Record<string, string>;
type Skp = { kode_skp: string; nama_skp: string };
type LogsSummary = { total: number; submitted: number; notSubmitted: number; failed: number; needsReview: number };
type LogsResponse = {
  data: Log[];
  summary: LogsSummary;
  pagination: { page: number; pageSize: number; total: number; totalPages: number; hasNext: boolean; hasPrev: boolean };
};
type DeleteResponse = { success: true; deletedCount: number; remainingCount: number };
type ReconcileResponse = { success: boolean; foundOnSkp: boolean; message: string; log?: Log | null };

function initialFilters(params: URLSearchParams): Record<string, string> {
  const filters: Record<string, string> = { year: "2026", sort: "tanggal_asc", page: "1", pageSize: "20" };
  const date = toDateInputValue(params.get("date") ?? params.get("tanggal") ?? "");
  if (date) {
    filters.dateFrom = date;
    filters.dateTo = date;
  }
  return filters;
}

export function DataLogsPage({ embedded = false }: { embedded?: boolean } = {}): JSX.Element {
  const [params] = useSearchParams();
  const [logs, setLogs] = useState<Log[]>([]);
  const [skp, setSkp] = useState<Skp[]>([]);
  const [summary, setSummary] = useState<LogsSummary>({ total: 0, submitted: 0, notSubmitted: 0, failed: 0, needsReview: 0 });
  const [pagination, setPagination] = useState<LogsResponse["pagination"]>({ page: 1, pageSize: 20, total: 0, totalPages: 1, hasNext: false, hasPrev: false });
  const [filters, setFilters] = useState<Record<string, string>>(() => initialFilters(params));
  const [detail, setDetail] = useState<Log | null>(null);
  const [history, setHistory] = useState<Array<Record<string, string>>>([]);
  const [edit, setEdit] = useState<Log | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [validatingIds, setValidatingIds] = useState<Set<string>>(new Set());
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  async function load(nextFilters = filters): Promise<void> {
    const response = await api.listLogs(toApiFilters(nextFilters)) as LogsResponse;
    setLogs(response.data);
    setSummary(response.summary ?? { total: response.pagination.total, submitted: 0, notSubmitted: 0, failed: 0, needsReview: 0 });
    setPagination(response.pagination);
  }

  useEffect(() => {
    void load();
    api.listSkp().then(setSkp);
  }, []);

  function setFilter(key: string, value: string): void {
    setFilters({ ...filters, [key]: value, page: "1" });
  }

  async function go(page: number): Promise<void> {
    const next = { ...filters, page: String(page) };
    setFilters(next);
    await load(next);
  }

  async function showDetail(log: Log): Promise<void> {
    setDetail(log);
    setHistory(await api.logSyncHistory(log.id));
  }

  async function saveEdit(): Promise<void> {
    if (!edit) return;
    await api.saveLog(edit);
    setEdit(null);
    setNotice("Data log berhasil disimpan.");
    await load();
  }

  async function action(kind: "run" | "revalidate" | "reconcile" | "manual" | "skip" | "delete", log: Log): Promise<void> {
    if (kind === "run") {
      await runOne(log);
      return;
    }
    if (kind === "revalidate") {
      await revalidateOne(log);
      return;
    }
    if (kind === "reconcile") {
      await reconcileOne(log);
      return;
    }
    if (kind === "manual") await api.markLogSubmitted(log.id);
    if (kind === "skip") await api.skipLog(log.id);
    if (kind === "delete") {
      if (!window.confirm("Data ini hanya akan dihapus dari database lokal KaemSKP, bukan dari website SKP. Lanjutkan?")) return;
      const result = await api.deleteLog(log.id) as DeleteResponse;
      setSelectedIds((current) => withoutIds(current, [log.id]));
      if (detail?.id === log.id) {
        setDetail(null);
        setHistory([]);
      }
      setNotice(`${log.kode_log} dihapus dari data lokal.`);
      await reloadAfterDelete(result.remainingCount);
      return;
    }
    await load();
  }

  async function runOne(log: Log): Promise<void> {
    setRunningIds((current) => withIds(current, [log.id]));
    try {
      const result = await api.runLog(log.id) as { log?: Log | null };
      if (result.log) {
        updateLog(result.log);
        setNotice(buildRunNotice(result.log));
        if (detail?.id === result.log.id) {
          setDetail(result.log);
          setHistory(await api.logSyncHistory(result.log.id));
        }
        await load();
      } else {
        await refreshLog(log.id);
        await load();
      }
    } finally {
      setRunningIds((current) => withoutIds(current, [log.id]));
    }
  }

  async function revalidateOne(log: Log): Promise<void> {
    setValidatingIds((current) => withIds(current, [log.id]));
    try {
      const result = await api.revalidateLog(log.id) as { ok: boolean; log?: Log | null; reason_note?: string | null; available_skp_options?: string[] };
      if (result.log) {
        updateLog(result.log);
        if (detail?.id === result.log.id) setDetail(result.log);
        setNotice(result.ok ? `${result.log.kode_log} valid. Status lokal diperbarui menjadi Valid.` : `Validasi ${log.kode_log}: ${result.reason_note ?? "Perlu Dicek."}`);
      }
      await load();
    } finally {
      setValidatingIds((current) => withoutIds(current, [log.id]));
    }
  }

  async function reconcileOne(log: Log): Promise<void> {
    setSyncingIds((current) => withIds(current, [log.id]));
    try {
      const result = await api.reconcileLog(log.id) as ReconcileResponse;
      if (result.log) {
        updateLog(result.log);
        if (detail?.id === result.log.id) {
          setDetail(result.log);
          setHistory(await api.logSyncHistory(result.log.id));
        }
      }
      setNotice(result.message || (result.foundOnSkp ? "Data ditemukan di SKP." : "Data belum ditemukan di SKP."));
      await load();
    } finally {
      setSyncingIds((current) => withoutIds(current, [log.id]));
    }
  }

  async function refreshLog(id: string): Promise<void> {
    try {
      const next = await api.getLog(id) as Log;
      updateLog(next);
    } catch {
      setLogs((current) => current.filter((item) => item.id !== id));
      setSelectedIds((current) => withoutIds(current, [id]));
    }
  }

  function updateLog(next: Log): void {
    setLogs((current) => current.map((item) => (item.id === next.id ? next : item)));
  }

  function toggleSelected(id: string, checked: boolean): void {
    setSelectedIds((current) => (checked ? withIds(current, [id]) : withoutIds(current, [id])));
  }

  function togglePageSelected(checked: boolean): void {
    const pageIds = logs.map((log) => log.id);
    setSelectedIds((current) => (checked ? withIds(current, pageIds) : withoutIds(current, pageIds)));
  }

  async function deleteSelected(): Promise<void> {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!window.confirm(`${ids.length} data ini hanya akan dihapus dari database lokal KaemSKP, bukan dari website SKP. Lanjutkan?`)) return;
    setBulkBusy(true);
    try {
      const result = await api.deleteLogsBulk(ids) as DeleteResponse;
      setSelectedIds(new Set());
      if (detail && ids.includes(detail.id)) {
        setDetail(null);
        setHistory([]);
      }
      setNotice(`${result.deletedCount} data log lokal berhasil dihapus.`);
      await reloadAfterDelete(result.remainingCount);
    } finally {
      setBulkBusy(false);
    }
  }

  async function deleteAll(): Promise<void> {
    const confirmText = window.prompt("Semua data log hanya akan dihapus dari database lokal KaemSKP, bukan dari website SKP. Ketik HAPUS untuk lanjut.");
    if (confirmText !== "HAPUS") return;
    setBulkBusy(true);
    try {
      const result = await api.deleteAllLogs(confirmText) as DeleteResponse;
      setSelectedIds(new Set());
      setDetail(null);
      setHistory([]);
      setEdit(null);
      setNotice(`${result.deletedCount} data log lokal berhasil dihapus.`);
      const nextFilters = { ...filters, page: "1" };
      setFilters(nextFilters);
      await load(nextFilters);
    } finally {
      setBulkBusy(false);
    }
  }

  async function reloadAfterDelete(remainingCount: number): Promise<void> {
    const remaining = Math.max(0, remainingCount);
    const totalPages = Math.max(1, Math.ceil(remaining / pagination.pageSize));
    const nextPage = Math.min(Number(filters.page || pagination.page), totalPages);
    const nextFilters = { ...filters, page: String(nextPage) };
    setFilters(nextFilters);
    await load(nextFilters);
  }

  const start = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
  const end = Math.min(pagination.page * pagination.pageSize, pagination.total);
  const pageIds = logs.map((log) => log.id);
  const selectedOnPage = pageIds.filter((id) => selectedIds.has(id)).length;
  const allPageSelected = pageIds.length > 0 && selectedOnPage === pageIds.length;
  const anyRunning = runningIds.size > 0 || validatingIds.size > 0 || syncingIds.size > 0;

  return (
    <div className={cn("space-y-5", embedded ? "" : "p-6")}>
      {!embedded && (
        <div>
          <h1 className="text-2xl font-semibold">Data Log Harian</h1>
          <p className="mt-1 text-sm text-slate-500">Daftar semua data log yang tersimpan di SQLite lokal.</p>
        </div>
      )}
      {notice && (
        <Notice tone={noticeTone(notice)} className="whitespace-pre-wrap">
          {notice}
        </Notice>
      )}

      <Card>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div>
            <div className="text-sm font-semibold">Filter Data</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Tampilkan data lokal sesuai bulan, status, atau kata kunci.</div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setFiltersExpanded((open) => !open)}>
            {filtersExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            {filtersExpanded ? "Ringkas" : "Lanjutan"}
          </Button>
        </div>
        <CardContent className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-8">
          <div><Label>Bulan</Label><Input type="month" value={filters.month ?? ""} onChange={(e) => setFilter("month", e.target.value)} /></div>
          <div><Label>Status SKP</Label><StatusSelect value={filters.status_skp ?? ""} onChange={(value) => setFilter("status_skp", value)} /></div>
          <div className="md:col-span-2 xl:col-span-4"><Label>Keyword</Label><Input value={filters.keyword ?? ""} onChange={(e) => setFilter("keyword", e.target.value)} placeholder="Cari aktivitas, deskripsi, SKP, satuan, link" /></div>
          <div className="flex items-end"><Button variant="secondary" onClick={() => load()}>Filter</Button></div>
          {filtersExpanded && (
            <>
              <div><Label>Tahun</Label><Input value={filters.year ?? ""} onChange={(e) => setFilter("year", e.target.value)} /></div>
              <DatePickerField id="filter-date-from" label="Tanggal Mulai" value={filters.dateFrom ?? ""} onChange={(value) => setFilter("dateFrom", value)} />
              <DatePickerField id="filter-date-to" label="Tanggal Akhir" value={filters.dateTo ?? ""} onChange={(value) => setFilter("dateTo", value)} />
              <div><Label>Status Lokal</Label><StatusSelect value={filters.status_local ?? ""} onChange={(value) => setFilter("status_local", value)} local /></div>
              <div>
                <Label>SKP</Label>
                <Select value={filters.kode_skp ?? ""} onChange={(e) => setFilter("kode_skp", e.target.value)}>
                  <option value="">Semua SKP</option>
                  {skp.map((item) => <option key={item.kode_skp} value={item.kode_skp}>{item.kode_skp}</option>)}
                </Select>
              </div>
              <div><Label>Sorting</Label><Select value={filters.sort ?? "tanggal_asc"} onChange={(e) => setFilter("sort", e.target.value)}><option value="tanggal_asc">Tanggal naik</option><option value="tanggal_desc">Tanggal turun</option><option value="status">Status</option><option value="skp">SKP</option></Select></div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <SummaryPill label="Total data" value={summary.total} />
        <SummaryPill label="Terkirim" value={summary.submitted} status="submitted" />
        <SummaryPill label="Belum terkirim" value={summary.notSubmitted} status="not_submitted" />
        <SummaryPill label="Gagal" value={summary.failed} status="failed" />
        <SummaryPill label="Perlu review" value={summary.needsReview} status="needs_review" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm shadow-slate-950/[0.03] dark:border-slate-800 dark:bg-slate-900">
        <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
          {selectedIds.size > 0 ? `${selectedIds.size} data dipilih` : "Belum ada data yang dipilih"}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={selectedIds.size === 0 ? "secondary" : "danger"}
            disabled={selectedIds.size === 0 || bulkBusy || anyRunning}
            onClick={deleteSelected}
          >
            <Trash2 size={16} /> Hapus Terpilih
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="text-red-700 hover:border-red-200 hover:bg-red-50 hover:text-red-800 dark:text-red-300 dark:hover:border-red-500/30 dark:hover:bg-red-500/10"
            disabled={pagination.total === 0 || bulkBusy || anyRunning}
            onClick={deleteAll}
          >
            <Trash2 size={16} /> Hapus Semua Data Log
          </Button>
        </div>
      </div>

      <TableCard>
          <DataTable className="min-w-[1320px]">
            <thead>
              <tr>
                <th key="select" className="w-12 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label="Pilih semua data di halaman ini"
                    checked={allPageSelected}
                    disabled={logs.length === 0 || bulkBusy || anyRunning}
                    onChange={(event) => togglePageSelected(event.target.checked)}
                  />
                </th>
                {[
                    "Tanggal",
                    "Nama Aktivitas",
                    "Deskripsi",
                    "Sasaran Kinerja Pegawai (SKP)",
                    "Status Lokal",
                    "Status SKP",
                    "Cek SKP",
                    "Aksi"
                ].map((head) => (
                  <th key={head} className="px-4 py-3 font-semibold">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((log, index) => (
                <tr key={log.id} className={cn(runningIds.has(log.id) && "is-processing")}>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label={`Pilih ${log.kode_log}`}
                      checked={selectedIds.has(log.id)}
                      disabled={bulkBusy || runningIds.has(log.id) || syncingIds.has(log.id)}
                      onChange={(event) => toggleSelected(log.id, event.target.checked)}
                    />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {formatDate(log.tanggal)}
                    <div className="mt-1 text-xs text-slate-500">{log.kode_log}</div>
                  </td>
                  <td className="max-w-xs px-4 py-3 font-medium">{log.nama_aktivitas || "-"}</td>
                  <td className="max-w-sm px-4 py-3 text-slate-700 dark:text-slate-300" title={log.deskripsi}>{truncate(log.deskripsi, 110)}</td>
                  <td className="max-w-xs px-4 py-3">
                    {log.nama_skp || "-"}
                    {log.kode_skp && <div className="mt-1 text-xs text-slate-500">{log.kode_skp}</div>}
                  </td>
                  <td className="px-4 py-3"><Badge status={log.status_local} /></td>
                  <td className="px-4 py-3">
                    {runningIds.has(log.id) ? <Badge status="running">Sedang mengirim ke SKP...</Badge> : <Badge status={log.status_skp} />}
                    {log.status_skp === "failed" && (
                      <div className="mt-2 max-w-[220px] text-xs leading-5 text-red-700 dark:text-red-300">
                        {formatLastError(log)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <SyncBadge log={log} syncing={syncingIds.has(log.id)} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex min-w-[350px] flex-wrap items-center gap-1.5">
                      <Button size="sm" variant="secondary" className="h-8 px-2.5" onClick={() => showDetail(log)}>Detail</Button>
                      <Button size="sm" variant="secondary" className="h-8 px-2.5" onClick={() => setEdit(log)}>Edit</Button>
                      <Button size="sm" className="h-8 px-2.5" disabled={anyRunning || bulkBusy} onClick={() => action("run", log)}>
                        {runningIds.has(log.id) && <Loader2 className="h-4 w-4 animate-spin" />}
                        {runningIds.has(log.id) ? "Mengirim..." : "Jalankan"}
                      </Button>
                      <Button size="sm" variant="secondary" className="h-8 px-2.5" disabled={anyRunning || bulkBusy} onClick={() => action("reconcile", log)}>
                        {syncingIds.has(log.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw size={14} />}
                        {syncingIds.has(log.id) ? "Mengecek..." : "Sinkronkan Status"}
                      </Button>
                      <Button size="sm" variant="danger" className="h-8 px-2.5" disabled={anyRunning || bulkBusy} onClick={() => action("delete", log)}>
                        <Trash2 size={14} /> Hapus Lokal
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td className="px-4 py-8" colSpan={9}>
                    <EmptyState
                      title="Belum ada data log"
                      description="Silakan input manual atau import Excel untuk mulai mengisi Log Harian SKP."
                      icon={<ClipboardList size={18} />}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </DataTable>
      </TableCard>

      <div className="flex items-center justify-between text-sm text-slate-600">
        <span>Menampilkan {start}-{end} dari total {pagination.total} data</span>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={!pagination.hasPrev} onClick={() => go(pagination.page - 1)}>Previous</Button>
          <Button variant="secondary" disabled={!pagination.hasNext} onClick={() => go(pagination.page + 1)}>Next</Button>
        </div>
      </div>

      {detail && (
        <DetailModal
          log={detail}
          history={history}
          actionDisabled={anyRunning || bulkBusy}
          onAction={(kind) => action(kind, detail)}
          onClose={() => setDetail(null)}
        />
      )}
      {edit && <EditModal log={edit} skp={skp} setLog={setEdit} onSave={saveEdit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function StatusSelect({ value, onChange, local = false }: { value: string; onChange: (value: string) => void; local?: boolean }): JSX.Element {
  const options = local ? ["valid", "needs_review", "invalid", "skipped", "holiday", "leave", "no_plan"] : ["not_submitted", "waiting_date", "ready", "submitted", "failed", "manual_marked_submitted"];
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Semua</option>
      {options.map((option) => <option key={option} value={option}>{statusLabel(option)}</option>)}
    </Select>
  );
}

function SummaryPill({ label, value, status }: { label: string; value: number; status?: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm shadow-slate-950/[0.03] dark:border-slate-800 dark:bg-slate-900">
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="text-xl font-semibold text-slate-950 dark:text-slate-100">{value}</div>
        {status && <Badge status={status}>{statusLabel(status)}</Badge>}
      </div>
    </div>
  );
}

function SyncBadge({ log, syncing }: { log: Log; syncing: boolean }): JSX.Element {
  if (syncing) {
    return <Badge status="running"><Loader2 className="h-3 w-3 animate-spin" />Mengecek</Badge>;
  }
  if (["submitted", "manual_marked_submitted"].includes(log.status_skp)) {
    return <Badge status="submitted">Ada di SKP</Badge>;
  }
  if (!log.last_sync_at) {
    return <Badge status="queued">Belum dicek</Badge>;
  }
  if (["failed", "not_allowed_by_site"].includes(log.status_skp)) {
    return <Badge status="warning">Perlu sinkron</Badge>;
  }
  return <Badge status="queued">Belum dicek</Badge>;
}

function noticeTone(value: string): "success" | "warning" | "danger" | "info" {
  if (/gagal|error|tidak sesuai/i.test(value)) return "danger";
  if (/belum ditemukan|belum diubah|perlu/i.test(value)) return "warning";
  return "success";
}

function toApiFilters(filters: Record<string, string>): Record<string, string> {
  const next = { ...filters };
  if (next.dateFrom) next.dateFrom = parseDateID(next.dateFrom) || next.dateFrom;
  if (next.dateTo) next.dateTo = parseDateID(next.dateTo) || next.dateTo;
  return next;
}

function buildRunNotice(log: Log): string {
  if (log.status_skp === "failed") {
    return `Gagal menjalankan ${log.kode_log}: ${formatLastError(log)}`;
  }
  return `${log.kode_log} selesai dijalankan. Status SKP: ${statusLabel(log.status_skp)}.`;
}

function truncate(value?: string | null, max = 100): string {
  if (!value) return "-";
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}...` : value;
}

function withIds(current: Set<string>, ids: string[]): Set<string> {
  const next = new Set(current);
  for (const id of ids) next.add(id);
  return next;
}

function withoutIds(current: Set<string>, ids: string[]): Set<string> {
  const next = new Set(current);
  for (const id of ids) next.delete(id);
  return next;
}

function DetailModal({
  log,
  history,
  actionDisabled,
  onAction,
  onClose
}: {
  log: Log;
  history: Array<Record<string, string>>;
  actionDisabled: boolean;
  onAction: (kind: "reconcile" | "manual" | "skip" | "delete") => void;
  onClose: () => void;
}): JSX.Element {
  const error = parseLastError(log);
  const rows = [
    ["Tanggal", formatDate(log.tanggal)],
    ["Kode Log", log.kode_log],
    ["Nama Aktivitas", log.nama_aktivitas],
    ["Deskripsi", log.deskripsi],
    ["SKP", `${log.nama_skp ?? "-"}${log.kode_skp ? ` (${log.kode_skp})` : ""}`],
    ["Indikator", log.indikator_kinerja_individu],
    ["Kuantitas Output", log.kuantitas_output],
    ["Satuan", log.satuan],
    ["Link/Tautan", log.link_tautan],
    ["Status Lokal", statusLabel(log.status_local)],
    ["Status SKP", statusLabel(log.status_skp)],
    ["Terakhir Sinkron", formatDateTimeWIB(log.last_sync_at)],
    ["Kode Error", log.last_error_code],
    ["Pesan Error", error.message],
    ["Tahap Automasi", log.automation_step || error.automation_step],
    ["Halaman Saat Error", log.current_url || error.current_url],
    ["Validasi Website", error.validation_text],
    ["Opsi SKP Website", error.available_skp_options],
    ["Screenshot Error", log.screenshot_path || error.screenshot_path]
  ];
  return (
    <Modal title="Detail Log Harian" description="Informasi lokal, status SKP, dan riwayat sinkronisasi data ini." onClose={onClose}>
      <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className={["Nama Aktivitas", "Deskripsi", "Indikator", "Pesan Error", "Halaman Saat Error", "Validasi Website", "Opsi SKP Website", "Screenshot Error"].includes(label) ? "md:col-span-2" : ""}>
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
            <div className="mt-1 whitespace-pre-wrap rounded-md bg-slate-50 px-3 py-2 dark:bg-slate-950">{value || "-"}</div>
          </div>
        ))}
      </div>
      <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/70">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">Aksi tambahan</div>
            <div className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
              Gunakan hanya jika data ini perlu ditandai manual, dilewati, atau dihapus dari data lokal.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={actionDisabled} onClick={() => onAction("reconcile")}>
              <RefreshCw size={14} /> Sinkronkan Status
            </Button>
            <Button size="sm" variant="secondary" disabled={actionDisabled} onClick={() => onAction("manual")}>
              <CheckCircle2 size={14} /> Tandai Terkirim
            </Button>
            <Button size="sm" variant="secondary" disabled={actionDisabled} onClick={() => onAction("skip")}>
              Lewati
            </Button>
            <Button size="sm" variant="danger" disabled={actionDisabled} onClick={() => onAction("delete")}>
              <Trash2 size={14} /> Hapus Lokal
            </Button>
          </div>
        </div>
      </div>
      <div className="mt-5">
        <div className="mb-2 text-sm font-semibold">Riwayat sinkronisasi</div>
        <div className="space-y-2">
          {history.map((item) => (
            <div key={item.id} className="rounded-md border border-slate-100 p-3 text-sm">
              <div className="flex items-center justify-between"><span>{item.aksi}</span><Badge status={item.hasil}>{statusLabel(item.hasil)}</Badge></div>
              <div className="mt-1 text-xs text-slate-500">{formatDateTimeWIB(item.waktu)} - {item.error_code ? `[${item.error_code}] ` : ""}{item.pesan ?? "-"}</div>
            </div>
          ))}
          {history.length === 0 && <div className="text-sm text-slate-500">Belum ada riwayat sinkronisasi untuk item ini.</div>}
        </div>
      </div>
    </Modal>
  );
}

function formatLastError(log: Log): string {
  const parsed = parseLastError(log);
  if (!log.last_error && !log.last_error_code) return "-";
  const prefix = log.last_error_code ? `[${log.last_error_code}] ` : "";
  if (!log.last_error) return prefix.trim();
  return [`${prefix}${parsed.message}`, parsed.automation_step ? `Step: ${parsed.automation_step}` : ""].filter(Boolean).join("\n");
}

function parseLastError(log: Log): {
  message: string;
  current_url: string;
  automation_step: string;
  validation_text: string;
  available_skp_options: string;
  screenshot_path: string;
} {
  if (!log.last_error) {
    return {
      message: "",
      current_url: "",
      automation_step: "",
      validation_text: "",
      available_skp_options: "",
      screenshot_path: ""
    };
  }
  try {
    const parsed = JSON.parse(log.last_error) as Record<string, string | string[] | null>;
    const options = Array.isArray(parsed.available_skp_options) ? parsed.available_skp_options.join("\n") : String(parsed.available_skp_options ?? "");
    return {
      message: String(parsed.error_message ?? log.last_error),
      current_url: String(parsed.current_url ?? ""),
      automation_step: String(parsed.automation_step ?? parsed.step ?? ""),
      validation_text: String(parsed.validation_text ?? ""),
      available_skp_options: options,
      screenshot_path: String(parsed.screenshot_path ?? "")
    };
  } catch {
    return {
      message: log.last_error,
      current_url: "",
      automation_step: "",
      validation_text: "",
      available_skp_options: "",
      screenshot_path: ""
    };
  }
}

function EditModal({ log, skp, setLog, onSave, onClose }: { log: Log; skp: Skp[]; setLog: (log: Log) => void; onSave: () => void; onClose: () => void }): JSX.Element {
  const [tanggalInput, setTanggalInput] = useState(formatDateID(log.tanggal));

  function set(key: string, value: string): void {
    setLog({ ...log, [key]: value });
  }

  function setTanggal(value: string): void {
    setTanggalInput(value);
    const parsed = parseDateID(value) || value;
    if (parsed) set("tanggal", parsed);
  }

  return (
    <Modal title="Edit Log Harian" description="Perubahan disimpan ke data lokal. Jalankan ulang jika perlu mengirim update ke SKP." onClose={onClose}>
      {["submitted", "manual_marked_submitted"].includes(log.status_skp) && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Data ini sudah terkirim ke SKP. Perubahan hanya tersimpan lokal kecuali dijalankan ulang dengan mode update.
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <DatePickerField id="edit-log-date" label="Tanggal" value={tanggalInput} onChange={setTanggal} />
        <div className="md:col-span-3"><Label>Nama Aktivitas</Label><Input value={log.nama_aktivitas ?? ""} onChange={(e) => set("nama_aktivitas", e.target.value)} /></div>
        <div className="md:col-span-2"><Label>SKP</Label><Select value={log.kode_skp ?? ""} onChange={(e) => set("kode_skp", e.target.value)}><option value="">Pilih SKP</option>{skp.map((item) => <option key={item.kode_skp} value={item.kode_skp}>{item.kode_skp} - {item.nama_skp}</option>)}</Select></div>
        <div className="md:col-span-2"><Label>Indikator Kinerja Individu</Label><Input value={log.indikator_kinerja_individu ?? ""} onChange={(e) => set("indikator_kinerja_individu", e.target.value)} /></div>
        <div className="md:col-span-4"><Label>Deskripsi</Label><Textarea value={log.deskripsi ?? ""} onChange={(e) => set("deskripsi", e.target.value)} /></div>
        <div><Label>Kuantitas Output</Label><Input value={log.kuantitas_output ?? ""} onChange={(e) => set("kuantitas_output", e.target.value)} /></div>
        <div><Label>Satuan</Label><Input value={log.satuan ?? ""} onChange={(e) => set("satuan", e.target.value)} /></div>
        <div className="md:col-span-2"><Label>Link/Tautan</Label><Input value={log.link_tautan ?? ""} onChange={(e) => set("link_tautan", e.target.value)} /></div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Batal</Button>
        <Button onClick={onSave}>Simpan Update</Button>
      </div>
    </Modal>
  );
}
