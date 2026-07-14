import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Edit3, ExternalLink, History, Loader2, Play, RefreshCw, RotateCcw, Save, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyState, ErrorState, LoadingState, Notice } from "@/components/ui/state";
import { DataTable, TableCard } from "@/components/ui/table";
import { TabButton, Tabs } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { cn, formatDateID, formatDateTimeWIB, friendlyErrorMessage, statusLabel, todayDateKeyWIB } from "@/lib/utils";

const DEFAULT_FEEDBACK_LINK = "https://drive.google.com/drive/folders/1ln6FSUk550YVlnToaoZ1EUalAVjuIBWB";

type Quarter = 1 | 2 | 3 | 4;
type BusyState = "load" | "refresh" | "generate" | "fill" | "submit" | "settings" | null;
type TabKey = "preview" | "history";
type OperationMode = "preview" | "fill" | "fill_submit";

type PeriodicRow = {
  kode_skp: string;
  nama_skp: string;
  indikator: string[];
  logCount: number;
  realization: string;
  generatedRealization: string;
  feedbackLink: string;
  shouldFill: boolean;
  overwrite: boolean;
  status: "ready" | "no_logs" | "skip" | "needs_check" | "existing";
  statusLabel: string;
  notes: string[];
};

type PeriodicPreview = {
  ok: true;
  year: number;
  quarter: Quarter;
  quarterLabel: string;
  dateFrom: string;
  dateTo: string;
  feedbackLink: string;
  baseUrl?: string;
  targetUrl?: string;
  status: string;
  summary: {
    totalSkp: number;
    readyCount: number;
    noLogCount: number;
    selectedCount: number;
    totalLogs: number;
  };
  rows: PeriodicRow[];
};

type PeriodicHistory = {
  id: string;
  year: number;
  quarter: number;
  total_skp: number;
  success_count: number;
  failed_count: number;
  submit_status: string | null;
  status: string;
  mode: string;
  error_last: string | null;
  screenshot_path: string | null;
  created_at: string | null;
};

type PeriodicRunResult = {
  ok: boolean;
  year: number;
  quarter: Quarter;
  status: string;
  mode: string;
  totalItems: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  submitted: boolean;
  submitStatus: string;
  message: string;
  screenshotPath?: string;
  errorLast?: string;
  submitState?: string;
  availableButtons?: string[];
  currentUrl?: string;
  baseUrl?: string;
  origin?: string;
  targetUrl?: string;
  expectedUrl?: string;
  step?: string;
  expectedPageTitle?: string;
  visiblePageTitle?: string;
  visibleHeading?: string;
  visibleTextSample?: string;
  greenEditButtonCount?: number;
  availableSidebarItems?: string[];
  clickedMenuText?: string;
  currentUrlBeforeClick?: string;
  currentUrlAfterClick?: string;
  items: Array<{
    kode_skp: string;
    nama_skp: string;
    ok: boolean;
    status: string;
    message: string;
    screenshotPath?: string;
    currentUrl?: string;
    step?: string;
    availableInputs?: string[];
    availableButtons?: string[];
    headings?: string[];
    greenEditButtonCount?: number;
    currentSkpRow?: string;
  }>;
};

type EditState = {
  index: number;
  field: "realization" | "feedbackLink";
  value: string;
};

const quarterOptions: Array<{ value: Quarter; label: string; helper: string }> = [
  { value: 1, label: "Triwulan 1", helper: "Januari - Maret" },
  { value: 2, label: "Triwulan 2", helper: "April - Juni" },
  { value: 3, label: "Triwulan 3", helper: "Juli - September" },
  { value: 4, label: "Triwulan 4", helper: "Oktober - Desember" }
];

const DEFAULT_SKP_BASE_URL = "https://skp.sdm.kemendikdasmen.go.id";

const QUARTER_META: Record<Quarter, { label: string; roman: string; monthText: string; path: string }> = {
  1: { label: "Triwulan I", roman: "I", monthText: "Januari–Maret", path: "/skp/pegawai/evalperiodik/tri_satu.jsp" },
  2: { label: "Triwulan II", roman: "II", monthText: "April–Juni", path: "/skp/pegawai/evalperiodik/tri_dua.jsp" },
  3: { label: "Triwulan III", roman: "III", monthText: "Juli–September", path: "/skp/pegawai/evalperiodik/tri_tiga.jsp" },
  4: { label: "Triwulan IV", roman: "IV", monthText: "Oktober–Desember", path: "/skp/pegawai/evalperiodik/tri_empat.jsp" }
};

function quarterTargetUrl(quarter: Quarter, baseUrl = DEFAULT_SKP_BASE_URL): string {
  return `${baseUrl.replace(/\/+$/, "")}${QUARTER_META[quarter].path}`;
}

const modeOptions: Array<{ value: OperationMode; label: string }> = [
  { value: "preview", label: "Preview saja" },
  { value: "fill", label: "Isi ke Website" },
  { value: "fill_submit", label: "Isi + Ajukan" }
];

