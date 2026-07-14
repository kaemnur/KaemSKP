import { randomUUID } from "node:crypto";
import { addHistory, getActivePeriod, getDb, getSetting, setSetting } from "../db/database";
import { buildQuarterUrl, getPeriodicBaseUrl, runPeriodicFill, submitPeriodicQuarter } from "../automation/skpPeriodicAutomation";
import type {
  DailyLog,
  PeriodicFillItem,
  PeriodicHistory,
  PeriodicMode,
  PeriodicPreview,
  PeriodicPreviewRow,
  PeriodicQuarter,
  PeriodicRunResult,
  PeriodicStatus,
  SkpItem
} from "../types";
import { nowIso, toDateKey } from "../utils/date";

export const DEFAULT_PERIODIC_FEEDBACK_LINK = "https://drive.google.com/drive/folders/1ln6FSUk550YVlnToaoZ1EUalAVjuIBWB";

const QUARTER_MONTHS: Record<PeriodicQuarter, { startMonth: number; endMonth: number; label: string; monthText: string }> = {
  1: { startMonth: 1, endMonth: 3, label: "Triwulan I", monthText: "Januari sampai Maret" },
  2: { startMonth: 4, endMonth: 6, label: "Triwulan II", monthText: "April sampai Juni" },
  3: { startMonth: 7, endMonth: 9, label: "Triwulan III", monthText: "Juli sampai September" },
  4: { startMonth: 10, endMonth: 12, label: "Triwulan IV", monthText: "Oktober sampai Desember" }
};

type PeriodRow = {
  id: string;
  year: number;
  start_date: string;
  end_date: string;
  label: string;
};

export function currentPeriodicDefaults(): { year: number; quarter: PeriodicQuarter; feedbackLink: string; baseUrl: string; targetUrl: string } {
  const activePeriod = getActivePeriod();
  const quarter = getCurrentQuarter();
  return {
    year: activePeriod.year || 2026,
    quarter,
    feedbackLink: getPeriodicFeedbackLink(),
    baseUrl: getPeriodicBaseUrl(),
    targetUrl: buildQuarterUrl(quarter)
  };
}

export function getCurrentQuarter(dateKey = toDateKey()): PeriodicQuarter {
  const month = Number(dateKey.slice(5, 7));
  if (month <= 3) return 1;
  if (month <= 6) return 2;
  if (month <= 9) return 3;
  return 4;
}

export function getPeriodicFeedbackLink(): string {
  return getSetting("periodic_feedback_link", DEFAULT_PERIODIC_FEEDBACK_LINK).trim() || DEFAULT_PERIODIC_FEEDBACK_LINK;
}

export function updatePeriodicSettings(payload: Record<string, unknown>): { ok: true; periodic_feedback_link: string } {
  const feedbackLink = cleanText(payload.periodic_feedback_link);
  if (feedbackLink) {
    setSetting("periodic_feedback_link", feedbackLink);
    addHistory("periodic.settings", "Pengaturan SKP Periodik disimpan", "Link umpan balik periodik diperbarui.", "success");
  }
  return { ok: true, periodic_feedback_link: getPeriodicFeedbackLink() };
}

export function getQuarterRange(yearInput: number, quarterInput: number): { year: number; quarter: PeriodicQuarter; label: string; dateFrom: string; dateTo: string; monthText: string } {
  const year = Number.isFinite(yearInput) ? Number(yearInput) : 2026;
  const quarter = normalizeQuarter(quarterInput);
  const meta = QUARTER_MONTHS[quarter];
  const dateFrom = `${year}-${String(meta.startMonth).padStart(2, "0")}-01`;
  const dateTo = `${year}-${String(meta.endMonth).padStart(2, "0")}-${lastDayOfMonth(year, meta.endMonth)}`;
  return { year, quarter, label: meta.label, dateFrom, dateTo, monthText: meta.monthText };
}

