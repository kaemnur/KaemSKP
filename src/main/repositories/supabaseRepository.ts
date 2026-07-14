import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPrivilegedSupabaseClient } from "../supabase/config";
import type { ActivityHistory, DailyLog, SkpItem, SkpPlanSummary, StatusLocal, StatusSkp } from "../types";
import { nowIso, toDateKey } from "../utils/date";
import type { DataRepository, DailyLogPage, DbHealth, DeleteLogsResult } from "./dataRepository";

type Row = Record<string, any>;

const MANAGED_TABLES = [
  "profiles",
  "skp_plans",
  "skp_plan_items",
  "daily_logs",
  "auto_post_settings",
  "periodic_jobs",
  "periodic_job_items",
  "scheduler_jobs",
  "daily_log_submissions",
  "audit_logs"
] as const;

export type ManagedSupabaseTable = (typeof MANAGED_TABLES)[number];

const SUCCESSFUL_SKP_STATUSES = ["submitted", "manual_marked_submitted", "success", "sent", "terkirim", "manual_submitted"];

export function canCreateSupabaseRepository(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}

export function createSupabaseRepository(): DataRepository {
  const client = createPrivilegedSupabaseClient();
  const userId = process.env.KAEMSKP_MIGRATION_USER_ID;
  if (!client || !userId) {
    throw new Error("Konfigurasi Supabase backend belum lengkap.");
  }
  return new SupabaseRepository(client, userId);
}

export function createSupabaseRepositoryForUser(userId: string): DataRepository {
  const client = createPrivilegedSupabaseClient();
  if (!client) {
    throw new Error("Konfigurasi Supabase backend belum lengkap.");
  }
  return new SupabaseRepository(client, userId);
}

export function createManagedSupabaseTableRepository() {
  const client = createPrivilegedSupabaseClient();
  const userId = process.env.KAEMSKP_MIGRATION_USER_ID;
  if (!client || !userId) {
    throw new Error("Konfigurasi Supabase backend belum lengkap.");
  }
  return new ManagedSupabaseTableRepository(client, userId);
}

export class ManagedSupabaseTableRepository {
  readonly tables = MANAGED_TABLES;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly userId: string
  ) {}

  async count(table: ManagedSupabaseTable): Promise<number> {
    const { count, error } = await this.supabase.from(table).select("id", { count: "exact", head: true }).eq("user_id", this.userId);
    if (error) throw new Error(error.message);
    return Number(count ?? 0);
  }

  async list(table: ManagedSupabaseTable, limit = 100): Promise<Row[]> {
    const { data, error } = await this.supabase.from(table).select("*").eq("user_id", this.userId).limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []) as Row[];
  }

  async upsert(table: ManagedSupabaseTable, rows: Row | Row[], onConflict?: string): Promise<Row[]> {
    const payload = (Array.isArray(rows) ? rows : [rows]).map((row) => ({ ...row, user_id: this.userId }));
    const query = this.supabase.from(table).upsert(payload, onConflict ? { onConflict } : undefined).select("*");
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []) as Row[];
  }

  async deleteByIds(table: ManagedSupabaseTable, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const { error } = await this.supabase.from(table).delete().eq("user_id", this.userId).in("id", ids);
    if (error) throw new Error(error.message);
  }
}

