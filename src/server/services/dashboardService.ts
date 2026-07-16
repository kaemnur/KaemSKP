import type { SupabaseClient } from "@supabase/supabase-js";
import { getNextAutoPostAt } from "../../main/scheduler/nextAutoPost";
import type { MonthlySuccessData, TodayLogState, TodayLogStatus } from "../../main/types";
import { formatLongDate, getDayName, toDateKey } from "../../main/utils/date";
import { getPublicSkpAuthStatus } from "./skpSecureStore";

const MONTH_LABELS_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const SUCCESSFUL_SKP_STATUSES = ["submitted", "manual_marked_submitted", "success", "sent", "terkirim", "manual_submitted"];
const AUTO_POST_JOB_TYPE = "auto_post_daily_log";

type Row = Record<string, any>;

export async function getSupabaseDashboardData(supabase: SupabaseClient, userId: string): Promise<Record<string, unknown>> {
  const today = toDateKey();
  const month = today.slice(0, 7);
  const [plan, logs, auditLogs, settings, latestJob, session, holidays] = await Promise.all([
    activePlan(supabase, userId),
    listRows(supabase, "daily_logs", userId, "id,tanggal,status_local,status_skp,last_error,reason_note,kode_log,nama_aktivitas,kode_skp,nama_skp,created_at,updated_at"),
    listRecentAuditLogs(supabase, userId, 6),
    readAutoPostSettings(supabase, userId),
    latestSchedulerJob(supabase, userId),
    getPublicSkpAuthStatus(supabase, userId),
    listHolidays(supabase, userId)
  ]);

  const skpPlanCount = await countRows(supabase, "skp_plans", userId);
  const skpPlanItemCount = await countRows(supabase, "skp_plan_items", userId);
  const total = logs.length;
  const submitted = logs.filter((log) => isSuccessful(log.status_skp)).length;
  const failed = logs.filter((log) => isFailedOrReview(log)).length;
  const waiting = Math.max(0, total - submitted - failed);
  const missed = logs.filter((log) => log.tanggal <= today && !isSuccessful(log.status_skp)).length;
  const review = logs.filter((log) => isFailedOrReview(log)).length;
  const autoPost = buildAutoPost(settings, latestJob, session.status, holidays);

  return {
    sessionStatus: session.status,
    activeYear: Number(plan?.year ?? today.slice(0, 4)),
    periodLabel: plan ? `${plan.start_date ?? "-"} - ${plan.end_date ?? "-"}` : "-",
    localManagedStartDate: plan?.start_date ?? null,
    counts: {
      skpPlans: skpPlanCount,
      skpPlanItems: skpPlanItemCount,
      dailyLogs: total,
      today: logs.filter((log) => log.tanggal === today).length,
      unfilled: missed,
      missed,
      submitted,
      submittedThisMonth: logs.filter((log) => String(log.tanggal).startsWith(month) && isSuccessful(log.status_skp)).length,
      failed: logs.filter((log) => String(log.status_skp).toLowerCase() === "failed").length,
      waiting: logs.filter((log) => String(log.status_skp).toLowerCase() === "waiting_date").length,
      offDays: 0,
      review,
      syncTotal: total,
      syncSubmitted: submitted,
      syncWaiting: waiting,
      syncFailed: failed,
      attention: review
    },
    today: buildTodaySummary(logs, today),
    problems: logs
      .filter((log) => log.tanggal <= today && !isSuccessful(log.status_skp) && (isFailedOrReview(log) || String(log.status_skp).toLowerCase() !== "waiting_date"))
      .sort((left, right) => String(right.tanggal).localeCompare(String(left.tanggal)))
      .slice(0, 8)
      .map((log) => ({
        tanggal: log.tanggal,
        status: isFailedOrReview(log) ? "needs_review" : "not_submitted",
        alasan: log.last_error || log.reason_note || "Log belum terkirim ke SKP.",
        aksi: isFailedOrReview(log) ? "Review" : "Buat/Edit"
      })),
    autoPost,
    recentHistory: auditLogs
  };
}

export async function getSupabaseMonthlySuccessData(supabase: SupabaseClient, userId: string, yearInput = 2026): Promise<MonthlySuccessData> {
  const year = Number.isFinite(yearInput) ? Math.trunc(yearInput) : 2026;
  const { data, error } = await supabase
    .from("daily_logs")
    .select("tanggal,status_skp")
    .eq("user_id", userId)
    .gte("tanggal", `${year}-01-01`)
    .lte("tanggal", `${year}-12-31`);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Row[];
  const months = MONTH_LABELS_ID.map((label, index) => {
    const month = index + 1;
    const monthKey = `${year}-${String(month).padStart(2, "0")}`;
    const monthRows = rows.filter((row) => String(row.tanggal).startsWith(monthKey));
    const successCount = monthRows.filter((row) => isSuccessful(row.status_skp)).length;
    const totalCount = monthRows.length;
    return {
      month,
      label,
      successCount,
      totalCount,
      successRate: totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 0
    };
  });
  const totalSuccess = months.reduce((total, item) => total + item.successCount, 0);
  const bestMonth = totalSuccess > 0 ? months.reduce((best, item) => (item.successCount > best.successCount ? item : best), months[0]) : null;

  return {
    success: true,
    year,
    months,
    summary: {
      totalSuccess,
      bestMonth,
      averagePerMonth: Math.round((totalSuccess / 12) * 10) / 10
    }
  };
}