export function SkpPeriodicPage(): JSX.Element {
  const [tab, setTab] = useState<TabKey>("preview");
  const [year, setYear] = useState(2026);
  const [quarter, setQuarter] = useState<Quarter>(quarterFromToday());
  const [mode, setMode] = useState<OperationMode>("preview");
  const [feedbackLink, setFeedbackLink] = useState(DEFAULT_FEEDBACK_LINK);
  const [periodicBaseUrl, setPeriodicBaseUrl] = useState(DEFAULT_SKP_BASE_URL);
  const [preview, setPreview] = useState<PeriodicPreview | null>(null);
  const [rows, setRows] = useState<PeriodicRow[]>([]);
  const [history, setHistory] = useState<PeriodicHistory[]>([]);
  const [busy, setBusy] = useState<BusyState>("load");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<{ title: string; message: string; code?: string; detail?: string; screenshotPath?: string } | null>(null);
  const [result, setResult] = useState<PeriodicRunResult | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [pendingSend, setPendingSend] = useState<OperationMode | null>(null);

  const selectedRows = useMemo(() => rows.filter((row) => row.shouldFill && row.status !== "no_logs"), [rows]);
  // Preview dianggap sesuai bila periode preview yang tampil sama dengan triwulan/tahun yang dipilih.
  const previewMatchesSelection = Boolean(preview && preview.quarter === quarter && preview.year === year);

  useEffect(() => {
    void loadInitial();
  }, []);

  // Saat triwulan/tahun diubah, muat ulang preview otomatis agar tabel selalu sesuai pilihan
  // (mencegah kasus "pilih Triwulan 2 tapi data yang tampil masih Triwulan 3").
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (!initialized) return;
    let cancelled = false;
    setBusy("refresh");
    setError(null);
    setResult(null);
    loadPreview(year, quarter, feedbackLink)
      .catch((caught) => {
        if (!cancelled) setError(toUiError(caught));
      })
      .finally(() => {
        if (!cancelled) setBusy(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, quarter]);

  async function loadInitial(): Promise<void> {
    setBusy("load");
    setError(null);
    try {
      const defaults = await api.periodicDefaults() as { year?: number; quarter?: Quarter; feedbackLink?: string; baseUrl?: string };
      const nextYear = defaults.year ?? 2026;
      const nextQuarter = defaults.quarter ?? quarterFromToday();
      const nextLink = defaults.feedbackLink ?? DEFAULT_FEEDBACK_LINK;
      const nextBaseUrl = defaults.baseUrl ?? DEFAULT_SKP_BASE_URL;
      setYear(nextYear);
      setQuarter(nextQuarter);
      setFeedbackLink(nextLink);
      setPeriodicBaseUrl(nextBaseUrl);
      await Promise.all([loadPreview(nextYear, nextQuarter, nextLink), loadHistory()]);
    } catch (caught) {
      setError(toUiError(caught));
    } finally {
      setBusy(null);
      setInitialized(true);
    }
  }

  async function loadPreview(targetYear = year, targetQuarter = quarter, targetFeedbackLink = feedbackLink): Promise<void> {
    const data = await api.periodicPreview({ year: targetYear, quarter: targetQuarter, feedbackLink: targetFeedbackLink }) as PeriodicPreview;
    setPreview(data);
    setRows(data.rows);
    if (data.baseUrl) setPeriodicBaseUrl(data.baseUrl);
  }

  async function loadHistory(): Promise<void> {
    setHistory(await api.periodicHistory(100) as PeriodicHistory[]);
  }

  async function refreshStatus(): Promise<void> {
    setBusy("refresh");
    setError(null);
    try {
      await Promise.all([loadPreview(), loadHistory()]);
      setNotice("Status SKP Periodik diperbarui.");
    } catch (caught) {
      setError(toUiError(caught));
    } finally {
      setBusy(null);
    }
  }

  async function generate(): Promise<void> {
    setBusy("generate");
    setNotice(null);
    setError(null);
    setResult(null);
    try {
      const data = await api.generatePeriodic({ year, quarter, feedbackLink }) as PeriodicPreview;
      setPreview(data);
      setRows(data.rows);
      setNotice(`Preview ${data.quarterLabel} ${data.year} siap: ${data.summary.readyCount} SKP punya log, ${data.summary.noLogCount} SKP belum ada log.`);
      await loadHistory();
    } catch (caught) {
      setError(toUiError(caught));
    } finally {
      setBusy(null);
    }
  }

  async function saveFeedbackLink(applyToRows = false): Promise<void> {
    setBusy("settings");
    setError(null);
    try {
      await api.updatePeriodicSettings({ periodic_feedback_link: feedbackLink });
      if (applyToRows) {
        setRows((current) => current.map((row) => ({ ...row, feedbackLink })));
      }
      setNotice(applyToRows ? "Link umpan balik disimpan dan diterapkan ke preview." : "Link umpan balik periodik disimpan.");
    } catch (caught) {
      setError(toUiError(caught));
    } finally {
      setBusy(null);
    }
  }

  async function runSelectedFill(items = selectedRows): Promise<void> {
    if (items.length === 0) {
      setError({ title: "Tidak ada SKP dipilih", message: "Pilih minimal satu SKP yang punya data log sebelum mengisi website." });
      return;
    }
    setBusy("fill");
    setNotice(null);
    setError(null);
    setResult(null);
    try {
      const data = await api.fillPeriodic({ year, quarter, items: toPayloadItems(items), overwrite: items.some((row) => row.overwrite) }) as PeriodicRunResult;
      setResult(data);
      setNotice(data.message);
      await loadHistory();
    } catch (caught) {
      setError(toUiError(caught));
    } finally {
      setBusy(null);
    }
  }

  async function submitAfterConfirm(): Promise<void> {
    setPendingSend(null);
    setBusy("submit");
    setNotice(null);
    setError(null);
    setResult(null);
    try {
      const items = selectedRows.length > 0 ? toPayloadItems(selectedRows) : undefined;
      const data = await api.submitPeriodic({ year, quarter, items, overwrite: selectedRows.some((row) => row.overwrite) }) as PeriodicRunResult;
      setResult(data);
      setNotice(data.message);
      await loadHistory();
    } catch (caught) {
      setError(toUiError(caught));
    } finally {
      setBusy(null);
    }
  }

  async function runMode(): Promise<void> {
    if (mode === "preview") {
      await generate();
      return;
    }
    // Guard sebelum kirim: preview wajib ada dan sesuai triwulan/tahun yang dipilih.
    if (!preview || !previewMatchesSelection) {
      setError({
        title: "Preview belum sesuai periode",
        message: `Buat preview ${QUARTER_META[quarter].label} ${year} dulu (mode "Preview Saja") sebelum mengisi website. Data hanya dikirim untuk periode yang dipilih agar tidak salah triwulan.`
      });
      return;
    }
    if (selectedRows.length === 0) {
      setError({ title: "Tidak ada SKP dipilih", message: "Pilih minimal satu SKP yang punya data log sebelum mengisi website." });
      return;
    }
    setPendingSend(mode);
  }

  async function proceedPendingSend(): Promise<void> {
    if (pendingSend === "fill") {
      setPendingSend(null);
      await runSelectedFill();
      return;
    }
    if (pendingSend === "fill_submit") {
      await submitAfterConfirm();
    }
  }

  function updateRow(index: number, patch: Partial<PeriodicRow>): void {
    setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  function toggleRow(index: number): void {
    setRows((current) =>
      current.map((row, rowIndex) => {
        if (rowIndex !== index || row.status === "no_logs") return row;
        return {
          ...row,
          shouldFill: !row.shouldFill,
          status: row.shouldFill ? "skip" : "ready",
          statusLabel: row.shouldFill ? "Jangan isi" : "Preview siap"
        };
      })
    );
  }

  function resetRow(index: number): void {
    setRows((current) =>
      current.map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        const noLogs = row.logCount === 0;
        return {
          ...row,
          realization: row.generatedRealization,
          feedbackLink,
          shouldFill: !noLogs,
          overwrite: false,
          status: noLogs ? "no_logs" : "ready",
          statusLabel: noLogs ? "Belum ada data log" : "Preview siap"
        };
      })
    );
  }

  function saveEdit(): void {
    if (!edit) return;
    updateRow(edit.index, { [edit.field]: edit.value } as Partial<PeriodicRow>);
    setEdit(null);
  }

  const loading = busy === "load";

  return (
    <div className="page-shell">
      <Tabs>
        <TabButton active={tab === "preview"} onClick={() => setTab("preview")}>
          <Play size={16} />Preview & Proses
        </TabButton>
        <TabButton active={tab === "history"} onClick={() => setTab("history")}>
          <History size={16} />Riwayat
        </TabButton>
      </Tabs>

      {loading && <LoadingState label="Memuat SKP Periodik..." />}
      {!loading && tab === "preview" && (
        <div className="space-y-5">
          <PeriodicStepper mode={mode} hasPreview={rows.length > 0} hasResult={Boolean(result)} />

          <PeriodPreviewBanner
            selectedQuarter={quarter}
            selectedYear={year}
            preview={preview}
            matches={previewMatchesSelection}
            targetUrl={preview?.targetUrl ?? quarterTargetUrl(quarter, periodicBaseUrl)}
          />

          <section className="grid grid-cols-1 gap-5 xl:grid-cols-[1.15fr_0.85fr]">
            <Card>
              <CardHeader className="dashboard-card-header">
                <div>
                  <CardTitle>Pilih Periode</CardTitle>
                  <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">Tahun aktif 2026 dengan triwulan tetap bisa dipilih manual.</p>
                </div>
                <Badge status={preview?.status ?? "not_created"}>{periodicStatusLabel(preview?.status)}</Badge>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <Label>Tahun SKP</Label>
                  <Input type="number" min="2020" max="2100" value={year} onChange={(event) => setYear(Number(event.target.value || 2026))} />
                </div>
                <div>
                  <Label>Triwulan</Label>
                  <Select value={quarter} onChange={(event) => setQuarter(Number(event.target.value) as Quarter)}>
                    {quarterOptions.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}: {item.helper}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label>Mode Proses</Label>
                  <Select value={mode} onChange={(event) => setMode(event.target.value as OperationMode)}>
                    {modeOptions.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </Select>
                </div>
                <div className="md:col-span-3">
                  <Label>Link Umpan Balik</Label>
                  <div className="grid gap-2 lg:grid-cols-[1fr_auto]">
                    <Input value={feedbackLink} onChange={(event) => setFeedbackLink(event.target.value)} />
                    <Button variant="secondary" disabled={busy !== null} onClick={() => void saveFeedbackLink(true)}>
                      {busy === "settings" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save size={16} />}
                      Simpan Link
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Status Periodik</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3">
                <Metric label="Total SKP" value={preview?.summary.totalSkp ?? rows.length} />
                <Metric label="Log Triwulan" value={preview?.summary.totalLogs ?? 0} />
                <Metric label="Siap Isi" value={selectedRows.length} />
                <Metric label="Belum Ada Log" value={preview?.summary.noLogCount ?? rows.filter((row) => row.status === "no_logs").length} />
              </CardContent>
            </Card>
          </section>

          <Card>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm leading-6 text-slate-500 dark:text-slate-400">
                Mode aktif: <span className="font-medium text-slate-700 dark:text-slate-200">{modeDescription(mode)}</span>
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button variant="secondary" disabled={busy !== null} onClick={() => void refreshStatus()}>
                  {busy === "refresh" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw size={16} />}
                  Refresh Status
                </Button>
                <Button disabled={busy !== null} onClick={() => void runMode()}>
                  {busy === "generate" || busy === "fill" || busy === "submit" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play size={16} />}
                  Jalankan Proses
                </Button>
              </div>
            </CardContent>
          </Card>

          {notice && <Notice tone="success"><CheckCircle2 size={16} />{notice}</Notice>}
          {error && (
            <ErrorState
              title={error.title}
              message={error.message}
              code={error.code}
              detail={error.detail ?? error.screenshotPath}
              onRetry={() => void generate()}
            />
          )}
          {error?.screenshotPath && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void api.openSkp()}><ExternalLink size={16} />Buka Website SKP</Button>
            </div>
          )}
          {busy === "fill" && <Notice tone="warning"><Loader2 className="h-4 w-4 animate-spin" />Mengisi website SKP. Jangan tutup aplikasi sampai proses selesai.</Notice>}
          {busy === "submit" && <Notice tone="warning"><Loader2 className="h-4 w-4 animate-spin" />Mengajukan SKP Periodik setelah konfirmasi website diproses.</Notice>}

          {result && <RunResultCard result={result} />}

          <PreviewTable rows={rows} onEdit={setEdit} onToggle={toggleRow} onReset={resetRow} onOverwrite={(index, overwrite) => updateRow(index, { overwrite })} />
        </div>
      )}

      {!loading && tab === "history" && <HistoryTab items={history} onRefresh={loadHistory} />}

      {edit && (
        <Modal
          title={edit.field === "realization" ? "Edit Realisasi" : "Edit Link Umpan Balik"}
          description={rows[edit.index]?.kode_skp ? `${rows[edit.index].kode_skp} - ${rows[edit.index].nama_skp}` : undefined}
          onClose={() => setEdit(null)}
        >
          <div className="space-y-4">
            {edit.field === "realization" ? (
              <Textarea className="min-h-48" value={edit.value} onChange={(event) => setEdit({ ...edit, value: event.target.value })} />
            ) : (
              <Input value={edit.value} onChange={(event) => setEdit({ ...edit, value: event.target.value })} />
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEdit(null)}>Batal</Button>
              <Button onClick={saveEdit}><Save size={16} />Simpan</Button>
            </div>
          </div>
        </Modal>
      )}

      {pendingSend && preview && (
        <Modal
          title={pendingSend === "fill_submit" ? "Validasi & Konfirmasi Ajukan" : "Validasi Sebelum Isi Website"}
          description="Periksa data di bawah. Aplikasi hanya mengirim untuk periode yang dipilih."
          onClose={() => setPendingSend(null)}
          className="max-w-2xl"
        >
          <div className="space-y-4">
            {!previewMatchesSelection && (
              <Notice tone="danger">
                <AlertCircle size={16} />
                Preview belum sesuai triwulan yang dipilih. Batalkan dan buat preview {QUARTER_META[quarter].label} {year} dulu.
              </Notice>
            )}
            <div className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950">
              <ValidationRow label="Triwulan dipilih" value={`${QUARTER_META[quarter].label} (${QUARTER_META[quarter].monthText} ${year})`} />
              <ValidationRow label="URL tujuan" value={preview.targetUrl ?? quarterTargetUrl(quarter, periodicBaseUrl)} mono />
              <ValidationRow label="Rentang tanggal log" value={`${formatDateID(preview.dateFrom)} s.d. ${formatDateID(preview.dateTo)}`} />
              <ValidationRow label="SKP akan diisi" value={`${selectedRows.length} SKP (${selectedRows.reduce((total, row) => total + row.logCount, 0)} log total)`} />
              <ValidationRow label="Link umpan balik" value={feedbackLink} mono />
            </div>
            <div className="max-h-52 space-y-2 overflow-auto rounded-lg border border-slate-100 p-2 dark:border-slate-800">
              {selectedRows.map((row) => (
                <div key={row.kode_skp} className="rounded-md bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-800 dark:text-slate-100">{row.kode_skp} — {row.nama_skp}</span>
                    <span className="shrink-0 tabular-nums text-slate-500">{row.logCount} log{row.overwrite ? " · overwrite" : ""}</span>
                  </div>
                  <div className="mt-1 leading-5 text-slate-600 dark:text-slate-300">{row.realization || "-"}</div>
                </div>
              ))}
            </div>
            {pendingSend === "fill_submit" && (
              <Notice tone="warning">
                <AlertCircle size={16} />
                Pengajuan dapat memengaruhi status penilaian. Data yang sudah ada di website tidak ditimpa kecuali checkbox Overwrite aktif.
              </Notice>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPendingSend(null)}>Batal</Button>
              <Button
                variant={pendingSend === "fill_submit" ? "danger" : "primary"}
                disabled={!previewMatchesSelection || selectedRows.length === 0}
                onClick={() => void proceedPendingSend()}
              >
                <Send size={16} />
                {pendingSend === "fill_submit" ? "Lanjut Isi + Ajukan" : "Lanjut Isi Website"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function PeriodicStepper({ mode, hasPreview, hasResult }: { mode: OperationMode; hasPreview: boolean; hasResult: boolean }): JSX.Element {
  const steps = [
    { label: "Pilih Triwulan", active: true },
    { label: "Generate Realisasi", active: hasPreview },
    { label: "Preview & Edit", active: hasPreview },
    { label: "Isi Website", active: hasResult || mode !== "preview" },
    { label: "Ajukan", active: mode === "fill_submit" }
  ];
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
      {steps.map((step, index) => (
        <div
          key={step.label}
          className={cn(
            "flex min-h-14 items-center gap-3 rounded-lg border px-3 py-2 text-sm transition",
            step.active
              ? "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300"
              : "border-slate-200 bg-white text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400"
          )}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-white text-xs font-semibold dark:border-slate-700 dark:bg-slate-950">{index + 1}</span>
          <span className="font-medium">{step.label}</span>
        </div>
      ))}
    </div>
  );
}

function PeriodPreviewBanner({
  selectedQuarter,
  selectedYear,
  preview,
  matches,
  targetUrl
}: {
  selectedQuarter: Quarter;
  selectedYear: number;
  preview: PeriodicPreview | null;
  matches: boolean;
  targetUrl: string;
}): JSX.Element {
  const meta = QUARTER_META[selectedQuarter];
  if (matches && preview) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
        <span className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white dark:bg-emerald-500 dark:text-emerald-950">
          <CheckCircle2 size={14} />
          Preview {meta.label}: {meta.monthText} {selectedYear}
        </span>
        <span className="tabular-nums">
          Rentang log aktif: {formatDateID(preview.dateFrom)} s.d. {formatDateID(preview.dateTo)}
        </span>
        <span className="text-emerald-700/80 dark:text-emerald-300/80">Target: {targetUrl}</span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
      <AlertCircle size={16} className="shrink-0" />
      <span>
        Anda memilih <span className="font-semibold">{meta.label} {selectedYear}</span> ({meta.monthText}).
        {preview ? ` Preview yang tampil masih ${QUARTER_META[(preview.quarter as Quarter) ?? selectedQuarter]?.label ?? `Triwulan ${preview.quarter}`} ${preview.year}.` : " Belum ada preview."}
        {" "}Klik <span className="font-semibold">Jalankan Proses</span> (mode Preview Saja) untuk memuat data periode ini.
      </span>
    </div>
  );
}

function ValidationRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-[160px_1fr] sm:gap-3">
      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>
      <span className={cn("break-all text-slate-800 dark:text-slate-100", mono && "font-mono text-xs")}>{value || "-"}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }): JSX.Element {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-950 dark:text-slate-100">{value}</div>
    </div>
  );
}

function PreviewTable({
  rows,
  onEdit,
  onToggle,
  onReset,
  onOverwrite
}: {
  rows: PeriodicRow[];
  onEdit: (state: EditState) => void;
  onToggle: (index: number) => void;
  onReset: (index: number) => void;
  onOverwrite: (index: number, value: boolean) => void;
}): JSX.Element {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Preview belum dibuat"
        description="Pilih tahun dan triwulan, lalu generate realisasi dari Log Harian lokal."
        icon={<RefreshCw size={18} />}
      />
    );
  }

  return (
    <TableCard>
      <DataTable className="min-w-[1320px]">
        <thead>
          <tr>
            <th>Kode SKP</th>
            <th>Sasaran SKP</th>
            <th>Jumlah Log</th>
            <th>Realisasi yang Akan Diisi</th>
            <th>Umpan Balik/Link</th>
            <th>Status</th>
            <th>Aksi</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.kode_skp}>
              <td className="font-semibold tabular-nums">{row.kode_skp}</td>
              <td>
                <div className="max-w-[260px] whitespace-normal font-medium text-slate-900 dark:text-slate-100">{row.nama_skp}</div>
                {row.indikator.length > 0 && <div className="mt-1 max-w-[260px] whitespace-normal text-xs leading-5 text-slate-500 dark:text-slate-400">{row.indikator.slice(0, 2).join("; ")}</div>}
              </td>
              <td className="tabular-nums">{row.logCount}</td>
              <td>
                <div className="max-w-[390px] whitespace-normal text-sm leading-6 text-slate-700 dark:text-slate-300">{row.realization || "-"}</div>
              </td>
              <td>
                <div className="max-w-[260px] break-all text-xs leading-5 text-slate-600 dark:text-slate-300">{row.feedbackLink || "-"}</div>
              </td>
              <td>
                <div className="space-y-2">
                  <Badge status={row.status}>{row.statusLabel || statusLabel(row.status)}</Badge>
                  <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <input type="checkbox" checked={row.overwrite} onChange={(event) => onOverwrite(index, event.target.checked)} disabled={row.status === "no_logs"} />
                    Overwrite
                  </label>
                </div>
              </td>
              <td>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => onEdit({ index, field: "realization", value: row.realization })} disabled={row.status === "no_logs"}>
                    <Edit3 size={14} />Realisasi
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => onEdit({ index, field: "feedbackLink", value: row.feedbackLink })} disabled={row.status === "no_logs"}>
                    <Edit3 size={14} />Link
                  </Button>
                  <Button size="sm" variant={row.shouldFill ? "secondary" : "ghost"} onClick={() => onToggle(index)} disabled={row.status === "no_logs"}>
                    {row.shouldFill ? "Jangan Isi" : "Pilih Isi"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onReset(index)}>
                    <RotateCcw size={14} />Reset
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </TableCard>
  );
}