class SupabaseRepository implements DataRepository {
  readonly backend = "supabase" as const;
  readonly fallbackUsed = false;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly userId: string
  ) {}

  async health(): Promise<DbHealth> {
    const startedAt = Date.now();
    try {
      const [plans, items, logs] = await Promise.all([
        this.count("skp_plans"),
        this.count("skp_plan_items"),
        this.count("daily_logs")
      ]);
      return {
        ok: true,
        backend: "supabase",
        fallbackUsed: false,
        status: "ok",
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        counts: {
          skpPlans: plans,
          skpPlanItems: items,
          dailyLogs: logs
        },
        message: "Supabase siap."
      };
    } catch {
      return {
        ok: false,
        backend: "supabase",
        fallbackUsed: false,
        status: "error",
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        message: "Database Supabase tidak siap."
      };
    }
  }

  async getActiveSkpPlanSummary(): Promise<SkpPlanSummary> {
    const plan = await this.activePlan();
    if (!plan) {
      return {
        hasActivePlan: false,
        periodId: null,
        year: null,
        label: null,
        startDate: null,
        endDate: null,
        totalItems: 0,
        sourceFile: null,
        importedAt: null
      };
    }
    const totalItems = await this.count("skp_plan_items", (query) => query.eq("plan_id", plan.id).eq("is_active", true));
    return {
      hasActivePlan: true,
      periodId: plan.local_period_id,
      year: Number(plan.year),
      label: plan.label,
      startDate: plan.start_date,
      endDate: plan.end_date,
      totalItems,
      sourceFile: plan.source_file,
      importedAt: plan.imported_at
    };
  }

  async listSkpItems(): Promise<SkpItem[]> {
    const plan = await this.requireActivePlan();
    const { data, error } = await this.supabase
      .from("skp_plan_items")
      .select("*")
      .eq("user_id", this.userId)
      .eq("plan_id", plan.id)
      .eq("is_active", true)
      .order("kode_skp", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => this.toSkpItem(row));
  }

  async listSkpMappings(): Promise<Array<Record<string, string | number | null>>> {
    const plan = await this.requireActivePlan();
    const { data, error } = await this.supabase
      .from("skp_plan_items")
      .select("*")
      .eq("user_id", this.userId)
      .eq("plan_id", plan.id)
      .order("kode_skp", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({
      id: row.id,
      period_id: row.local_period_id,
      kode_skp: row.kode_skp,
      local_skp_name: row.nama_skp,
      site_option_text: row.site_option_text,
      site_option_value: row.site_option_value,
      match_status: row.match_status,
      last_checked_at: row.last_checked_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      nama_skp: row.nama_skp
    }));
  }

  async updateSkpMapping(payload: { kode_skp: string; site_option_text: string; site_option_value: string; match_status: string }): Promise<void> {
    const plan = await this.requireActivePlan();
    const { error } = await this.supabase
      .from("skp_plan_items")
      .update({
        site_option_text: payload.site_option_text,
        site_option_value: payload.site_option_value,
        match_status: payload.match_status,
        last_checked_at: nowIso()
      })
      .eq("user_id", this.userId)
      .eq("plan_id", plan.id)
      .eq("kode_skp", payload.kode_skp);
    if (error) throw new Error(error.message);
  }

  async listDailyLogsPage(filters: Record<string, string | undefined> = {}): Promise<DailyLogPage> {
    const page = Math.max(1, Number(filters.page || 1));
    const requestedPageSize = Math.max(1, Number(filters.pageSize || 20));
    const pageSize = Math.min(20, requestedPageSize);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const total = await this.countDailyLogs(filters);
    const summaryRows = await this.fetchDailyLogsForSummary(filters);
    const summary = summarizeLogs(summaryRows);
    const query = this.applyDailyLogFilters(
      this.supabase.from("daily_logs").select("*", { count: "exact" }).eq("user_id", this.userId),
      filters
    );
    applyDailyLogOrder(query, filters.sort);
    const { data, error } = await query.range(from, to);
    if (error) throw new Error(error.message);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return {
      data: ((data ?? []) as Row[]).map((row) => this.toDailyLog(row)),
      summary,
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    };
  }

  async getDailyLog(id: string): Promise<DailyLog | undefined> {
    const { data, error } = await this.supabase.from("daily_logs").select("*").eq("user_id", this.userId).eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? this.toDailyLog(data) : undefined;
  }

  async upsertDailyLog(input: Partial<DailyLog>): Promise<DailyLog> {
    const plan = await this.requireActivePlan();
    const tanggal = input.tanggal;
    if (!tanggal) throw new Error("Tanggal wajib diisi.");

    const existing = input.id ? await this.getDailyLog(input.id) : undefined;
    const skpItem = input.kode_skp ? await this.findSkpItem(plan.id, input.kode_skp) : null;
    const statusLocal = (input.status_local ?? (input.kode_skp ? "valid" : "needs_review")) as StatusLocal;
    const kodeLog = input.kode_log || existing?.kode_log || (await this.nextKodeLog(plan.local_period_id, tanggal));
    const now = nowIso();
    const row = {
      id: input.id ?? undefined,
      user_id: this.userId,
      local_id: input.id ?? existing?.id ?? null,
      local_period_id: plan.local_period_id,
      plan_id: plan.id,
      kode_log: kodeLog,
      tanggal,
      kode_skp: input.kode_skp ?? null,
      nama_skp: input.nama_skp ?? skpItem?.nama_skp ?? null,
      nama_aktivitas: input.nama_aktivitas ?? null,
      deskripsi: input.deskripsi ?? null,
      indikator_kinerja_individu: input.indikator_kinerja_individu ?? null,
      kuantitas_output: input.kuantitas_output ?? null,
      satuan: input.satuan ?? null,
      link_tautan: input.link_tautan ?? null,
      status_local: statusLocal,
      status_skp: (input.status_skp ?? (tanggal > toDateKey() ? "waiting_date" : "not_submitted")) as StatusSkp,
      reason_type: input.reason_type ?? null,
      reason_note: input.reason_note ?? (statusLocal === "needs_review" ? "SKP belum dipilih atau belum cocok." : null),
      source_file: input.source_file ?? null,
      source_hash: input.source_hash ?? null,
      last_sync_at: input.last_sync_at ?? null,
      last_error: input.last_error ?? null,
      last_error_code: input.last_error_code ?? null,
      current_url: input.current_url ?? null,
      automation_step: input.automation_step ?? null,
      screenshot_path: input.screenshot_path ?? null,
      created_at: input.created_at ?? existing?.created_at ?? now,
      updated_at: now
    };

    const { data, error } = await this.supabase
      .from("daily_logs")
      .upsert(row, { onConflict: "user_id,local_period_id,kode_log" })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return this.toDailyLog(data);
  }

  async deleteDailyLog(id: string): Promise<DeleteLogsResult> {
    const before = await this.count("daily_logs");
    const { error } = await this.supabase.from("daily_logs").delete().eq("user_id", this.userId).eq("id", id);
    if (error) throw new Error(error.message);
    const remainingCount = await this.count("daily_logs");
    return { success: true, deletedCount: before > remainingCount ? 1 : 0, remainingCount };
  }

  async deleteDailyLogsBulk(ids: string[]): Promise<DeleteLogsResult> {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (uniqueIds.length === 0) {
      return { success: true, deletedCount: 0, remainingCount: await this.count("daily_logs") };
    }
    const before = await this.count("daily_logs");
    const { error } = await this.supabase.from("daily_logs").delete().eq("user_id", this.userId).in("id", uniqueIds);
    if (error) throw new Error(error.message);
    const remainingCount = await this.count("daily_logs");
    return { success: true, deletedCount: Math.max(0, before - remainingCount), remainingCount };
  }

  async listHistory(limit = 100): Promise<ActivityHistory[]> {
    const { data, error } = await this.supabase
      .from("audit_logs")
      .select("*")
      .eq("user_id", this.userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({
      id: row.id,
      event_type: row.event_type,
      title: row.title,
      message: row.message,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      severity: row.severity,
      created_at: row.created_at
    }));
  }

  async listSyncQueue(limit = 200): Promise<Array<Record<string, unknown>>> {
    const { data, error } = await this.supabase
      .from("daily_log_submissions")
      .select("*, daily_logs(kode_log,nama_aktivitas,kode_skp,nama_skp), scheduler_jobs(job_type,created_at)")
      .eq("user_id", this.userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({
      id: row.id,
      job_id: row.scheduler_job_id,
      daily_log_id: row.daily_log_id,
      tanggal: row.tanggal,
      nama_aktivitas: row.daily_logs?.nama_aktivitas ?? null,
      kode_skp: row.daily_logs?.kode_skp ?? null,
      nama_skp: row.daily_logs?.nama_skp ?? null,
      status: row.status,
      attempt_count: row.attempt_count,
      error_code: row.error_code,
      error_message: row.error_message,
      screenshot_path: row.screenshot_path,
      started_at: row.started_at,
      finished_at: row.finished_at,
      job_type: row.scheduler_jobs?.job_type ?? null,
      job_created_at: row.scheduler_jobs?.created_at ?? null
    }));
  }

  async listSyncHistory(limit = 200): Promise<Array<Record<string, unknown>>> {
    const [history, submissions] = await Promise.all([this.listHistory(limit), this.listSubmissionHistory(limit)]);
    return [...history.map(toAuditHistoryRow), ...submissions]
      .sort((left, right) => String(right.waktu ?? "").localeCompare(String(left.waktu ?? "")))
      .slice(0, limit);
  }

  async listLogSyncHistory(logId: string): Promise<Array<Record<string, unknown>>> {
    const { data, error } = await this.supabase
      .from("daily_log_submissions")
      .select("*, scheduler_jobs(job_type)")
      .eq("user_id", this.userId)
      .eq("daily_log_id", logId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({
      id: row.id,
      waktu: row.finished_at ?? row.started_at ?? row.created_at,
      aksi: row.scheduler_jobs?.job_type ?? "sync_item",
      hasil: row.status,
      error_code: row.error_code,
      pesan: row.error_message,
      screenshot_path: row.screenshot_path
    }));
  }

  async countManagedTables(): Promise<Record<(typeof MANAGED_TABLES)[number], number>> {
    const entries = await Promise.all(MANAGED_TABLES.map(async (table) => [table, await this.count(table)] as const));
    return Object.fromEntries(entries) as Record<(typeof MANAGED_TABLES)[number], number>;
  }

  private async listSubmissionHistory(limit: number): Promise<Array<Record<string, unknown>>> {
    const { data, error } = await this.supabase
      .from("daily_log_submissions")
      .select("*, scheduler_jobs(job_type)")
      .eq("user_id", this.userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => ({
      waktu: row.finished_at ?? row.started_at ?? row.created_at,
      aksi: row.scheduler_jobs?.job_type ?? "sync_item",
      tanggal_log: row.tanggal,
      hasil: row.status,
      error_code: row.error_code,
      pesan: row.error_message,
      screenshot_error: row.screenshot_path
    }));
  }

  private async activePlan(): Promise<Row | null> {
    const { data, error } = await this.supabase
      .from("skp_plans")
      .select("*")
      .eq("user_id", this.userId)
      .eq("is_active", true)
      .order("imported_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  private async requireActivePlan(): Promise<Row> {
    const plan = await this.activePlan();
    if (!plan) throw new Error("Rencana SKP aktif belum tersedia di Supabase.");
    return plan;
  }

  private async findSkpItem(planId: string, kodeSkp: string): Promise<Row | null> {
    const { data, error } = await this.supabase
      .from("skp_plan_items")
      .select("*")
      .eq("user_id", this.userId)
      .eq("plan_id", planId)
      .eq("kode_skp", kodeSkp)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  private async nextKodeLog(localPeriodId: string, tanggal: string): Promise<string> {
    const like = `LOG-${tanggal}-%`;
    const { data, error } = await this.supabase
      .from("daily_logs")
      .select("kode_log")
      .eq("user_id", this.userId)
      .eq("local_period_id", localPeriodId)
      .eq("tanggal", tanggal)
      .like("kode_log", like);
    if (error) throw new Error(error.message);
    const max = (data ?? []).reduce((current, row) => {
      const suffix = Number(String(row.kode_log ?? "").slice(-2));
      return Number.isFinite(suffix) ? Math.max(current, suffix) : current;
    }, 0);
    return `LOG-${tanggal}-${String(max + 1).padStart(2, "0")}`;
  }

  private async count(table: string, refine?: (query: any) => any): Promise<number> {
    let query = this.supabase.from(table).select("id", { count: "exact", head: true }).eq("user_id", this.userId);
    if (refine) query = refine(query);
    const { count, error } = await query;
    if (error) throw new Error(error.message);
    return Number(count ?? 0);
  }

  private async countDailyLogs(filters: Record<string, string | undefined>): Promise<number> {
    const query = this.applyDailyLogFilters(this.supabase.from("daily_logs").select("id", { count: "exact", head: true }).eq("user_id", this.userId), filters);
    const { count, error } = await query;
    if (error) throw new Error(error.message);
    return Number(count ?? 0);
  }

  private async fetchDailyLogsForSummary(filters: Record<string, string | undefined>): Promise<DailyLog[]> {
    const query = this.applyDailyLogFilters(
      this.supabase.from("daily_logs").select("id,status_local,status_skp").eq("user_id", this.userId),
      filters
    );
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map((row) => this.toDailyLog(row));
  }

  private applyDailyLogFilters(query: any, filters: Record<string, string | undefined>): any {
    if (filters.year) {
      query = query.gte("tanggal", `${filters.year}-01-01`).lte("tanggal", `${filters.year}-12-31`);
    }
    if (filters.month) {
      query = query.gte("tanggal", `${filters.month}-01`).lte("tanggal", lastDayOfMonth(filters.month));
    }
    if (filters.status_local && filters.status_local !== "all") query = query.eq("status_local", filters.status_local);
    if (filters.status_skp && filters.status_skp !== "all") query = query.eq("status_skp", filters.status_skp);
    if (filters.status && filters.status !== "all") query = query.or(`status_local.eq.${escapeFilter(filters.status)},status_skp.eq.${escapeFilter(filters.status)}`);
    const skpFilter = filters.kode_skp ?? filters.skp;
    if (skpFilter && skpFilter !== "all") query = query.eq("kode_skp", skpFilter);
    if (filters.dateFrom) query = query.gte("tanggal", filters.dateFrom);
    if (filters.dateTo) query = query.lte("tanggal", filters.dateTo);
    if (filters.keyword) {
      const keyword = escapeFilter(`%${filters.keyword}%`);
      query = query.or(
        [
          `kode_log.ilike.${keyword}`,
          `nama_aktivitas.ilike.${keyword}`,
          `deskripsi.ilike.${keyword}`,
          `kode_skp.ilike.${keyword}`,
          `nama_skp.ilike.${keyword}`,
          `satuan.ilike.${keyword}`,
          `link_tautan.ilike.${keyword}`
        ].join(",")
      );
    }
    return query;
  }

  private toSkpItem(row: Row): SkpItem {
    return {
      id: row.local_id ?? row.id,
      period_id: row.local_period_id,
      kode_skp: row.kode_skp,
      nama_skp: row.nama_skp,
      penugasan_dari: row.penugasan_dari,
      indikator_json: Array.isArray(row.indikator_json) ? JSON.stringify(row.indikator_json) : row.indikator_json,
      is_active: row.is_active ? 1 : 0,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  private toDailyLog(row: Row): DailyLog {
    return {
      id: row.id,
      period_id: row.local_period_id,
      kode_log: row.kode_log,
      tanggal: row.tanggal,
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
}

function summarizeLogs(rows: DailyLog[]): DailyLogPage["summary"] {
  return rows.reduce(
    (summary, row) => {
      summary.total += 1;
      if (SUCCESSFUL_SKP_STATUSES.includes(String(row.status_skp ?? "").toLowerCase())) summary.submitted += 1;
      else if (row.status_skp === "failed") summary.failed += 1;
      else summary.notSubmitted += 1;
      if (row.status_local === "invalid" || row.status_local === "needs_review") summary.needsReview += 1;
      return summary;
    },
    { total: 0, submitted: 0, notSubmitted: 0, failed: 0, needsReview: 0 }
  );
}

function applyDailyLogOrder(query: any, sort?: string): void {
  if (sort === "tanggal_desc") {
    query.order("tanggal", { ascending: false }).order("kode_log", { ascending: false });
    return;
  }
  if (sort === "status") {
    query.order("status_local", { ascending: true }).order("status_skp", { ascending: true }).order("tanggal", { ascending: true }).order("kode_log", { ascending: true });
    return;
  }
  if (sort === "skp") {
    query.order("kode_skp", { ascending: true }).order("tanggal", { ascending: true }).order("kode_log", { ascending: true });
    return;
  }
  query.order("tanggal", { ascending: true }).order("kode_log", { ascending: true });
}

function toAuditHistoryRow(row: ActivityHistory): Record<string, unknown> {
  return {
    waktu: row.created_at,
    aksi: row.event_type,
    tanggal_log: null,
    hasil: row.severity,
    error_code: null,
    pesan: row.message,
    screenshot_error: null
  };
}

function lastDayOfMonth(month: string): string {
  const [year, monthIndex] = month.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex)) return `${month}-31`;
  const last = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, "0")}`;
}

function escapeFilter(value: string): string {
  return value.replace(/[,()]/g, "");
}

export function newTestLocalId(): string {
  return `test-${randomUUID()}`;
}