export function generatePeriodicPreview(input: {
  year?: number;
  quarter?: number;
  feedbackLink?: string;
  persistFeedbackLink?: boolean;
  recordHistory?: boolean;
} = {}): PeriodicPreview {
  const defaults = currentPeriodicDefaults();
  const range = getQuarterRange(Number(input.year ?? defaults.year), Number(input.quarter ?? defaults.quarter));
  const feedbackLink = cleanText(input.feedbackLink) || getPeriodicFeedbackLink();
  if (input.persistFeedbackLink && feedbackLink) setSetting("periodic_feedback_link", feedbackLink);

  const period = getPeriodForYear(range.year);
  const skpItems = listActiveSkpItems(period.id);
  const logsBySkp = groupLogsBySkp(listQuarterLogs(period.id, range.dateFrom, range.dateTo));
  const rows = skpItems.map((skpItem) => buildPreviewRow(skpItem, logsBySkp.get(skpItem.kode_skp) ?? [], range.quarter, range.year, feedbackLink));
  const summary = {
    totalSkp: rows.length,
    readyCount: rows.filter((row) => row.status === "ready").length,
    noLogCount: rows.filter((row) => row.status === "no_logs").length,
    selectedCount: rows.filter((row) => row.shouldFill).length,
    totalLogs: rows.reduce((total, row) => total + row.logCount, 0)
  };
  const status = getLatestPeriodicStatus(period.id, range.year, range.quarter) ?? "not_created";

  if (input.recordHistory) {
    addPeriodicHistory({
      periodId: period.id,
      year: range.year,
      quarter: range.quarter,
      totalSkp: rows.length,
      successCount: summary.readyCount,
      failedCount: summary.noLogCount,
      submitStatus: "Belum diajukan",
      status: "preview_ready",
      mode: "preview",
      errorLast: summary.noLogCount > 0 ? `${summary.noLogCount} SKP belum punya log triwulan.` : null,
      screenshotPath: null
    });
  }

  return {
    ok: true,
    year: range.year,
    quarter: range.quarter,
    quarterLabel: range.label,
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    feedbackLink,
    baseUrl: getPeriodicBaseUrl(),
    targetUrl: buildQuarterUrl(range.quarter),
    status: input.recordHistory ? "preview_ready" : status,
    summary,
    rows
  };
}

export function generatePeriodicRealization({
  skpItem,
  logs,
  quarter,
  year
}: {
  skpItem: SkpItem;
  logs: DailyLog[];
  quarter: PeriodicQuarter;
  year: number;
}): string {
  if (logs.length === 0) return "";
  const range = getQuarterRange(year, quarter);
  const activitySummary = summarizeActivities(logs);
  const indicatorSummary = summarizeIndicators(skpItem, logs);
  const outputSummary = summarizeOutputs(logs);
  const skpName = cleanSkpName(skpItem.nama_skp);
  const mainSentence = `Pada ${range.label} Tahun ${year}, telah dilaksanakan ${activitySummary} untuk mendukung sasaran ${skpName}${indicatorSummary}.`;
  const supportSentence = `Kegiatan didukung oleh ${logs.length} log harian periode ${range.monthText} ${year}${outputSummary}`;
  return limitLength(`${mainSentence} ${supportSentence}`, 620);
}

export function listPeriodicHistory(limit = 100): PeriodicHistory[] {
  return getDb()
    .prepare("SELECT * FROM periodic_history ORDER BY created_at DESC LIMIT ?")
    .all(Math.max(1, Math.min(500, limit))) as PeriodicHistory[];
}

