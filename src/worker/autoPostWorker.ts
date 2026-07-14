import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPrivilegedSupabaseClient } from "../main/supabase/config";
import { getNextAutoPostAt } from "../main/scheduler/nextAutoPost";
import type { DailyLog } from "../main/types";
import { closeAutomation, submitDailyLog, verifyLogExistsOnSkp } from "../main/automation/skpAutomation";
import { getAuthStatePath, setRuntimeSkpCredentials } from "../main/automation/skpSession";
import { checkSession, openLogin } from "../server/services/skpAuthService";
import {
  getSkpSessionStatus as getEncryptedSkpSessionStatus,
  readCredentialsForBackend,
  saveSkpSession
} from "../server/services/skpSecureStore";

loadEnv({ path: join(process.cwd(), ".env.local"), override: false, quiet: true });

export const WORKER_TIMEZONE = "Asia/Jakarta";
export const AUTO_POST_JOB_TYPE = "auto_post_daily_log";
export const DEFAULT_POST_TIME = "08:00";
export const DEFAULT_ACTIVE_WEEKDAYS = [1, 2, 3, 4, 5];

export type SchedulerJobStatus =
  | "pending"
  | "running"
  | "success"
  | "already_submitted"
  | "skipped_weekend"
  | "skipped_holiday"
  | "no_log"
  | "login_failed"
  | "verification_failed"
  | "failed";

export type AutoPostSettingsRow = {
  id: string;
  user_id: string;
  enabled: boolean;
  post_time: string | null;
  timezone: string | null;
  active_weekdays: number[] | null;
  skip_holidays: boolean | null;
  only_if_not_submitted: boolean | null;
  next_auto_post_at: string | null;
  worker_status: string | null;
  last_job_status: string | null;
  last_job_at: string | null;
};

export type HolidayRow = {
  id: string;
  user_id: string;
  holiday_date: string;
  name: string;
  is_joint_leave: boolean;
  source: string | null;
  is_active: boolean;
};