function RunResultCard({ result }: { result: PeriodicRunResult }): JSX.Element {
  return (
    <Card>
      <CardHeader className="dashboard-card-header">
        <div>
          <CardTitle>Hasil Proses</CardTitle>
          <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{result.message}</p>
        </div>
        <Badge status={result.status}>{periodicStatusLabel(result.status)}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric label="Diproses" value={result.totalItems} />
          <Metric label="Terisi / Sudah Ada" value={result.successCount} />
          <Metric label="Dilewati" value={result.skippedCount} />
          <Metric label="Gagal" value={result.failedCount} />
        </div>
        {submitStateNotice(result)}
        {!result.ok && result.errorLast && <Notice tone="danger">{result.errorLast}</Notice>}
        {result.screenshotPath && <Notice tone="warning">Screenshot: {result.screenshotPath}</Notice>}
        {(result.currentUrlBeforeClick || result.currentUrlAfterClick || result.targetUrl || result.expectedUrl || result.visibleHeading || result.screenshotPath || !result.ok) && (
          <div className="grid grid-cols-1 gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <ValidationRow label="step" value={result.step ?? "-"} mono />
            <ValidationRow label="current_url_before_click" value={result.currentUrlBeforeClick ?? "-"} mono />
            <ValidationRow label="current_url_after_click" value={result.currentUrlAfterClick ?? result.currentUrl ?? "-"} mono />
            <ValidationRow label="current_url" value={result.currentUrl ?? "-"} mono />
            <ValidationRow label="origin" value={result.origin ?? result.baseUrl ?? "-"} mono />
            <ValidationRow label="targetUrl" value={result.targetUrl ?? result.expectedUrl ?? "-"} mono />
            <ValidationRow label="expected_url" value={result.expectedUrl ?? "-"} mono />
            <ValidationRow label="expected_quarter" value={`Triwulan ${result.quarter}`} />
            <ValidationRow label="expected_page_title" value={result.expectedPageTitle ?? "-"} />
            <ValidationRow label="visible_page_title" value={result.visiblePageTitle ?? "-"} />
            <ValidationRow label="visible_heading" value={result.visibleHeading ?? result.visiblePageTitle ?? "-"} />
            <ValidationRow label="green_edit_button_count" value={String(result.greenEditButtonCount ?? "-")} />
            <ValidationRow label="clicked_menu_text" value={result.clickedMenuText ?? "-"} />
            <ValidationRow label="sidebar_texts" value={result.availableSidebarItems?.join(" | ") ?? "-"} />
            <ValidationRow label="base_url" value={result.baseUrl ?? "-"} mono />
            <ValidationRow label="screenshot_path" value={result.screenshotPath ?? "-"} mono />
            <ValidationRow label="visible_text_sample" value={result.visibleTextSample ?? "-"} />
          </div>
        )}
        {result.availableSidebarItems && result.availableSidebarItems.length > 0 && (
          <details className="rounded-lg border border-slate-100 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <summary className="cursor-pointer font-medium">Menu sidebar terdeteksi ({result.availableSidebarItems.length})</summary>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {result.availableSidebarItems.map((label, index) => (
                <span key={`${label}-${index}`} className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 dark:border-slate-700 dark:bg-slate-900">{label}</span>
              ))}
            </div>
          </details>
        )}
        {result.availableButtons && result.availableButtons.length > 0 && (
          <details className="rounded-lg border border-slate-100 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <summary className="cursor-pointer font-medium">Tombol terdeteksi di halaman ({result.availableButtons.length})</summary>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {result.availableButtons.map((label, index) => (
                <span key={`${label}-${index}`} className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 dark:border-slate-700 dark:bg-slate-900">{label}</span>
              ))}
            </div>
          </details>
        )}
        {result.items.length > 0 && (
          <div className="space-y-2">
            {result.items.map((item) => (
              <div key={item.kode_skp} className="flex flex-col gap-2 rounded-lg border border-slate-100 px-3 py-2 text-sm dark:border-slate-800 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="font-medium text-slate-950 dark:text-slate-100">{item.kode_skp} - {item.nama_skp}</div>
                  <div className="mt-1 text-slate-500 dark:text-slate-400">{item.message}</div>
                  {item.currentUrl && <div className="mt-1 break-all text-xs text-slate-500 dark:text-slate-400">URL: {item.currentUrl}{item.step ? ` · step: ${item.step}` : ""}</div>}
                  {item.currentSkpRow && <div className="mt-1 break-all text-xs text-slate-500 dark:text-slate-400">Row SKP: {item.currentSkpRow}</div>}
                  {typeof item.greenEditButtonCount === "number" && <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Tombol edit hijau: {item.greenEditButtonCount}</div>}
                  {item.screenshotPath && <div className="mt-1 break-all text-xs text-amber-700 dark:text-amber-300">Screenshot: {item.screenshotPath}</div>}
                  <ItemDiagnostics inputs={item.availableInputs} buttons={item.availableButtons} headings={item.headings} />
                </div>
                <Badge status={item.status}>{statusLabel(item.status)}</Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ItemDiagnostics({ inputs, buttons, headings }: { inputs?: string[]; buttons?: string[]; headings?: string[] }): JSX.Element | null {
  const hasAny = (inputs && inputs.length > 0) || (buttons && buttons.length > 0) || (headings && headings.length > 0);
  if (!hasAny) return null;
  return (
    <details className="mt-2 rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-slate-700">
      <summary className="cursor-pointer font-medium text-slate-600 dark:text-slate-300">Detail halaman (input/tombol/heading terdeteksi)</summary>
      <div className="mt-2 space-y-2">
        {inputs && inputs.length > 0 && <DiagList title={`Input terdeteksi (${inputs.length})`} items={inputs} />}
        {buttons && buttons.length > 0 && <DiagList title={`Tombol terdeteksi (${buttons.length})`} items={buttons} />}
        {headings && headings.length > 0 && <DiagList title={`Label/Heading (${headings.length})`} items={headings} />}
      </div>
    </details>
  );
}

function DiagList({ title, items }: { title: string; items: string[] }): JSX.Element {
  return (
    <div>
      <div className="font-semibold text-slate-500 dark:text-slate-400">{title}</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {items.map((text, index) => (
          <span key={`${text}-${index}`} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] dark:border-slate-700 dark:bg-slate-900">{text}</span>
        ))}
      </div>
    </div>
  );
}

function submitStateNotice(result: PeriodicRunResult): JSX.Element | null {
  switch (result.submitState) {
    case "submitted":
      return <Notice tone="success"><CheckCircle2 size={16} />SKP Periodik berhasil diajukan.</Notice>;
    case "already_submitted":
      return <Notice tone="success"><CheckCircle2 size={16} />SKP Periodik sudah diajukan sebelumnya.</Notice>;
    case "button_not_found":
      return <Notice tone="warning"><AlertCircle size={16} />Data sudah terisi/terdeteksi, tetapi tombol Ajukan belum tersedia. Silakan ajukan manual bila perlu.</Notice>;
    case "button_disabled":
      return <Notice tone="warning"><AlertCircle size={16} />Tombol Ajukan belum aktif. Pastikan seluruh item SKP sudah lengkap.</Notice>;
    case "not_ready":
      return <Notice tone="warning"><AlertCircle size={16} />Pengajuan perlu dicek di website SKP.</Notice>;
    default:
      return null;
  }
}

function HistoryTab({ items, onRefresh }: { items: PeriodicHistory[]; onRefresh: () => Promise<void> }): JSX.Element {
  return (
    <div className="space-y-4">
      <div className="section-heading">
        <div>
          <h2 className="section-title">Riwayat SKP Periodik</h2>
          <p className="section-description">Proses preview, isi website, dan pengajuan tersimpan lokal perangkat ini.</p>
        </div>
        <Button variant="secondary" onClick={() => void onRefresh()}><RefreshCw size={16} />Refresh</Button>
      </div>
      <TableCard>
        <DataTable className="min-w-[1040px]">
          <thead>
            <tr>
              <th>Waktu WIB</th>
              <th>Periode</th>
              <th>Mode</th>
              <th>Jumlah SKP</th>
              <th>Berhasil</th>
              <th>Gagal</th>
              <th>Status Ajukan</th>
              <th>Status</th>
              <th>Error Terakhir</th>
              <th>Screenshot</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{formatDateTimeWIB(item.created_at)}</td>
                <td>Triwulan {item.quarter} {item.year}</td>
                <td><Badge status={item.mode}>{modeLabel(item.mode)}</Badge></td>
                <td className="tabular-nums">{item.total_skp}</td>
                <td className="tabular-nums">{item.success_count}</td>
                <td className="tabular-nums">{item.failed_count}</td>
                <td>{item.submit_status ?? "-"}</td>
                <td><Badge status={item.status}>{periodicStatusLabel(item.status)}</Badge></td>
                <td className="max-w-[260px] whitespace-normal text-slate-600 dark:text-slate-300">{item.error_last ?? "-"}</td>
                <td className="max-w-[260px] break-all text-xs">{item.screenshot_path ?? "-"}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8">
                  <EmptyState title="Belum ada riwayat periodik" description="Riwayat muncul setelah preview, isi website, atau ajukan dijalankan." icon={<History size={18} />} />
                </td>
              </tr>
            )}
          </tbody>
        </DataTable>
      </TableCard>
    </div>
  );
}

function toPayloadItems(rows: PeriodicRow[]): Array<Record<string, unknown>> {
  return rows.map((row) => ({
    kode_skp: row.kode_skp,
    nama_skp: row.nama_skp,
    realization: row.realization,
    feedbackLink: row.feedbackLink,
    shouldFill: row.shouldFill,
    overwrite: row.overwrite
  }));
}

function toUiError(error: unknown): { title: string; message: string; code?: string; detail?: string; screenshotPath?: string } {
  const friendly = friendlyErrorMessage(error instanceof Error ? error.message : String(error));
  const parsed = parseMaybeJson(error instanceof Error ? error.message : String(error));
  return {
    ...friendly,
    screenshotPath: parsed?.screenshot_path ? String(parsed.screenshot_path) : undefined
  };
}

function parseMaybeJson(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function quarterFromToday(): Quarter {
  const month = Number(todayDateKeyWIB().slice(5, 7));
  if (month <= 3) return 1;
  if (month <= 6) return 2;
  if (month <= 9) return 3;
  return 4;
}

function periodicStatusLabel(status?: string): string {
  const labels: Record<string, string> = {
    not_created: "Belum dibuat",
    preview_ready: "Preview siap",
    partially_filled: "Terisi sebagian",
    filled_all: "Terisi semua",
    ready_to_submit_manual: "Siap ajukan manual",
    submitted: "Diajukan",
    failed_navigation: "Gagal navigasi",
    failed: "Gagal",
    needs_check: "Perlu dicek"
  };
  return labels[status ?? ""] ?? statusLabel(status);
}

function modeLabel(mode?: string): string {
  const labels: Record<string, string> = {
    preview: "Preview Saja",
    fill: "Isi ke Website",
    fill_submit: "Isi + Ajukan"
  };
  return labels[mode ?? ""] ?? statusLabel(mode);
}

function modeDescription(mode: OperationMode): string {
  const labels: Record<OperationMode, string> = {
    preview: "Preview Saja — hanya menyusun realisasi, tidak membuka website untuk isi/ajukan.",
    fill: "Isi ke Website — mengisi realisasi & umpan balik yang masih kosong.",
    fill_submit: "Isi + Ajukan — mengisi lalu klik Ajukan bila tombolnya tersedia."
  };
  return labels[mode];
}