export async function fillPeriodicFromPreview(payload: {
  year?: number;
  quarter?: number;
  items?: PeriodicFillItem[];
  overwrite?: boolean;
  submit?: boolean;
}): Promise<PeriodicRunResult> {
  const defaults = currentPeriodicDefaults();
  const range = getQuarterRange(Number(payload.year ?? defaults.year), Number(payload.quarter ?? defaults.quarter));
  const period = getPeriodForYear(range.year);
  const selectedItems = normalizeFillItems(payload.items ?? [], Boolean(payload.overwrite));
  const mode: PeriodicMode = payload.submit ? "fill_submit" : "fill";
  if (selectedItems.length === 0) {
    const result = buildRunResult({
      year: range.year,
      quarter: range.quarter,
      status: "needs_check",
      mode,
      message: "Tidak ada SKP yang dipilih untuk diisi.",
      items: []
    });
    recordRunHistory(period.id, result);
    return result;
  }

  try {
    const result = await runPeriodicFill({
      year: range.year,
      quarter: range.quarter,
      items: selectedItems,
      submit: Boolean(payload.submit)
    });
    recordRunHistory(period.id, result);
    return result;
  } catch (error) {
    const result = buildFailedRunResult(range.year, range.quarter, mode, error, selectedItems.length);
    recordRunHistory(period.id, result);
    return result;
  }
}

export async function submitPeriodicOnly(payload: {
  year?: number;
  quarter?: number;
  items?: PeriodicFillItem[];
  overwrite?: boolean;
}): Promise<PeriodicRunResult> {
  if (payload.items && payload.items.length > 0) {
    return fillPeriodicFromPreview({ ...payload, submit: true });
  }

  const defaults = currentPeriodicDefaults();
  const range = getQuarterRange(Number(payload.year ?? defaults.year), Number(payload.quarter ?? defaults.quarter));
  const period = getPeriodForYear(range.year);
  try {
    const result = await submitPeriodicQuarter({ year: range.year, quarter: range.quarter });
    recordRunHistory(period.id, result);
    return result;
  } catch (error) {
    const result = buildFailedRunResult(range.year, range.quarter, "fill_submit", error, 0);
    recordRunHistory(period.id, result);
    return result;
  }
}

function buildPreviewRow(skpItem: SkpItem, logs: DailyLog[], quarter: PeriodicQuarter, year: number, feedbackLink: string): PeriodicPreviewRow {
  const indikator = parseIndicators(skpItem.indikator_json, logs);
  const realization = generatePeriodicRealization({ skpItem, logs, quarter, year });
  const noLogs = logs.length === 0;
  return {
    kode_skp: skpItem.kode_skp,
    nama_skp: skpItem.nama_skp,
    indikator,
    logCount: logs.length,
    realization,
    generatedRealization: realization,
    feedbackLink,
    shouldFill: !noLogs,
    overwrite: false,
    status: noLogs ? "no_logs" : "ready",
    statusLabel: noLogs ? "Belum ada data log" : "Preview siap",
    notes: noLogs ? ["Belum ada log harian pada triwulan ini. Baris tidak otomatis diisi."] : [],
    logs: logs.map((log) => ({
      id: log.id,
      tanggal: log.tanggal,
      nama_aktivitas: log.nama_aktivitas,
      deskripsi: log.deskripsi,
      indikator_kinerja_individu: log.indikator_kinerja_individu,
      kuantitas_output: log.kuantitas_output,
      satuan: log.satuan,
      status_local: log.status_local,
      status_skp: log.status_skp
    }))
  };
}

function getPeriodForYear(year: number): PeriodRow {
  const active = getActivePeriod();
  if (active.year === year) return active;
  const row = getDb()
    .prepare("SELECT id, year, start_date, end_date, label FROM skp_periods WHERE year = ? ORDER BY is_active DESC, updated_at DESC LIMIT 1")
    .get(year) as PeriodRow | undefined;
  return row ?? active;
}

function listActiveSkpItems(periodId: string): SkpItem[] {
  return getDb()
    .prepare("SELECT * FROM skp_items WHERE period_id = ? AND is_active = 1 ORDER BY kode_skp")
    .all(periodId) as SkpItem[];
}