export type SchedulerJobRow = {
  id: string;
  user_id: string;
  job_type: string;
  scheduled_date: string;
  scheduled_at: string;
  status: SchedulerJobStatus;
  locked_at: string | null;
  locked_by: string | null;
  started_at: string | null;
  finished_at: string | null;
  attempt_count: number;
  daily_log_id: string | null;
  result_message: string | null;
  error_code: string | null;
  error_message: string | null;
  next_auto_post_at: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkerTickResult = {
  ok: boolean;
  dryRun: boolean;
  userId: string;
  workerId: string;
  nowWib: string;
  targetDate: string | null;
  nextAutoPostAt: string | null;
  status: SchedulerJobStatus | "disabled" | "not_due" | "duplicate" | "unsupported_backend";
  jobId: string | null;
  dailyLogCount: number;
  message: string;
  safeChecks?: Record<string, unknown>;
};

export type WorkerRunOptions = {
  userId?: string;
  targetDate?: string;
  dryRun?: boolean;
  now?: Date;
};

type DailyLogRow = Record<string, any>;

type SubmissionRow = {
  id: string;
  status: string;
  daily_log_id: string | null;
  scheduler_job_id: string | null;
};

type TargetState = {
  date: string;
  scheduledAt: string;
  due: boolean;
  skipStatus: "skipped_weekend" | "skipped_holiday" | null;
  skipMessage: string | null;
};

export class AutoPostWorkerService {
  private readonly supabase: SupabaseClient;
  readonly workerId: string;

  constructor(options: { supabase?: SupabaseClient; workerId?: string } = {}) {
    const client = options.supabase ?? createPrivilegedSupabaseClient();
    if (!client) throw new Error("Konfigurasi Supabase privileged belum lengkap.");
    this.supabase = client;
    this.workerId = options.workerId ?? `${hostname()}-${process.pid}-${randomUUID()}`;
  }

  async tick(options: WorkerRunOptions = {}): Promise<WorkerTickResult[]> {
    if (process.env.DATA_BACKEND !== "supabase") {
      return [
        {
          ok: false,
          dryRun: this.resolveDryRun(options.dryRun),
          userId: options.userId ?? "unknown",
          workerId: this.workerId,
          nowWib: formatWibDateTime(options.now ?? new Date()),
          targetDate: options.targetDate ?? null,
          nextAutoPostAt: null,
          status: "unsupported_backend",
          jobId: null,
          dailyLogCount: 0,
          message: "Worker Auto Post hanya aktif untuk DATA_BACKEND=supabase."
        }
      ];
    }

    const rows = options.userId ? [await this.ensureSettings(options.userId)] : await this.listRunnableSettings();
    const results: WorkerTickResult[] = [];
    for (const settings of rows) {
      results.push(await this.processUser(settings, options));
    }
    return results;
  }

  async getStatus(userId: string): Promise<Record<string, unknown>> {
    const settings = await this.ensureSettings(userId);
    const [latestJob, pendingCount, holidayCount, logCount] = await Promise.all([
      this.latestJob(userId),
      this.count("scheduler_jobs", userId, (query) => query.eq("job_type", AUTO_POST_JOB_TYPE).in("status", ["pending", "running"])),
      this.count("holidays", userId, (query) => query.eq("is_active", true)),
      this.count("daily_logs", userId)
    ]);
    return {
      ok: true,
      backend: "supabase",
      fallbackUsed: false,
      timezone: settings.timezone || WORKER_TIMEZONE,
      enabled: settings.enabled,
      workerStatus: settings.worker_status,
      nextAutoPostAt: settings.next_auto_post_at,
      lastJobStatus: settings.last_job_status,
      lastJobAt: settings.last_job_at,
      pendingOrRunningJobs: pendingCount,
      activeHolidayCount: holidayCount,
      dailyLogCount: logCount,
      latestJob: sanitizeJob(latestJob)
    };
  }

  async getNextRun(userId: string, now = new Date()): Promise<Record<string, unknown>> {
    const settings = await this.ensureSettings(userId);
    const holidays = await this.listHolidays(userId);
    const next = computeNextRun(now, settings, holidays);
    return {
      ok: true,
      backend: "supabase",
      fallbackUsed: false,
      ...next
    };
  }

  private async processUser(settings: AutoPostSettingsRow, options: WorkerRunOptions): Promise<WorkerTickResult> {
    const dryRun = this.resolveDryRun(options.dryRun);
    const now = options.now ?? new Date();
    const holidays = await this.listHolidays(settings.user_id);
    const next = computeNextRun(now, settings, holidays);
    await this.updateSettingsTick(settings.user_id, "tick", next.nextAutoPostAt);

    const nowWib = formatWibDateTime(now);
    if (!settings.enabled) {
      return baseResult(settings.user_id, this.workerId, dryRun, nowWib, null, next.nextAutoPostAt, "disabled", null, 0, "Auto Post nonaktif.");
    }

    const target = options.targetDate
      ? targetStateForDate(options.targetDate, settings, holidays, true, now)
      : dueTargetForNow(now, settings, holidays);
    if (!target) {
      return baseResult(settings.user_id, this.workerId, dryRun, nowWib, null, next.nextAutoPostAt, "not_due", null, 0, "Belum waktunya Auto Post.");
    }
    if (target.date > wibDateKey(now)) {
      return baseResult(settings.user_id, this.workerId, dryRun, nowWib, target.date, next.nextAutoPostAt, "not_due", null, 0, "Tanggal masa depan tidak diproses.");
    }

    const job = await this.createJobIfMissing(settings.user_id, target.date, target.scheduledAt, next.nextAutoPostAt);
    const logs = target.skipStatus ? [] : await this.listLogsForDate(settings.user_id, target.date);

    if (dryRun) {
      const safeChecks = await this.safeDryRunChecks(settings.user_id, logs);
      return baseResult(
        settings.user_id,
        this.workerId,
        true,
        nowWib,
        target.date,
        next.nextAutoPostAt,
        target.skipStatus ?? "pending",
        job.id,
        logs.length,
        target.skipMessage ?? "Dry-run selesai: job dibuat/ditemukan tanpa klik Simpan/Kirim.",
        safeChecks
      );
    }

    const claimed = await this.claimJob(settings.user_id, target.date);
    if (!claimed) {
      return baseResult(settings.user_id, this.workerId, false, nowWib, target.date, next.nextAutoPostAt, "duplicate", job.id, logs.length, "Job sudah dikunci worker lain.");
    }

    try {
      if (target.skipStatus) {
        return await this.finishAndResult(claimed, target.skipStatus, target.skipMessage ?? "Tanggal dilewati.", logs.length, nowWib, next.nextAutoPostAt);
      }
      if (logs.length === 0) {
        return await this.finishAndResult(claimed, "no_log", "Tidak ada Log Harian untuk tanggal target.", 0, nowWib, next.nextAutoPostAt);
      }

      const existingSubmission = await this.findSuccessfulSubmission(settings.user_id, logs.map((log) => log.id));
      if (existingSubmission) {
        return await this.finishAndResult(claimed, "already_submitted", "Daily log submissions sudah mencatat sukses.", logs.length, nowWib, next.nextAutoPostAt);
      }

      const sessionReady = await this.ensureSkpSession(settings.user_id);
      if (!sessionReady.ok) {
        return await this.finishAndResult(claimed, "login_failed", sessionReady.message, logs.length, nowWib, next.nextAutoPostAt, sessionReady.errorCode);
      }

      const result = await this.submitLogs(claimed, logs, next.nextAutoPostAt);
      return baseResult(settings.user_id, this.workerId, false, nowWib, target.date, next.nextAutoPostAt, result.status, claimed.id, logs.length, result.message);
    } catch (error) {
      const message = publicErrorMessage(error);
      await this.finishJob(claimed.id, "failed", "WORKER_FAILED", message, next.nextAutoPostAt);
      return baseResult(settings.user_id, this.workerId, false, nowWib, target.date, next.nextAutoPostAt, "failed", claimed.id, logs.length, message);
    } finally {
      await closeAutomation().catch(() => undefined);
    }
  }

  private async submitLogs(job: SchedulerJobRow, logs: DailyLog[], nextAutoPostAt: string | null): Promise<{ status: SchedulerJobStatus; message: string }> {
    let sawSubmitFailure = false;
    for (const log of logs) {
      const startedAt = new Date().toISOString();
      await this.upsertSubmission(job.user_id, job.id, log, "running", startedAt, null);

      const before = await verifyLogExistsOnSkp(log);
      if (before.foundOnSkp) {
        await this.markLogSubmitted(job.user_id, log.id, "Data sudah ada di website SKP.");
        await this.upsertSubmission(job.user_id, job.id, log, "already_submitted", startedAt, new Date().toISOString());
        continue;
      }

      const submitted = await submitDailyLog(log);
      if (!submitted.ok) {
        sawSubmitFailure = true;
        await this.markLogFailed(job.user_id, log.id, submitted.message ?? "Submit gagal.", submitted.errorCode ?? "SUBMIT_FAILED", submitted);
        await this.upsertSubmission(job.user_id, job.id, log, "failed", startedAt, new Date().toISOString(), submitted.errorCode, submitted.message, submitted.screenshotPath);
        continue;
      }

      const after = await verifyLogExistsOnSkp(log);
      if (!after.foundOnSkp) {
        await this.markLogFailed(job.user_id, log.id, "Tombol diklik tetapi hasil tidak terverifikasi di SKP.", "VERIFICATION_FAILED", submitted);
        await this.upsertSubmission(job.user_id, job.id, log, "verification_failed", startedAt, new Date().toISOString(), "VERIFICATION_FAILED", "Data belum ditemukan setelah submit.", submitted.screenshotPath);
        await this.finishJob(job.id, "verification_failed", "VERIFICATION_FAILED", "Submit tidak dianggap sukses karena verifikasi SKP gagal.", nextAutoPostAt, log.id);
        return { status: "verification_failed", message: "Submit tidak dianggap sukses karena verifikasi SKP gagal." };
      }

      await this.markLogSubmitted(job.user_id, log.id, "Data terkirim dan ditemukan kembali di website SKP.");
      await this.upsertSubmission(job.user_id, job.id, log, "success", startedAt, new Date().toISOString());
    }

    const status: SchedulerJobStatus = sawSubmitFailure ? "failed" : "success";
    const message = sawSubmitFailure ? "Sebagian Log Harian gagal dikirim." : "Semua Log Harian terkirim dan terverifikasi.";
    await this.finishJob(job.id, status, sawSubmitFailure ? "PARTIAL_FAILED" : null, sawSubmitFailure ? message : null, nextAutoPostAt, logs[0]?.id ?? null);
    return { status, message };
  }

  private async ensureSkpSession(userId: string): Promise<{ ok: boolean; message: string; errorCode?: string }> {
    const [credentials, encryptedSession] = await Promise.all([
      readCredentialsForBackend(this.supabase, userId),
      getEncryptedSkpSessionStatus(this.supabase, userId)
    ]);
    setRuntimeSkpCredentials(credentials);

    if (!credentials.username || !credentials.password) {
      return { ok: false, message: "Kredensial SKP belum tersimpan.", errorCode: "SKP_CREDENTIALS_MISSING" };
    }

    const checked = await checkSession();
    if (checked.status === "connected") return { ok: true, message: "Session SKP valid." };

    if (!encryptedSession.configured || encryptedSession.status === "expired") {
      const login = await openLogin();
      if (login.status !== "connected") {
        return { ok: false, message: "Login otomatis SKP gagal atau belum selesai.", errorCode: "SKP_LOGIN_FAILED" };
      }
      if (existsSync(getAuthStatePath())) {
        await saveSkpSession(this.supabase, userId, {
          status: "connected",
          storageState: readFileSync(getAuthStatePath(), "utf8"),
          displayName: login.displayName,
          message: login.message
        });
      }
      return { ok: true, message: "Login otomatis SKP berhasil." };
    }

    return { ok: false, message: "Session SKP tidak valid.", errorCode: "SKP_SESSION_INVALID" };
  }

  private async safeDryRunChecks(userId: string, logs: DailyLog[]): Promise<Record<string, unknown>> {
    const [session, successfulSubmission] = await Promise.all([
      getEncryptedSkpSessionStatus(this.supabase, userId).catch((error) => ({ status: "unknown", configured: false, lastCheckedAt: null, error: publicErrorMessage(error) })),
      logs.length > 0 ? this.findSuccessfulSubmission(userId, logs.map((log) => log.id)) : Promise.resolve(null)
    ]);
    return {
      encryptedSessionConfigured: Boolean(session.configured),
      encryptedSessionStatus: session.status,
      encryptedSessionLastCheckedAt: session.lastCheckedAt,
      successfulSubmissionExists: Boolean(successfulSubmission),
      dryRunDidClickSubmit: false
    };
  }

  private async listRunnableSettings(): Promise<AutoPostSettingsRow[]> {
    const { data, error } = await this.supabase.from("auto_post_settings").select("*").eq("enabled", true);
    if (error) throw new Error(error.message);
    return (data ?? []) as AutoPostSettingsRow[];
  }

  private async ensureSettings(userId: string): Promise<AutoPostSettingsRow> {
    const now = new Date().toISOString();
    const insert = await this.supabase
      .from("auto_post_settings")
      .upsert(
        {
          user_id: userId,
          enabled: true,
          post_time: DEFAULT_POST_TIME,
          timezone: WORKER_TIMEZONE,
          active_weekdays: DEFAULT_ACTIVE_WEEKDAYS,
          skip_holidays: true,
          updated_at: now
        },
        { onConflict: "user_id", ignoreDuplicates: true }
      )
      .select("*")
      .maybeSingle();
    if (insert.error && !/duplicate key|unique/i.test(insert.error.message)) throw new Error(insert.error.message);
    if (insert.data) return insert.data as AutoPostSettingsRow;

    const { data, error } = await this.supabase.from("auto_post_settings").select("*").eq("user_id", userId).single();
    if (error) throw new Error(error.message);
    return data as AutoPostSettingsRow;
  }

  private async listHolidays(userId: string): Promise<HolidayRow[]> {
    const { data, error } = await this.supabase
      .from("holidays")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("holiday_date", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as HolidayRow[];
  }

  private async listLogsForDate(userId: string, date: string): Promise<DailyLog[]> {
    const { data, error } = await this.supabase
      .from("daily_logs")
      .select("*")
      .eq("user_id", userId)
      .eq("tanggal", date)
      .order("kode_log", { ascending: true });
    if (error) throw new Error(error.message);
    return ((data ?? []) as DailyLogRow[])
      .filter((row) => !["submitted", "manual_marked_submitted"].includes(String(row.status_skp)))
      .map(toDailyLog);
  }

  private async findSuccessfulSubmission(userId: string, logIds: string[]): Promise<SubmissionRow | null> {
    if (logIds.length === 0) return null;
    const { data, error } = await this.supabase
      .from("daily_log_submissions")
      .select("id,status,daily_log_id,scheduler_job_id")
      .eq("user_id", userId)
      .in("daily_log_id", logIds)
      .in("status", ["success", "already_submitted"])
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as SubmissionRow | null) ?? null;
  }

  private async createJobIfMissing(userId: string, scheduledDate: string, scheduledAt: string, nextAutoPostAt: string | null): Promise<SchedulerJobRow> {
    const now = new Date().toISOString();
    const insert = await this.supabase
      .from("scheduler_jobs")
      .insert({
        user_id: userId,
        job_type: AUTO_POST_JOB_TYPE,
        scheduled_date: scheduledDate,
        scheduled_at: scheduledAt,
        status: "pending",
        next_auto_post_at: nextAutoPostAt,
        created_at: now,
        updated_at: now
      })
      .select("*")
      .maybeSingle();

    if (!insert.error && insert.data) return insert.data as SchedulerJobRow;
    if (insert.error && !/duplicate key|unique/i.test(insert.error.message)) throw new Error(insert.error.message);

    const { data, error } = await this.supabase
      .from("scheduler_jobs")
      .select("*")
      .eq("user_id", userId)
      .eq("job_type", AUTO_POST_JOB_TYPE)
      .eq("scheduled_date", scheduledDate)
      .single();
    if (error) throw new Error(error.message);
    return data as SchedulerJobRow;
  }

  private async claimJob(userId: string, scheduledDate: string): Promise<SchedulerJobRow | null> {
    const now = new Date().toISOString();
    const { data, error } = await this.supabase
      .from("scheduler_jobs")
      .update({
        status: "running",
        locked_at: now,
        locked_by: this.workerId,
        started_at: now,
        updated_at: now
      })
      .eq("user_id", userId)
      .eq("job_type", AUTO_POST_JOB_TYPE)
      .eq("scheduled_date", scheduledDate)
      .eq("status", "pending")
      .is("locked_at", null)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;

    const nextAttempt = Number((data as SchedulerJobRow).attempt_count ?? 0) + 1;
    const updated = await this.supabase
      .from("scheduler_jobs")
      .update({ attempt_count: nextAttempt, updated_at: now })
      .eq("id", (data as SchedulerJobRow).id)
      .select("*")
      .single();
    if (updated.error) throw new Error(updated.error.message);
    return updated.data as SchedulerJobRow;
  }

  private async finishAndResult(
    job: SchedulerJobRow,
    status: SchedulerJobStatus,
    message: string,
    dailyLogCount: number,
    nowWib: string,
    nextAutoPostAt: string | null,
    errorCode?: string
  ): Promise<WorkerTickResult> {
    await this.finishJob(job.id, status, errorCode ?? null, status === "failed" || status === "login_failed" ? message : null, nextAutoPostAt);
    return baseResult(job.user_id, this.workerId, false, nowWib, job.scheduled_date, nextAutoPostAt, status, job.id, dailyLogCount, message);
  }

  private async finishJob(
    jobId: string,
    status: SchedulerJobStatus,
    errorCode: string | null,
    errorMessage: string | null,
    nextAutoPostAt: string | null,
    dailyLogId?: string | null
  ): Promise<void> {
    const now = new Date().toISOString();
    const { data, error } = await this.supabase
      .from("scheduler_jobs")
      .update({
        status,
        finished_at: now,
        daily_log_id: dailyLogId ?? undefined,
        result_message: errorMessage ? null : status,
        error_code: errorCode,
        error_message: errorMessage,
        next_auto_post_at: nextAutoPostAt,
        updated_at: now
      })
      .eq("id", jobId)
      .select("user_id,status")
      .single();
    if (error) throw new Error(error.message);
    await this.supabase
      .from("auto_post_settings")
      .update({ worker_status: "idle", last_job_status: status, last_job_at: now, next_auto_post_at: nextAutoPostAt, updated_at: now })
      .eq("user_id", data.user_id);
  }

  private async upsertSubmission(
    userId: string,
    jobId: string,
    log: DailyLog,
    status: string,
    startedAt: string | null,
    finishedAt: string | null,
    errorCode?: string | null,
    errorMessage?: string | null,
    screenshotPath?: string | null
  ): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.supabase
      .from("daily_log_submissions")
      .upsert(
        {
          user_id: userId,
          daily_log_id: log.id,
          scheduler_job_id: jobId,
          local_item_id: `${AUTO_POST_JOB_TYPE}:${log.tanggal}:${log.id}`,
          tanggal: log.tanggal,
          status,
          attempt_count: status === "running" ? 1 : undefined,
          error_code: errorCode ?? null,
          error_message: errorMessage ?? null,
          screenshot_path: screenshotPath ?? null,
          started_at: startedAt,
          finished_at: finishedAt,
          updated_at: now
        },
        { onConflict: "user_id,local_item_id" }
      );
    if (error) throw new Error(error.message);
  }

  private async markLogSubmitted(userId: string, logId: string, message: string): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.supabase
      .from("daily_logs")
      .update({ status_local: "valid", status_skp: "submitted", last_sync_at: now, last_error: null, last_error_code: null, updated_at: now })
      .eq("user_id", userId)
      .eq("id", logId);
    if (error) throw new Error(error.message);
    await this.audit(userId, "log.auto_post_success", "Auto Post berhasil", message, "daily_log", logId, "success");
  }

  private async markLogFailed(userId: string, logId: string, message: string, errorCode: string, result: Record<string, unknown>): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.supabase
      .from("daily_logs")
      .update({
        status_skp: "failed",
        last_sync_at: now,
        last_error: message,
        last_error_code: errorCode,
        current_url: typeof result.currentUrl === "string" ? result.currentUrl : null,
        automation_step: typeof result.step === "string" ? result.step : null,
        screenshot_path: typeof result.screenshotPath === "string" ? result.screenshotPath : null,
        updated_at: now
      })
      .eq("user_id", userId)
      .eq("id", logId);
    if (error) throw new Error(error.message);
    await this.audit(userId, "log.auto_post_failed", "Auto Post gagal", message, "daily_log", logId, "warning");
  }

  private async updateSettingsTick(userId: string, workerStatus: string, nextAutoPostAt: string | null): Promise<void> {
    await this.supabase
      .from("auto_post_settings")
      .update({ worker_status: workerStatus, next_auto_post_at: nextAutoPostAt, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
  }

  private async latestJob(userId: string): Promise<SchedulerJobRow | null> {
    const { data, error } = await this.supabase
      .from("scheduler_jobs")
      .select("*")
      .eq("user_id", userId)
      .eq("job_type", AUTO_POST_JOB_TYPE)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as SchedulerJobRow | null) ?? null;
  }

  private async count(table: string, userId: string, refine?: (query: any) => any): Promise<number> {
    let query = this.supabase.from(table).select("id", { count: "exact", head: true }).eq("user_id", userId);
    if (refine) query = refine(query);
    const { count, error } = await query;
    if (error) throw new Error(error.message);
    return Number(count ?? 0);
  }

  private async audit(userId: string, eventType: string, title: string, message: string, entityType: string, entityId: string, severity: string): Promise<void> {
    await this.supabase.from("audit_logs").insert({
      user_id: userId,
      event_type: eventType,
      title,
      message,
      entity_type: entityType,
      entity_id: entityId,
      severity,
      created_at: new Date().toISOString()
    });
  }

  private resolveDryRun(value?: boolean): boolean {
    if (value !== undefined) return value;
    return process.env.WORKER_DRY_RUN !== "false";
  }
}