export async function getSupabaseTodayLogStatus(supabase: SupabaseClient, userId: string): Promise<TodayLogStatus> {
  const today = toDateKey();
  const [logs, session, activeQueue] = await Promise.all([
    listTodayLogs(supabase, userId, today),
    getPublicSkpAuthStatus(supabase, userId),
    activeTodayJob(supabase, userId, today)
  ]);
  const state = resolveTodayLogState(logs, activeQueue);
  const selected = selectTodayLog(logs, state);
  const requiresLogin = ["not_submitted", "failed"].includes(state) && session.status !== "connected";

  return {
    success: true,
    date: today,
    displayDate: `${capitalize(getDayName(today))}, ${formatLongDate(today)}`,
    hasLog: logs.length > 0,
    logCount: logs.length,
    state,
    sessionStatus: session.status,
    requiresLogin,
    canSubmit: ["not_submitted", "failed"].includes(state) && !requiresLogin,
    message: todayLogMessage(state, selected, requiresLogin),
    activeQueue,
    log: selected ? toTodayLogPayload(selected) : null
  };
}

async function countRows(supabase: SupabaseClient, table: string, userId: string, refine?: (query: any) => any): Promise<number> {
  let query = supabase.from(table).select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (refine) query = refine(query);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return Number(count ?? 0);
}

async function listRows(supabase: SupabaseClient, table: string, userId: string, columns = "*"): Promise<Row[]> {
  const { data, error } = await supabase.from(table).select(columns).eq("user_id", userId);
  if (error) throw new Error(error.message);
  return (data ?? []) as Row[];
}

async function activePlan(supabase: SupabaseClient, userId: string): Promise<Row | null> {
  const { data, error } = await supabase
    .from("skp_plans")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("imported_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Row | null) ?? null;
}

async function listRecentAuditLogs(supabase: SupabaseClient, userId: string, limit: number): Promise<Row[]> {
  const { data, error } = await supabase.from("audit_logs").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as Row[];
}

async function readAutoPostSettings(supabase: SupabaseClient, userId: string): Promise<Row | null> {
  const { data, error } = await supabase.from("auto_post_settings").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Row | null) ?? null;
}

async function latestSchedulerJob(supabase: SupabaseClient, userId: string): Promise<Row | null> {
  const { data, error } = await supabase
    .from("scheduler_jobs")
    .select("*")
    .eq("user_id", userId)
    .eq("job_type", AUTO_POST_JOB_TYPE)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Row | null) ?? null;
}

async function listHolidays(supabase: SupabaseClient, userId: string): Promise<Array<{ date: string; isActive: boolean }>> {
  const { data, error } = await supabase.from("holidays").select("holiday_date,is_active").eq("user_id", userId).eq("is_active", true);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map((row) => ({ date: String(row.holiday_date).slice(0, 10), isActive: Boolean(row.is_active) }));
}