function listQuarterLogs(periodId: string, dateFrom: string, dateTo: string): DailyLog[] {
  return getDb()
    .prepare(
      `SELECT *
       FROM daily_logs
       WHERE period_id = @period_id
         AND tanggal >= @date_from
         AND tanggal <= @date_to
         AND COALESCE(kode_skp, '') <> ''
         AND status_local NOT IN ('invalid','skipped','holiday','leave','no_plan')
       ORDER BY tanggal ASC, kode_log ASC`
    )
    .all({ period_id: periodId, date_from: dateFrom, date_to: dateTo }) as DailyLog[];
}

function groupLogsBySkp(logs: DailyLog[]): Map<string, DailyLog[]> {
  const grouped = new Map<string, DailyLog[]>();
  for (const log of logs) {
    if (!log.kode_skp) continue;
    grouped.set(log.kode_skp, [...(grouped.get(log.kode_skp) ?? []), log]);
  }
  return grouped;
}

function parseIndicators(value: string | null, logs: DailyLog[]): string[] {
  const fromSkp = parseJsonIndicators(value);
  const fromLogs = logs
    .map((log) => cleanText(log.indikator_kinerja_individu))
    .filter((item): item is string => Boolean(item));
  return uniqueTexts([...fromSkp, ...fromLogs]).slice(0, 4);
}

function parseJsonIndicators(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object" && "indikator" in item) return String((item as { indikator?: unknown }).indikator ?? "");
          return "";
        })
        .map((item) => cleanText(item))
        .filter((item): item is string => Boolean(item));
    }
  } catch {
    return [value].map((item) => cleanText(item)).filter((item): item is string => Boolean(item));
  }
  return [];
}

function summarizeActivities(logs: DailyLog[]): string {
  const combinedText = logs.map((log) => [log.nama_aktivitas, log.deskripsi, log.indikator_kinerja_individu].filter(Boolean).join(" ")).join(" ");
  const normalized = normalizeForKeyword(combinedText);
  const categories = [
    { label: "penyusunan dokumen", pattern: /dokumen|nspk|bahan|laporan|sk pemberian|rekapitulasi/ },
    { label: "pengolahan data", pattern: /pengolahan|olah data|data pip|data penerima/ },
    { label: "validasi dan verifikasi data", pattern: /validasi|verifikasi|pemadanan/ },
    { label: "koordinasi pelaksanaan program", pattern: /koordinasi|tindak lanjut|pihak terkait/ },
    { label: "monitoring dan supervisi", pattern: /monitoring|supervisi|pemantauan/ },
    { label: "percepatan penyaluran bantuan", pattern: /penyaluran|percepatan|bantuan|pip/ },
    { label: "pengelolaan konten dan publikasi", pattern: /konten|publikasi|media sosial|sobat pip|sahabat pip/ },
    { label: "administrasi data", pattern: /administrasi|teradministrasi|usulan|calon penerima/ }
  ];
  const candidates = categories.filter((category) => category.pattern.test(normalized)).map((category) => category.label).slice(0, 4);
  if (candidates.length === 0) return "kegiatan pelaksanaan, koordinasi, dan administrasi tugas";
  return `kegiatan ${joinIndonesianList(candidates)}`;
}

function summarizeIndicators(skpItem: SkpItem, logs: DailyLog[]): string {
  const indicators = parseIndicators(skpItem.indikator_json, logs).slice(0, 2);
  if (indicators.length === 0) return " sesuai indikator kinerja yang ditetapkan";
  return ` sesuai indikator ${joinIndonesianList(indicators.map((item) => limitLength(item, 120)))}`;
}

function summarizeOutputs(logs: DailyLog[]): string {
  const outputs = uniqueTexts(logs.map((log) => cleanText(log.satuan)).filter((item): item is string => Boolean(item)).map((item) => lowerFirst(item))).slice(0, 3);
  if (outputs.length === 0) return ".";
  return ` dengan output terdokumentasi berupa ${joinIndonesianList(outputs)}.`;
}