export function createAutoPostWorkerService(options: { supabase?: SupabaseClient; workerId?: string } = {}): AutoPostWorkerService {
  return new AutoPostWorkerService(options);
}

export function computeNextRun(now: Date, settings: AutoPostSettingsRow, holidays: HolidayRow[]): ReturnType<typeof getNextAutoPostAt> {
  return getNextAutoPostAt(
    now,
    {
      enabled: settings.enabled,
      postTime: normalizePostTime(settings.post_time),
      timezone: settings.timezone || WORKER_TIMEZONE,
      activeWeekdays: normalizeWeekdays(settings.active_weekdays)
    },
    holidays.map((holiday) => ({ date: holiday.holiday_date, isActive: holiday.is_active }))
  );
}

function dueTargetForNow(now: Date, settings: AutoPostSettingsRow, holidays: HolidayRow[]): TargetState | null {
  const today = wibDateKey(now);
  const time = wibTime(now);
  const postTime = normalizePostTime(settings.post_time);
  if (time < postTime) return null;
  return targetStateForDate(today, settings, holidays, true, now);
}

function targetStateForDate(date: string, settings: AutoPostSettingsRow, holidays: HolidayRow[], due: boolean, now: Date): TargetState {
  const postTime = normalizePostTime(settings.post_time);
  const scheduledAt = dateKeyTimeToUtcIso(date, postTime);
  const weekdays = new Set(normalizeWeekdays(settings.active_weekdays));
  if (!weekdays.has(dayOfWeek(date))) {
    return { date, scheduledAt, due, skipStatus: "skipped_weekend", skipMessage: "Tanggal target jatuh pada akhir pekan." };
  }
  if (settings.skip_holidays !== false && holidays.some((holiday) => holiday.is_active && holiday.holiday_date.slice(0, 10) === date)) {
    return { date, scheduledAt, due, skipStatus: "skipped_holiday", skipMessage: "Tanggal target ada di tabel holidays." };
  }
  if (date > wibDateKey(now)) {
    return { date, scheduledAt, due: false, skipStatus: null, skipMessage: null };
  }
  return { date, scheduledAt, due, skipStatus: null, skipMessage: null };
}