async function listTodayLogs(supabase: SupabaseClient, userId: string, today: string): Promise<Row[]> {
  const { data, error } = await supabase.from("daily_logs").select("*").eq("user_id", userId).eq("tanggal", today).order("kode_log", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Row[];
}

async function activeTodayJob(supabase: SupabaseClient, userId: string, today: string): Promise<TodayLogStatus["activeQueue"]> {
  const { data, error } = await supabase
    .from("scheduler_jobs")
    .select("id,status,started_at,finished_at,daily_log_id")
    .eq("user_id", userId)
    .eq("job_type", AUTO_POST_JOB_TYPE)
    .eq("scheduled_date", today)
    .in("status", ["pending", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id,
    jobId: data.id,
    status: data.status === "pending" ? "queued" : data.status,
    startedAt: data.started_at ?? null,
    finishedAt: data.finished_at ?? null
  };
}

function buildAutoPost(settings: Row | null, latestJob: Row | null, sessionStatus: string, holidays: Array<{ date: string; isActive: boolean }>): Record<string, unknown> {
  if (!settings) {
    return {
      nextAutoPostAt: null,
      targetDate: null,
      dayName: null,
      timeLabel: "Belum dikonfigurasi",
      timezone: "Asia/Jakarta",
      enabled: false,
      workerStatus: "Perlu konfigurasi",
      sessionStatus,
      lastJobStatus: latestJob?.status ?? "",
      lastJobAt: latestJob?.finished_at ?? latestJob?.started_at ?? ""
    };
  }

  const next = getNextAutoPostAt(
    new Date(),
    {
      enabled: Boolean(settings.enabled),
      postTime: normalizePostTime(settings.post_time),
      timezone: settings.timezone || "Asia/Jakarta",
      activeWeekdays: Array.isArray(settings.active_weekdays) ? settings.active_weekdays : [1, 2, 3, 4, 5]
    },
    holidays
  );

  return {
    ...next,
    timezone: settings.timezone || "Asia/Jakarta",
    enabled: Boolean(settings.enabled),
    workerStatus: publicWorkerStatus(settings, latestJob),
    sessionStatus,
    lastJobStatus: settings.last_job_status ?? latestJob?.status ?? "",
    lastJobAt: settings.last_job_at ?? latestJob?.finished_at ?? latestJob?.started_at ?? ""
  };
}

function buildTodaySummary(logs: Row[], today: string): Record<string, unknown> {
  const first = logs[0] ?? null;
  return {
    date: today,
    dayName: getDayName(today),
    status: first?.status_skp ?? "missing",
    log: first,
    reason: first?.reason_note ?? null
  };
}

function publicWorkerStatus(settings: Row, latestJob: Row | null): string {
  if (!settings.enabled) return "Nonaktif";
  if (["failed", "login_failed", "verification_failed"].includes(String(settings.last_job_status ?? latestJob?.status ?? ""))) return "Gagal";
  if (String(settings.worker_status ?? "") === "running" || String(latestJob?.status ?? "") === "running") return "Sedang memproses";
  if (process.env.WORKER_DRY_RUN !== "false") return "Dry-run aktif";
  if (!settings.next_auto_post_at) return "Perlu konfigurasi";
  return "Aktif - menunggu jadwal";
}

function resolveTodayLogState(logs: Row[], activeQueue: TodayLogStatus["activeQueue"]): TodayLogState {
  if (logs.length === 0) return "no_log";
  if (activeQueue?.status === "running") return "running";
  if (activeQueue?.status === "queued" || activeQueue?.status === "pending") return "queued";
  if (logs.some((log) => String(log.tanggal) > toDateKey())) return "future";
  if (logs.some((log) => ["failed", "not_allowed_by_site"].includes(String(log.status_skp)))) return "failed";
  if (logs.some((log) => !isSuccessful(log.status_skp) && isFailedOrReview(log))) return "needs_review";
  if (logs.some((log) => !isSuccessful(log.status_skp))) return "not_submitted";
  return "submitted";
}

function selectTodayLog(logs: Row[], state: TodayLogState): Row | null {
  if (logs.length === 0) return null;
  if (state === "failed") return logs.find((log) => ["failed", "not_allowed_by_site"].includes(String(log.status_skp))) ?? logs[0];
  if (state === "needs_review") return logs.find((log) => isFailedOrReview(log)) ?? logs[0];
  if (state === "not_submitted") return logs.find((log) => !isSuccessful(log.status_skp)) ?? logs[0];
  return logs[0];
}

function toTodayLogPayload(log: Row): TodayLogStatus["log"] {
  return {
    id: log.id,
    tanggal: String(log.tanggal),
    namaAktivitas: log.nama_aktivitas ?? null,
    deskripsi: log.deskripsi ?? null,
    kodeSkp: log.kode_skp ?? null,
    namaSkp: log.nama_skp ?? null,
    statusLocal: log.status_local,
    statusSkp: log.status_skp,
    lastSyncAt: log.last_sync_at ?? null,
    lastError: log.last_error ?? null,
    lastErrorCode: log.last_error_code ?? null,
    currentUrl: log.current_url ?? null,
    automationStep: log.automation_step ?? null,
    screenshotPath: log.screenshot_path ?? null
  };
}

function todayLogMessage(state: TodayLogState, log: Row | null, requiresLogin: boolean): string {
  if (requiresLogin) return "Login SKP diperlukan sebelum log hari ini bisa dikirim.";
  if (state === "no_log") return "Belum ada data log untuk tanggal hari ini.";
  if (state === "queued") return "Log hari ini sedang menunggu proses kirim.";
  if (state === "running") return "Sistem sedang mengirim log hari ini ke SKP.";
  if (state === "submitted") return "Log hari ini sudah masuk SKP.";
  if (state === "failed") return log?.last_error || "Log hari ini gagal dikirim.";
  if (state === "future") return "Log hari ini belum masuk waktu pengiriman.";
  if (state === "needs_review") return log?.reason_note || "Log hari ini perlu dicek sebelum dikirim.";
  return "Log hari ini sudah tersedia dan belum masuk SKP.";
}

function isSuccessful(status?: string | null): boolean {
  return SUCCESSFUL_SKP_STATUSES.includes(String(status ?? "").toLowerCase());
}

function isFailedOrReview(log: Row): boolean {
  const skp = String(log.status_skp ?? "").toLowerCase();
  const local = String(log.status_local ?? "").toLowerCase();
  return skp === "failed" || skp === "not_allowed_by_site" || local === "invalid" || local === "needs_review";
}

function normalizePostTime(value?: string | null): string {
  const match = String(value || "08:00").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return "08:00";
  return `${String(Math.min(23, Math.max(0, Number(match[1]) || 0))).padStart(2, "0")}:${String(Math.min(59, Math.max(0, Number(match[2]) || 0))).padStart(2, "0")}`;
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}