function normalizeFillItems(items: PeriodicFillItem[], overwrite: boolean): PeriodicFillItem[] {
  return items
    .filter((item) => item.shouldFill !== false)
    .map((item) => ({
      kode_skp: cleanText(item.kode_skp) ?? "",
      nama_skp: cleanText(item.nama_skp) ?? "",
      realization: cleanText(item.realization) ?? "",
      feedbackLink: cleanText(item.feedbackLink) ?? getPeriodicFeedbackLink(),
      shouldFill: item.shouldFill !== false,
      overwrite: Boolean(item.overwrite ?? overwrite)
    }))
    .filter((item) => item.kode_skp && item.nama_skp && item.realization);
}

function recordRunHistory(periodId: string, result: PeriodicRunResult): void {
  addPeriodicHistory({
    periodId,
    year: result.year,
    quarter: result.quarter,
    totalSkp: result.totalItems,
    successCount: result.successCount,
    failedCount: result.failedCount,
    submitStatus: result.submitStatus,
    status: result.status,
    mode: result.mode,
    errorLast: result.errorLast ?? null,
    screenshotPath: result.screenshotPath ?? null
  });
}

function addPeriodicHistory(input: {
  periodId: string;
  year: number;
  quarter: PeriodicQuarter;
  totalSkp: number;
  successCount: number;
  failedCount: number;
  submitStatus: string | null;
  status: PeriodicStatus;
  mode: PeriodicMode;
  errorLast: string | null;
  screenshotPath: string | null;
}): void {
  const createdAt = nowIso();
  getDb()
    .prepare(
      `INSERT INTO periodic_history
        (id, period_id, year, quarter, total_skp, success_count, failed_count, submit_status, status, mode, error_last, screenshot_path, created_at)
       VALUES
        (@id, @period_id, @year, @quarter, @total_skp, @success_count, @failed_count, @submit_status, @status, @mode, @error_last, @screenshot_path, @created_at)`
    )
    .run({
      id: randomUUID(),
      period_id: input.periodId,
      year: input.year,
      quarter: input.quarter,
      total_skp: input.totalSkp,
      success_count: input.successCount,
      failed_count: input.failedCount,
      submit_status: input.submitStatus,
      status: input.status,
      mode: input.mode,
      error_last: input.errorLast,
      screenshot_path: input.screenshotPath,
      created_at: createdAt
    });

  addHistory(
    "periodic.process",
    periodicStatusText(input.status),
    `${QUARTER_MONTHS[input.quarter].label} ${input.year}: ${input.successCount} berhasil, ${input.failedCount} gagal.`,
    input.status === "failed" || input.status === "failed_navigation" ? "error" : input.status === "needs_check" ? "warning" : "success"
  );
}

function getLatestPeriodicStatus(periodId: string, year: number, quarter: PeriodicQuarter): PeriodicStatus | null {
  const row = getDb()
    .prepare("SELECT status FROM periodic_history WHERE period_id = ? AND year = ? AND quarter = ? ORDER BY created_at DESC LIMIT 1")
    .get(periodId, year, quarter) as { status: PeriodicStatus } | undefined;
  return row?.status ?? null;
}

function buildFailedRunResult(year: number, quarter: PeriodicQuarter, mode: PeriodicMode, error: unknown, totalItems: number): PeriodicRunResult {
  const message = error instanceof Error ? error.message : String(error);
  return buildRunResult({
    year,
    quarter,
    mode,
    status: "failed",
    message: tidyErrorMessage(message),
    totalItems,
    failedCount: totalItems,
    errorLast: tidyErrorMessage(message),
    items: []
  });
}