function normalizePostTime(value?: string | null): string {
  const match = String(value || DEFAULT_POST_TIME).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return DEFAULT_POST_TIME;
  const hour = Math.min(23, Math.max(0, Number(match[1]) || 0));
  const minute = Math.min(59, Math.max(0, Number(match[2]) || 0));
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeWeekdays(value?: number[] | null): number[] {
  return Array.isArray(value) && value.length > 0 ? value.filter((item) => Number.isInteger(item)) : DEFAULT_ACTIVE_WEEKDAYS;
}

function dayOfWeek(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1)).getUTCDay();
}

export function wibDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: WORKER_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  return `${part(parts, "year")}-${part(parts, "month")}-${part(parts, "day")}`;
}

function wibTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: WORKER_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  return `${part(parts, "hour")}:${part(parts, "minute")}`;
}

function formatWibDateTime(date: Date): string {
  return `${wibDateKey(date)} ${wibTime(date)} WIB`;
}

function dateKeyTimeToUtcIso(dateKey: string, time: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1, (hour || 0) - 7, minute || 0, 0, 0)).toISOString();
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((item) => item.type === type)?.value ?? "";
}

function toDailyLog(row: DailyLogRow): DailyLog {
  return {
    id: row.id,
    period_id: row.local_period_id,
    kode_log: row.kode_log,
    tanggal: String(row.tanggal).slice(0, 10),
    kode_skp: row.kode_skp ?? null,
    nama_skp: row.nama_skp ?? null,
    nama_aktivitas: row.nama_aktivitas ?? null,
    deskripsi: row.deskripsi ?? null,
    indikator_kinerja_individu: row.indikator_kinerja_individu ?? null,
    kuantitas_output: row.kuantitas_output ?? null,
    satuan: row.satuan ?? null,
    link_tautan: row.link_tautan ?? null,
    status_local: row.status_local,
    status_skp: row.status_skp,
    reason_type: row.reason_type ?? null,
    reason_note: row.reason_note ?? null,
    source_file: row.source_file ?? null,
    source_hash: row.source_hash ?? null,
    last_sync_at: row.last_sync_at ?? null,
    last_error: row.last_error ?? null,
    last_error_code: row.last_error_code ?? null,
    current_url: row.current_url ?? null,
    automation_step: row.automation_step ?? null,
    screenshot_path: row.screenshot_path ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null
  };
}

