import {
  getDailyLog,
  getTodayLogStatus,
  hasActiveSyncForLog,
  listDailyLogs,
  updateDailyLogStatus,
  addHistory,
  addQueuedSyncJobItem,
  addSyncJobItem,
  createSyncJob,
  finishSyncJob,
  getSetting,
  getSyncJobProgress,
  refreshSyncJobCounts,
  setSetting,
  updateSyncJobItemStatus
} from "../db/database";
import { checkSession, openLogHarian, submitDailyLog, verifyLogExistsOnSkp } from "../automation/skpAutomation";
import { getSessionDir } from "../automation/skpSession";
import type { DailyLog, SubmitResult } from "../types";
import { clampEndToToday, isWeekend, nowIso, toDateKey } from "../utils/date";
import { revalidateDailyLog } from "../validation/dailyLogValidation";

type RunMode = "range" | "not_submitted" | "failed_only";
type RunJobResponse = {
  success: true;
  jobId: string;
  total: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
};

let timer: NodeJS.Timeout | null = null;
let paused = false;
const stopRequests = new Set<string>();
const activeTodayRuns = new Set<string>();
const activeSingleLogRuns = new Set<string>();
let autoCheckRunning = false;
export function startScheduler(): void {
  stopScheduler();
  timer = setInterval(() => {
    void maybeRunAuto();
  }, 60_000);
  void maybeRunAuto();
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export function pauseScheduler(): void {
  paused = true;
  addHistory("scheduler.paused", "Automation dijeda", "Antrean otomatis dihentikan sementara.", "warning");
}

export function resumeScheduler(): void {
  paused = false;
  addHistory("scheduler.resumed", "Automation dilanjutkan", "Antrean otomatis aktif kembali.", "info");
}

async function maybeRunAuto(): Promise<void> {
  if (autoCheckRunning || paused || getSetting("auto_run_enabled", "false") !== "true") return;
  if (getSetting("auto_run_today_enabled", "true") !== "true") return;

  autoCheckRunning = true;
  try {
    const dateKey = toDateKey();
    if (getSetting("weekend_is_holiday", "true") === "true" && isWeekend(dateKey)) return;

    const current = currentWibTime();
    const start = getSetting("auto_run_start_time", "08:00");
    const until = getSetting("retry_until_time", "16:00");
    if (current < start || current > until) return;

    const todayStatus = getTodayLogStatus();
    if (["no_log", "submitted", "queued", "running", "future", "needs_review"].includes(todayStatus.state)) {
      setSetting("auto_run_last_status", todayStatus.state === "no_log" ? "Belum ada log hari ini" : todayStatus.message);
      return;
    }
    if (todayStatus.state === "failed" && getSetting("auto_run_retry_failed_today", "true") !== "true") {
      setSetting("auto_run_last_status", "Log hari ini gagal, retry otomatis nonaktif");
      return;
    }
    if (!shouldAttemptAutoRunNow()) return;

    setSetting("auto_run_last_attempt_at", nowIso());
    const session = await checkSession();
    if (session !== "connected") {
      setSetting("auto_run_last_status", "Perlu login SKP");
      return;
    }

    const freshStatus = getTodayLogStatus("connected");
    if (!["not_submitted", "failed"].includes(freshStatus.state) || !freshStatus.canSubmit) return;

    const result = await runToday("auto_run");
    if (result.success > 0) {
      setSetting("auto_run_last_date", dateKey);
      setSetting("auto_run_last_status", "Berhasil");
      addHistory("scheduler.notification", "Log hari ini berhasil", "Auto run berhasil memproses Log Harian hari ini.", "success");
    } else if (result.failed > 0) {
      setSetting("auto_run_last_status", "Gagal mengirim log hari ini");
    } else {
      setSetting("auto_run_last_status", "Tidak ada log hari ini yang perlu dikirim");
    }
  } finally {
    autoCheckRunning = false;
  }
}

function shouldAttemptAutoRunNow(): boolean {
  const lastAttempt = getSetting("auto_run_last_attempt_at", "");
  if (!lastAttempt) return true;
  const last = new Date(lastAttempt);
  if (Number.isNaN(last.getTime())) return true;
  const intervalMinutes = Math.max(1, Number(getSetting("retry_interval_minutes", "10")) || 10);
  return Date.now() - last.getTime() >= intervalMinutes * 60_000;
}

function currentWibTime(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Jakarta"
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("hour")}:${part("minute")}`;
}

export async function runToday(jobType = "run_today"): Promise<{ total: number; success: number; failed: number; skipped: number }> {
  getSessionDir();
  const today = toDateKey();
  if (activeTodayRuns.has(today)) return { total: 0, success: 0, failed: 0, skipped: 1 };
  activeTodayRuns.add(today);
  try {
    const logs = listDailyLogs({ dateFrom: today, dateTo: today }).filter((log) => log.tanggal === today);
    return await runLogs(logs, jobType, today, today);
  } finally {
    activeTodayRuns.delete(today);
  }
}

export async function runMissed(): Promise<{ total: number; success: number; failed: number; skipped: number }> {
  getSessionDir();
  const today = toDateKey();
  const logs = listDailyLogs({ dateTo: today }).filter((log) => log.tanggal <= today && !["submitted", "manual_marked_submitted", "waiting_date"].includes(log.status_skp));
  return runLogs(logs, "run_missed", undefined, today);
}

export async function runRange(dateFrom: string, dateTo: string, mode: RunMode = "range"): Promise<RunJobResponse> {
  getSessionDir();
  const safeTo = clampEndToToday(dateTo);
  const logs = getRangeLogs(dateFrom, safeTo, mode).filter((log) => !hasActiveSyncForLog(log.id));
  const jobType = mode === "failed_only" ? "retry_failed" : mode === "not_submitted" ? "run_not_submitted" : "run_range";
  const jobId = createSyncJob(jobType, dateFrom, safeTo, logs.length);
  const items = logs.sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.kode_log.localeCompare(b.kode_log)).map((log) => ({
    itemId: addQueuedSyncJobItem(jobId, log),
    logId: log.id
  }));
  addHistory("sync.started", "Antrean dijalankan", `${logs.length} log masuk antrean ${jobType}.`, "info", "sync_job", jobId);
  void processQueuedLogs(jobId, items);
  return { success: true, jobId, total: logs.length, successCount: 0, failedCount: 0, skippedCount: 0 };
}

export function previewRange(dateFrom: string, dateTo: string, mode: RunMode = "range"): { success: true; total: number; dateFrom: string; dateTo: string; mode: RunMode } {
  const safeTo = clampEndToToday(dateTo);
  const logs = getRangeLogs(dateFrom, safeTo, mode).filter((log) => !hasActiveSyncForLog(log.id));
  return { success: true, total: logs.length, dateFrom, dateTo: safeTo, mode };
}

export async function retryFailed(): Promise<{ total: number; success: number; failed: number; skipped: number }> {
  getSessionDir();
  const today = toDateKey();
  const logs = listDailyLogs({ status: "failed", dateTo: today }).filter((log) => log.tanggal <= today);
  return runLogs(logs, "retry_failed", undefined, today);
}

export function getRunJob(jobId: string): Record<string, unknown> | undefined {
  return getSyncJobProgress(jobId);
}

export function stopRunJob(jobId: string): { success: true; jobId: string } {
  stopRequests.add(jobId);
  addHistory("sync.stop_requested", "Stop proses diminta", "Batch akan berhenti setelah item yang sedang berjalan selesai.", "warning", "sync_job", jobId);
  return { success: true, jobId };
}

export async function runLogById(id: string): Promise<{ total: number; success: number; failed: number; skipped: number }> {
  getSessionDir();
  const log = getDailyLog(id);
  if (!log) return { total: 0, success: 0, failed: 0, skipped: 1 };
  if (activeSingleLogRuns.has(id) || hasActiveSyncForLog(id)) {
    return { total: 1, success: 0, failed: 0, skipped: 1 };
  }
  activeSingleLogRuns.add(id);
  try {
    return await runLogs([log], "run_single", log.tanggal, log.tanggal);
  } finally {
    activeSingleLogRuns.delete(id);
  }
}

export async function reconcileLogStatusWithSkp(id: string): Promise<{
  success: boolean;
  foundOnSkp: boolean;
  message: string;
  log: DailyLog | null;
}> {
  getSessionDir();
  const log = getDailyLog(id);
  if (!log) {
    return { success: false, foundOnSkp: false, message: "Log tidak ditemukan.", log: null };
  }
  if (hasActiveSyncForLog(id) || activeSingleLogRuns.has(id)) {
    return {
      success: false,
      foundOnSkp: false,
      message: "Log sedang diverifikasi atau dikirim. Tunggu proses berjalan selesai.",
      log
    };
  }

  const jobId = createSyncJob("reconcile_skp", log.tanggal, log.tanggal, 1);
  const itemId = addQueuedSyncJobItem(jobId, log);
  updateSyncJobItemStatus(itemId, "running");
  activeSingleLogRuns.add(id);

  try {
    const verification = await verifyLogExistsOnSkp(log);
    if (verification.foundOnSkp) {
      updateDailyLogStatus(log.id, "valid", "submitted");
      updateSyncJobItemStatus(itemId, "success", "Data ditemukan di SKP dan status lokal diperbarui.");
      finishSyncJob(jobId, "finished", { total: 1, success: 1, failed: 0, skipped: 0 });
      addHistory("log.reconciled_skp", "Status lokal disesuaikan dari SKP", `${log.kode_log} ditemukan di SKP.`, "success", "daily_log", log.id);
      return {
        success: true,
        foundOnSkp: true,
        message: "Data ditemukan di SKP dan status lokal diperbarui.",
        log: getDailyLog(id) ?? null
      };
    }

    updateSyncJobItemStatus(itemId, "failed", "Data belum ditemukan di SKP.", undefined, "NOT_FOUND_ON_SKP");
    finishSyncJob(jobId, "finished_with_error", { total: 1, success: 0, failed: 1, skipped: 0 });
    addHistory("log.reconcile_not_found", "Data belum ditemukan di SKP", `${log.kode_log} belum ditemukan di SKP.`, "warning", "daily_log", log.id);
    return {
      success: true,
      foundOnSkp: false,
      message: "Data belum ditemukan di SKP. Status lokal belum diubah.",
      log: getDailyLog(id) ?? log
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cek status ke SKP gagal.";
    updateSyncJobItemStatus(itemId, "failed", message, undefined, "RECONCILE_FAILED");
    finishSyncJob(jobId, "finished_with_error", { total: 1, success: 0, failed: 1, skipped: 0 });
    addHistory("log.reconcile_failed", "Cek status SKP gagal", message, "error", "daily_log", log.id);
    return { success: false, foundOnSkp: false, message, log: getDailyLog(id) ?? log };
  } finally {
    activeSingleLogRuns.delete(id);
  }
}

async function runLogs(
  logs: ReturnType<typeof listDailyLogs>,
  jobType: string,
  dateFrom?: string,
  dateTo?: string
): Promise<{ total: number; success: number; failed: number; skipped: number }> {
  const sortedLogs = logs.sort((a, b) => a.tanggal.localeCompare(b.tanggal));
  const jobId = createSyncJob(jobType, dateFrom, dateTo, sortedLogs.length);
  const counts = { total: logs.length, success: 0, failed: 0, skipped: 0 };
  addHistory("sync.started", "Antrean dijalankan", `${logs.length} log masuk antrean ${jobType}.`, "info", "sync_job", jobId);

  for (const log of sortedLogs) {
    const latest = getDailyLog(log.id);
    if (!latest) {
      counts.skipped += 1;
      continue;
    }
    if (hasActiveSyncForLog(latest.id)) {
      counts.skipped += 1;
      addSyncJobItem(jobId, latest, "skipped", "Log dilewati karena sedang antre atau sedang dikirim.");
      continue;
    }

    const itemId = addQueuedSyncJobItem(jobId, latest);
    updateSyncJobItemStatus(itemId, "running");
    refreshSyncJobCounts(jobId);

    if (latest.tanggal > toDateKey() || ["submitted", "manual_marked_submitted"].includes(latest.status_skp)) {
      counts.skipped += 1;
      updateSyncJobItemStatus(itemId, "skipped", "Log dilewati karena tanggal masa depan atau sudah terkirim.");
      continue;
    }
    if (["holiday", "leave", "no_plan", "skipped"].includes(latest.status_local)) {
      counts.skipped += 1;
      updateSyncJobItemStatus(itemId, "skipped", "Log dilewati sesuai status lokal.");
      continue;
    }
    const validation = await revalidateDailyLog(latest, { checkSiteMapping: false });
    if (!validation.ok || !validation.log) {
      counts.skipped += 1;
      updateSyncJobItemStatus(itemId, "skipped", validation.reason_note ?? "Log perlu review.", undefined, "LOCAL_VALIDATION_ERROR");
      continue;
    }

    const runnableLog = validation.log;
    const existing = await reconcileBeforeSubmit(runnableLog);
    if (existing.found) {
      counts.success += 1;
      updateSyncJobItemStatus(itemId, "success", existing.message);
      refreshSyncJobCounts(jobId);
      continue;
    }

    const result = await submitDailyLog(runnableLog);
    if (result.ok && result.status === "submitted") {
      counts.success += 1;
      updateDailyLogStatus(runnableLog.id, "valid", "submitted");
      updateSyncJobItemStatus(itemId, "success");
    } else if (result.ok) {
      counts.skipped += 1;
      updateDailyLogStatus(runnableLog.id, "valid", runnableLog.status_skp, result.message);
      updateSyncJobItemStatus(itemId, "skipped", result.message);
    } else {
      const afterFailure = await reconcileAfterFailedSubmit(runnableLog, result);
      if (afterFailure.found) {
        counts.success += 1;
        updateSyncJobItemStatus(itemId, "success", afterFailure.message);
        refreshSyncJobCounts(jobId);
        continue;
      }
      counts.failed += 1;
      const errorCode = result.errorCode ?? "UNKNOWN_ERROR";
      const nextLocalStatus =
        errorCode === "LOCAL_VALIDATION_ERROR" || (errorCode === "SKP_OPTION_NOT_FOUND" && (result.availableSkpOptions?.length ?? 0) > 0)
          ? "needs_review"
          : "valid";
      updateDailyLogStatus(runnableLog.id, nextLocalStatus, result.status === "not_allowed_by_site" ? "not_allowed_by_site" : "failed", result.message, errorCode, {
        automationStep: result.step ?? null,
        screenshotPath: result.screenshotPath ?? null,
        currentUrl: result.currentUrl ?? null
      });
      updateSyncJobItemStatus(itemId, "failed", result.message, result.screenshotPath, errorCode);
    }
    refreshSyncJobCounts(jobId);
  }

  finishSyncJob(jobId, counts.failed > 0 ? "finished_with_error" : "finished", counts);
  addHistory(
    "sync.finished",
    "Antrean selesai",
    `${counts.success} berhasil, ${counts.failed} gagal, ${counts.skipped} dilewati.`,
    counts.failed > 0 ? "warning" : "success",
    "sync_job",
    jobId
  );
  return counts;
}

async function processQueuedLogs(jobId: string, items: Array<{ itemId: string; logId: string }>): Promise<void> {
  const counts = { total: items.length, success: 0, failed: 0, skipped: 0 };
  for (const item of items) {
    if (stopRequests.has(jobId)) {
      updateSyncJobItemStatus(item.itemId, "skipped", "Proses dihentikan pengguna.");
      counts.skipped += 1;
      refreshSyncJobCounts(jobId);
      continue;
    }
    updateSyncJobItemStatus(item.itemId, "running");
    refreshSyncJobCounts(jobId);
    const result = await submitOneLog(item.logId);
    counts[result.count] += 1;
    updateSyncJobItemStatus(item.itemId, result.status, result.message, result.screenshotPath, result.errorCode);
    refreshSyncJobCounts(jobId);
  }

  const stopped = stopRequests.delete(jobId);
  const finalStatus = stopped ? "stopped" : counts.failed > 0 ? "finished_with_error" : "finished";
  finishSyncJob(jobId, finalStatus, counts);
  addHistory(
    "sync.finished",
    stopped ? "Antrean dihentikan" : "Antrean selesai",
    `${counts.success} berhasil, ${counts.failed} gagal, ${counts.skipped} dilewati.`,
    counts.failed > 0 || stopped ? "warning" : "success",
    "sync_job",
    jobId
  );
}

async function submitOneLog(logId: string): Promise<{
  status: "success" | "failed" | "skipped";
  count: "success" | "failed" | "skipped";
  message?: string;
  screenshotPath?: string;
  errorCode?: string;
}> {
  const latest = getDailyLog(logId);
  if (!latest) return { status: "skipped", count: "skipped", message: "Log tidak ditemukan." };
  if (latest.tanggal > toDateKey()) return { status: "skipped", count: "skipped", message: "Tanggal masa depan tidak diproses." };
  if (["submitted", "manual_marked_submitted"].includes(latest.status_skp)) return { status: "skipped", count: "skipped", message: "Log sudah terkirim." };
  if (["holiday", "leave", "no_plan", "skipped"].includes(latest.status_local)) return { status: "skipped", count: "skipped", message: "Log dilewati sesuai status lokal." };

  const validation = await revalidateDailyLog(latest, { checkSiteMapping: false });
  if (!validation.ok || !validation.log) {
    return { status: "skipped", count: "skipped", message: validation.reason_note ?? "Log perlu review.", errorCode: "LOCAL_VALIDATION_ERROR" };
  }

  const runnableLog = validation.log;
  const existing = await reconcileBeforeSubmit(runnableLog);
  if (existing.found) {
    return { status: "success", count: "success", message: existing.message };
  }

  const result = await submitDailyLog(runnableLog);
  if (result.ok && result.status === "submitted") {
    updateDailyLogStatus(runnableLog.id, "valid", "submitted");
    return { status: "success", count: "success" };
  }
  if (result.ok) {
    updateDailyLogStatus(runnableLog.id, "valid", runnableLog.status_skp, result.message);
    return { status: "skipped", count: "skipped", message: result.message };
  }

  const afterFailure = await reconcileAfterFailedSubmit(runnableLog, result);
  if (afterFailure.found) {
    return { status: "success", count: "success", message: afterFailure.message };
  }

  const errorCode = result.errorCode ?? "UNKNOWN_ERROR";
  const nextLocalStatus =
    errorCode === "LOCAL_VALIDATION_ERROR" || (errorCode === "SKP_OPTION_NOT_FOUND" && (result.availableSkpOptions?.length ?? 0) > 0)
      ? "needs_review"
      : "valid";
  updateDailyLogStatus(runnableLog.id, nextLocalStatus, result.status === "not_allowed_by_site" ? "not_allowed_by_site" : "failed", result.message, errorCode, {
    automationStep: result.step ?? null,
    screenshotPath: result.screenshotPath ?? null,
    currentUrl: result.currentUrl ?? null
  });
  return { status: "failed", count: "failed", message: result.message, screenshotPath: result.screenshotPath, errorCode };
}

async function reconcileBeforeSubmit(log: DailyLog): Promise<{ found: boolean; message?: string }> {
  try {
    const verification = await verifyLogExistsOnSkp(log);
    if (!verification.foundOnSkp) return { found: false };
    updateDailyLogStatus(log.id, "valid", "submitted");
    const message = "Data sudah ada di SKP. Status lokal disesuaikan.";
    addHistory("log.found_before_submit", "Submit ulang dicegah", `${log.kode_log} sudah ada di SKP.`, "success", "daily_log", log.id);
    return { found: true, message };
  } catch {
    return { found: false };
  }
}

async function reconcileAfterFailedSubmit(log: DailyLog, result: SubmitResult): Promise<{ found: boolean; message?: string }> {
  if (!shouldVerifyAfterFailedSubmit(result)) return { found: false };
  try {
    const verification = await verifyLogExistsOnSkp(log);
    if (!verification.foundOnSkp) return { found: false };
    updateDailyLogStatus(log.id, "valid", "submitted");
    const message = "Data ditemukan di SKP setelah pengecekan ulang. Status lokal diperbarui.";
    addHistory("log.found_after_failed_submit", "Status gagal dikoreksi dari SKP", `${log.kode_log} ditemukan di SKP setelah submit.`, "success", "daily_log", log.id);
    return { found: true, message };
  } catch {
    return { found: false };
  }
}

function shouldVerifyAfterFailedSubmit(result: SubmitResult): boolean {
  const step = String(result.step ?? "");
  const errorCode = String(result.errorCode ?? "");
  const message = String(result.message ?? "");
  return (
    ["click_simpan", "detect_result", "verify_after_save"].includes(step) ||
    ["LOG_SAVE_FAILED", "UNKNOWN_ERROR"].includes(errorCode) ||
    /timeout|timed out|waktu habis/i.test(message)
  );
}

function filterLogsForMode(logs: ReturnType<typeof listDailyLogs>, mode: RunMode): ReturnType<typeof listDailyLogs> {
  const today = toDateKey();
  const validStatuses = new Set(["ready", "not_submitted", "failed", "waiting_date"]);
  return logs.filter((log) => {
    if (log.tanggal > today) return false;
    if (mode === "failed_only") return log.status_skp === "failed";
    if (mode === "not_submitted") return validStatuses.has(log.status_skp);
    return !["submitted", "manual_marked_submitted"].includes(log.status_skp);
  });
}

function getRangeLogs(dateFrom: string, dateTo: string, mode: RunMode): ReturnType<typeof listDailyLogs> {
  return filterLogsForMode(
    listDailyLogs({ dateFrom, dateTo }).filter((log) => log.tanggal <= dateTo),
    mode
  );
}

export async function openSkpLogPage(): Promise<void> {
  await openLogHarian(false);
}