function buildRunResult(input: Partial<PeriodicRunResult> & { year: number; quarter: PeriodicQuarter; mode: PeriodicMode; status: PeriodicStatus; message: string }): PeriodicRunResult {
  const totalItems = input.totalItems ?? input.items?.length ?? 0;
  const successCount = input.successCount ?? input.items?.filter((item) => item.ok).length ?? 0;
  const failedCount = input.failedCount ?? input.items?.filter((item) => !item.ok && item.status === "failed").length ?? 0;
  const skippedCount = input.skippedCount ?? input.items?.filter((item) => item.status === "skipped" || item.status === "existing").length ?? 0;
  return {
    ok: input.status !== "failed" && input.status !== "failed_navigation",
    year: input.year,
    quarter: input.quarter,
    status: input.status,
    mode: input.mode,
    totalItems,
    successCount,
    failedCount,
    skippedCount,
    submitted: input.submitted ?? false,
    submitStatus: input.submitStatus ?? "Belum diajukan",
    message: input.message,
    screenshotPath: input.screenshotPath,
    errorLast: input.errorLast,
    currentUrl: input.currentUrl,
    baseUrl: input.baseUrl,
    origin: input.origin,
    targetUrl: input.targetUrl,
    expectedUrl: input.expectedUrl,
    step: input.step,
    expectedPageTitle: input.expectedPageTitle,
    visiblePageTitle: input.visiblePageTitle,
    visibleHeading: input.visibleHeading,
    visibleTextSample: input.visibleTextSample,
    availableSidebarItems: input.availableSidebarItems,
    clickedMenuText: input.clickedMenuText,
    currentUrlBeforeClick: input.currentUrlBeforeClick,
    currentUrlAfterClick: input.currentUrlAfterClick,
    submitState: input.submitState,
    availableButtons: input.availableButtons,
    items: input.items ?? []
  };
}

function periodicStatusText(status: PeriodicStatus): string {
  const labels: Record<PeriodicStatus, string> = {
    not_created: "SKP Periodik belum dibuat",
    preview_ready: "Preview SKP Periodik siap",
    partially_filled: "SKP Periodik terisi sebagian",
    filled_all: "SKP Periodik terisi semua",
    ready_to_submit_manual: "SKP Periodik siap diajukan manual",
    submitted: "SKP Periodik diajukan",
    failed_navigation: "Navigasi SKP Periodik gagal",
    failed: "SKP Periodik gagal",
    needs_check: "SKP Periodik perlu dicek"
  };
  return labels[status];
}

function normalizeQuarter(value: number): PeriodicQuarter {
  if (value === 1 || value === 2 || value === 3 || value === 4) return value;
  return getCurrentQuarter();
}

function lastDayOfMonth(year: number, month: number): string {
  return String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0");
}

function cleanSkpName(value: string): string {
  const text = cleanText(value.replace(/\s*\(Penugasan[^)]*\)\s*/gi, " ")) ?? "SKP terkait";
  return `"${limitLength(text, 130)}"`;
}

function cleanText(value?: unknown): string | null {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text : null;
}

function uniqueTexts(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = cleanText(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function joinIndonesianList(values: string[]): string {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} dan ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, dan ${values[values.length - 1]}`;
}

function lowerFirst(value: string): string {
  return value ? value.charAt(0).toLowerCase() + value.slice(1) : value;
}

function limitLength(value: string, max: number): string {
  if (value.length <= max) return value;
  const clipped = value.slice(0, Math.max(0, max - 1)).replace(/\s+\S*$/, "").trimEnd();
  return /[.!?]$/.test(clipped) ? clipped : `${clipped}.`;
}

function normalizeForKeyword(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tidyErrorMessage(message: string): string {
  const parsed = tryParseJson(message);
  const text = parsed ? String(parsed.error_message ?? parsed.message ?? message) : message;
  if (/form.+periodik.+tidak.+ditemukan|periodic.+form.+not.+found/i.test(text)) {
    return "Form SKP Periodik tidak ditemukan. Silakan buka website SKP dan cek apakah menu/format berubah.";
  }
  if (/login|required|session/i.test(text)) return "Session SKP belum aktif atau sudah kedaluwarsa. Silakan login SKP lalu coba lagi.";
  return text || "Proses SKP Periodik belum berhasil.";
}

function tryParseJson(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}