function baseResult(
  userId: string,
  workerId: string,
  dryRun: boolean,
  nowWib: string,
  targetDate: string | null,
  nextAutoPostAt: string | null,
  status: WorkerTickResult["status"],
  jobId: string | null,
  dailyLogCount: number,
  message: string,
  safeChecks?: Record<string, unknown>
): WorkerTickResult {
  return { ok: !["failed", "login_failed", "verification_failed", "unsupported_backend"].includes(String(status)), dryRun, userId, workerId, nowWib, targetDate, nextAutoPostAt, status, jobId, dailyLogCount, message, safeChecks };
}

function sanitizeJob(job: SchedulerJobRow | null): Record<string, unknown> | null {
  if (!job) return null;
  return {
    id: job.id,
    jobType: job.job_type,
    scheduledDate: job.scheduled_date,
    scheduledAt: job.scheduled_at,
    status: job.status,
    lockedAt: job.locked_at,
    lockedBy: job.locked_by,
    startedAt: job.started_at,
    finishedAt: job.finished_at,
    attemptCount: job.attempt_count,
    dailyLogId: job.daily_log_id,
    resultMessage: job.result_message,
    errorCode: job.error_code,
    nextAutoPostAt: job.next_auto_post_at,
    createdAt: job.created_at,
    updatedAt: job.updated_at
  };
}

function publicErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/(password|cookie|jwt|token|secret|key|connection string)\s*[:=]\s*\S+/gi, "$1=[redacted]");
}
