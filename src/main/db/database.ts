import Database from "better-sqlite3";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ActivityHistory,
  CalendarDay,
  DailyLog,
  ImportPreview,
  MonthlySuccessData,
  SessionStatus,
  SkpItem,
  SkpPlanParseResult,
  SkpPlanSummary,
  StatusLocal,
  StatusSkp,
  TodayLogState,
  TodayLogStatus
} from "../types";
import { getNextAutoPostAt } from "../scheduler/nextAutoPost";
import { eachDate, formatLongDate, getDayName, isWeekend, nowIso, toDateKey } from "../utils/date";
import { SKP_2026 } from "./seedData";

let db: Database.Database | null = null;
let dataDir = "";

const MONTH_LABELS_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const SUCCESSFUL_SKP_STATUSES = ["submitted", "manual_marked_submitted", "success", "sent", "terkirim", "manual_submitted"];

export function getDataDir(): string {
  if (!dataDir) {
    const appData = process.env.APPDATA || process.env.LOCALAPPDATA || join(process.env.USERPROFILE || process.cwd(), "AppData", "Roaming");
    dataDir = join(appData, "KaemSKP");
  }
  return dataDir;
}

export function getDbPath(): string {
  return join(getDataDir(), "kaemskp.db");
}

export async function backupDatabase(): Promise<{ ok: true; backupPath: string }> {
  ensureDataDirs();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = join(getDataDir(), "backups", `kaemskp-${stamp}.db`);
  await getDb().backup(backupPath);
  addHistory("database.backup", "Backup database dibuat", backupPath, "success");
  return { ok: true, backupPath };
}

export function restoreDatabaseFromFile(filePath: string): { ok: true; dbPath: string } {
  const dbPath = getDbPath();
  if (db) {
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.close();
    db = null;
  }
  copyFileSync(filePath, dbPath);
  initDatabase();
  addHistory("database.restore", "Database direstore", dbPath, "warning");
  return { ok: true, dbPath };
}

export function clearLocalLogData(): { ok: true } {
  const period = getActivePeriod();
  const tx = getDb().transaction(() => {
    getDb().prepare("DELETE FROM sync_job_items").run();
    getDb().prepare("DELETE FROM sync_jobs").run();
    getDb().prepare("DELETE FROM daily_logs WHERE period_id = ?").run(period.id);
    getDb().prepare("DELETE FROM import_batches WHERE period_id = ?").run(period.id);
    getDb().prepare("DELETE FROM calendar_days WHERE period_id = ?").run(period.id);
  });
  tx();
  generateCalendarDays(period.id, "2026-01-01", "2026-12-31");
  addHistory("database.clear_logs", "Data log lokal dihapus", "daily_logs, import_batches, dan antrean lokal dikosongkan.", "warning");
  return { ok: true };
}

export function ensureDataDirs(): void {
  const root = getDataDir();
  for (const dir of [root, "sessions", "imports", "exports", "logs", "screenshots", "config", "backups"].map((name) => (name === root ? name : join(root, name)))) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

export function getDb(): Database.Database {
  if (!db) {
    ensureDataDirs();
    const dbPath = getDbPath();
    mkdirSync(dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
  }
  return db;
}

export function initDatabase(): void {
  const database = getDb();
  database.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS skp_periods (
      id TEXT PRIMARY KEY,
      year INTEGER NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      label TEXT NOT NULL,
      is_active INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS skp_items (
      id TEXT PRIMARY KEY,
      period_id TEXT NOT NULL,
      kode_skp TEXT NOT NULL,
      nama_skp TEXT NOT NULL,
      penugasan_dari TEXT,
      indikator_json TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT,
      updated_at TEXT,
      UNIQUE(period_id, kode_skp)
    );

    CREATE TABLE IF NOT EXISTS skp_site_mappings (
      id TEXT PRIMARY KEY,
      period_id TEXT NOT NULL,
      kode_skp TEXT NOT NULL,
      local_skp_name TEXT NOT NULL,
      site_option_text TEXT,
      site_option_value TEXT,
      match_status TEXT NOT NULL,
      last_checked_at TEXT,
      created_at TEXT,
      updated_at TEXT,
      UNIQUE(period_id, kode_skp)
    );

    CREATE TABLE IF NOT EXISTS skp_plans (
      id TEXT PRIMARY KEY,
      period_id TEXT NOT NULL,
      source_file TEXT,
      profile_json TEXT,
      raw_text_hash TEXT,
      imported_at TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS daily_logs (
      id TEXT PRIMARY KEY,
      period_id TEXT NOT NULL,
      kode_log TEXT NOT NULL,
      tanggal TEXT NOT NULL,
      kode_skp TEXT,
      nama_skp TEXT,
      nama_aktivitas TEXT,
      deskripsi TEXT,
      indikator_kinerja_individu TEXT,
      kuantitas_output TEXT,
      satuan TEXT,
      link_tautan TEXT,
      status_local TEXT NOT NULL,
      status_skp TEXT NOT NULL,
      reason_type TEXT,
      reason_note TEXT,
      source_file TEXT,
      source_hash TEXT,
      last_sync_at TEXT,
      last_error TEXT,
      last_error_code TEXT,
      current_url TEXT,
      automation_step TEXT,
      screenshot_path TEXT,
      created_at TEXT,
      updated_at TEXT,
      UNIQUE(period_id, kode_log)
    );

    CREATE TABLE IF NOT EXISTS calendar_days (
      id TEXT PRIMARY KEY,
      period_id TEXT NOT NULL,
      date TEXT NOT NULL,
      day_name TEXT,
      is_weekend INTEGER DEFAULT 0,
      is_public_holiday INTEGER DEFAULT 0,
      is_leave INTEGER DEFAULT 0,
      holiday_name TEXT,
      status TEXT NOT NULL,
      reason_type TEXT,
      reason_note TEXT,
      created_at TEXT,
      updated_at TEXT,
      UNIQUE(period_id, date)
    );

    CREATE TABLE IF NOT EXISTS import_batches (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      file_path TEXT,
      file_hash TEXT,
      import_type TEXT NOT NULL,
      period_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      total_rows INTEGER DEFAULT 0,
      new_rows INTEGER DEFAULT 0,
      updated_rows INTEGER DEFAULT 0,
      unchanged_rows INTEGER DEFAULT 0,
      invalid_rows INTEGER DEFAULT 0,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_jobs (
      id TEXT PRIMARY KEY,
      job_type TEXT NOT NULL,
      period_id TEXT NOT NULL,
      date_from TEXT,
      date_to TEXT,
      status TEXT NOT NULL,
      total_items INTEGER DEFAULT 0,
      success_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      skipped_count INTEGER DEFAULT 0,
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_job_items (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      daily_log_id TEXT NOT NULL,
      tanggal TEXT NOT NULL,
      status TEXT NOT NULL,
      attempt_count INTEGER DEFAULT 0,
      error_code TEXT,
      error_message TEXT,
      screenshot_path TEXT,
      started_at TEXT,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS periodic_history (
      id TEXT PRIMARY KEY,
      period_id TEXT NOT NULL,
      year INTEGER NOT NULL,
      quarter INTEGER NOT NULL,
      total_skp INTEGER DEFAULT 0,
      success_count INTEGER DEFAULT 0,
      failed_count INTEGER DEFAULT 0,
      submit_status TEXT,
      status TEXT NOT NULL,
      mode TEXT NOT NULL,
      error_last TEXT,
      screenshot_path TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS activity_history (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT,
      entity_type TEXT,
      entity_id TEXT,
      severity TEXT,
      created_at TEXT
    );
  `);

  runMigrations();
  seedDefaults();
}

function runMigrations(): void {
  addColumnIfMissing("daily_logs", "nama_skp", "TEXT");
  addColumnIfMissing("daily_logs", "indikator_kinerja_individu", "TEXT");
  addColumnIfMissing("daily_logs", "last_error_code", "TEXT");
  addColumnIfMissing("daily_logs", "current_url", "TEXT");
  addColumnIfMissing("daily_logs", "automation_step", "TEXT");
  addColumnIfMissing("daily_logs", "screenshot_path", "TEXT");
  addColumnIfMissing("sync_job_items", "error_code", "TEXT");
  addColumnIfMissing("import_batches", "period_start", "TEXT");
  addColumnIfMissing("import_batches", "period_end", "TEXT");
  addColumnIfMissing("skp_plans", "raw_text_hash", "TEXT");
}

function addColumnIfMissing(table: string, column: string, definition: string): void {
  const columns = getDb().prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    getDb().exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value, updated_at)
       VALUES (@key, @value, @updated_at)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run({ key, value, updated_at: nowIso() });
}

export function getSetting(key: string, fallback = ""): string {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

export function listSettings(): Record<string, string> {
  const rows = getDb().prepare("SELECT key, value FROM settings").all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export function updateSettings(values: Record<string, string>): Record<string, string> {
  const tx = getDb().transaction(() => {
    for (const [key, value] of Object.entries(values)) {
      setSetting(key, value);
    }
  });
  tx();
  addHistory("settings.updated", "Pengaturan disimpan", "Pengaturan lokal KaemSKP diperbarui.", "info");
  return listSettings();
}

export type StoredSkpSessionStatus = {
  status: SessionStatus;
  isLoggedIn: boolean;
  username: string | null;
  displayName: string | null;
  lastCheckedAt: string;
  message: string;
};

export function getSkpSessionStatus(): StoredSkpSessionStatus {
  const status = normalizeSessionStatus(getSetting("skp_session_status", "not_logged_in"));
  const username = getSetting("skp_username", "").trim() || process.env.SKP_USERNAME?.trim() || null;
  const displayName = getSetting("skp_session_display_name", "").trim() || null;
  return {
    status,
    isLoggedIn: status === "connected",
    username,
    displayName,
    lastCheckedAt: getSetting("skp_session_last_checked_at", ""),
    message: getSetting("skp_session_message", defaultSessionMessage(status))
  };
}

export function updateSkpSessionStatus(status: SessionStatus, message: string, displayName?: string | null): StoredSkpSessionStatus {
  const now = nowIso();
  setSetting("skp_session_status", status);
  setSetting("skp_session_last_checked_at", now);
  setSetting("skp_session_message", message);
  if (displayName !== undefined) setSetting("skp_session_display_name", displayName ?? "");
  return getSkpSessionStatus();
}

function normalizeSessionStatus(value: string): SessionStatus {
  return ["connected", "not_logged_in", "expired", "checking", "error"].includes(value) ? (value as SessionStatus) : "not_logged_in";
}

function defaultSessionMessage(status: SessionStatus): string {
  const messages: Record<SessionStatus, string> = {
    connected: "Terhubung ke SKP",
    not_logged_in: "Belum login ke SKP.",
    expired: "Session SKP perlu login ulang.",
    checking: "Sedang mengecek session SKP.",
    error: "Gagal cek session, session lokal belum dihapus."
  };
  return messages[status];
}

function seedDefaults(): void {
  const defaults: Record<string, string> = {
    active_year: "2026",
    skp_base_url: "https://skp.sdm.kemendikdasmen.go.id",
    auto_run_enabled: "false",
    auto_run_start_time: "08:00",
    auto_post_enabled: "true",
    auto_post_timezone: "Asia/Jakarta",
    auto_post_active_weekdays: "1,2,3,4,5",
    auto_run_today_enabled: "true",
    auto_run_retry_failed_today: "true",
    retry_interval_minutes: "10",
    retry_until_time: "16:00",
    submit_mode: "auto_save",
    weekend_is_holiday: "true",
    save_error_screenshot: "false",
    local_managed_start_date: "2026-04-01",
    periodic_feedback_link: "https://drive.google.com/drive/folders/1ln6FSUk550YVlnToaoZ1EUalAVjuIBWB",
    skp_username: "",
    skp_password: ""
  };
  for (const [key, value] of Object.entries(defaults)) {
    const exists = getDb().prepare("SELECT 1 FROM settings WHERE key = ?").get(key);
    if (!exists) setSetting(key, value);
  }

  const now = nowIso();
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO skp_periods (id, year, start_date, end_date, label, is_active, created_at, updated_at)
       VALUES ('period-2026', 2026, '2026-01-01', '2026-12-31', 'SKP Tahun 2026', 1, @now, @now)`
    )
    .run({ now });

  const insertSkp = getDb().prepare(
    `INSERT OR IGNORE INTO skp_items
      (id, period_id, kode_skp, nama_skp, penugasan_dari, indikator_json, is_active, created_at, updated_at)
     VALUES (@id, 'period-2026', @kode_skp, @nama_skp, NULL, NULL, 1, @now, @now)`
  );
  const insertMapping = getDb().prepare(
    `INSERT OR IGNORE INTO skp_site_mappings
      (id, period_id, kode_skp, local_skp_name, site_option_text, site_option_value, match_status, last_checked_at, created_at, updated_at)
     VALUES (@id, 'period-2026', @kode_skp, @nama_skp, @nama_skp, @kode_skp, 'matched', NULL, @now, @now)`
  );
  const txSkp = getDb().transaction(() => {
    for (const item of SKP_2026) {
      insertSkp.run({ id: `skp-${item.kode_skp}`, ...item, now });
      insertMapping.run({ id: `mapping-${item.kode_skp}`, ...item, now });
    }
  });
  txSkp();

  getDb()
    .prepare(
      `UPDATE skp_site_mappings
       SET site_option_text = local_skp_name,
           site_option_value = kode_skp,
           match_status = 'matched',
           updated_at = @now
       WHERE period_id = 'period-2026'
         AND match_status = 'needs_review'
         AND site_option_text IS NULL`
    )
    .run({ now });

  generateCalendarDays("period-2026", "2026-01-01", "2026-12-31");
}

export function generateCalendarDays(periodId: string, start: string, end: string): void {
  const now = nowIso();
  const insert = getDb().prepare(
    `INSERT OR IGNORE INTO calendar_days
      (id, period_id, date, day_name, is_weekend, is_public_holiday, is_leave, holiday_name, status, reason_type, reason_note, created_at, updated_at)
     VALUES (@id, @period_id, @date, @day_name, @is_weekend, 0, 0, NULL, @status, @reason_type, @reason_note, @now, @now)`
  );
  const tx = getDb().transaction(() => {
    for (const date of eachDate(start, end)) {
      const weekend = isWeekend(date);
      insert.run({
        id: `day-${periodId}-${date}`,
        period_id: periodId,
        date,
        day_name: getDayName(date),
        is_weekend: weekend ? 1 : 0,
        status: weekend ? "weekend" : date > toDateKey() ? "future" : "missing",
        reason_type: weekend ? "weekend" : date > toDateKey() ? null : "no_work_plan",
        reason_note: weekend ? "Akhir pekan" : date > toDateKey() ? null : "Belum ada rencana kerja",
        now
      });
    }
  });
  tx();
}

export function getActivePeriod(): { id: string; year: number; start_date: string; end_date: string; label: string } {
  return getDb().prepare("SELECT id, year, start_date, end_date, label FROM skp_periods WHERE is_active = 1 LIMIT 1").get() as {
    id: string;
    year: number;
    start_date: string;
    end_date: string;
    label: string;
  };
}

export function getActiveSkpPlanSummary(): SkpPlanSummary {
  const period = getActivePeriod();
  const plan = getDb()
    .prepare("SELECT source_file, imported_at FROM skp_plans WHERE period_id = ? ORDER BY imported_at DESC LIMIT 1")
    .get(period.id) as { source_file: string | null; imported_at: string | null } | undefined;
  const totalItems = (getDb().prepare("SELECT COUNT(*) as c FROM skp_items WHERE period_id = ? AND is_active = 1").get(period.id) as { c: number }).c;
  return {
    hasActivePlan: Boolean(plan),
    periodId: period.id,
    year: period.year,
    label: period.label,
    startDate: period.start_date,
    endDate: period.end_date,
    totalItems,
    sourceFile: plan?.source_file ?? null,
    importedAt: plan?.imported_at ?? null
  };
}

export function listSkpItems(): SkpItem[] {
  return getDb().prepare("SELECT * FROM skp_items WHERE period_id = ? ORDER BY kode_skp").all(getActivePeriod().id) as SkpItem[];
}

export function listSkpMappings(): Array<Record<string, string | null>> {
  return getDb()
    .prepare(
      `SELECT m.*, i.nama_skp
       FROM skp_site_mappings m
       LEFT JOIN skp_items i ON i.period_id = m.period_id AND i.kode_skp = m.kode_skp
       WHERE m.period_id = ?
       ORDER BY m.kode_skp`
    )
    .all(getActivePeriod().id) as Array<Record<string, string | null>>;
}

export function updateSkpMapping(payload: {
  kode_skp: string;
  site_option_text: string;
  site_option_value: string;
  match_status: string;
}): void {
  getDb()
    .prepare(
      `UPDATE skp_site_mappings
       SET site_option_text = @site_option_text,
           site_option_value = @site_option_value,
           match_status = @match_status,
           last_checked_at = @now,
           updated_at = @now
       WHERE period_id = @period_id AND kode_skp = @kode_skp`
    )
    .run({ ...payload, period_id: getActivePeriod().id, now: nowIso() });
}

export function saveSkpPlanAsMaster(plan: SkpPlanParseResult): SkpPlanSummary {
  const now = nowIso();
  const year = plan.profile.tahun || Number(plan.profile.periodeMulai.slice(0, 4)) || 2026;
  const periodId = `period-${year}`;
  const label = plan.profile.periodeMulai && plan.profile.periodeAkhir ? `SKP ${year}` : `SKP Tahun ${year}`;
  const oldMappings = getDb()
    .prepare(
      `SELECT m.kode_skp, m.site_option_text, m.site_option_value, m.match_status, i.nama_skp
       FROM skp_site_mappings m
       LEFT JOIN skp_items i ON i.period_id = m.period_id AND i.kode_skp = m.kode_skp
       WHERE m.period_id = ?`
    )
    .all(getActivePeriod().id) as Array<{
      kode_skp: string;
      nama_skp: string | null;
      site_option_text: string | null;
      site_option_value: string | null;
      match_status: string;
    }>;

  const tx = getDb().transaction(() => {
    getDb().prepare("UPDATE skp_periods SET is_active = 0, updated_at = ?").run(now);
    getDb()
      .prepare(
        `INSERT INTO skp_periods (id, year, start_date, end_date, label, is_active, created_at, updated_at)
         VALUES (@id, @year, @start_date, @end_date, @label, 1, @now, @now)
         ON CONFLICT(id) DO UPDATE SET
           year = excluded.year,
           start_date = excluded.start_date,
           end_date = excluded.end_date,
           label = excluded.label,
           is_active = 1,
           updated_at = excluded.updated_at`
      )
      .run({
        id: periodId,
        year,
        start_date: plan.profile.periodeMulai || `${year}-01-01`,
        end_date: plan.profile.periodeAkhir || `${year}-12-31`,
        label,
        now
      });

    getDb().prepare("DELETE FROM skp_items WHERE period_id = ?").run(periodId);
    getDb().prepare("DELETE FROM skp_site_mappings WHERE period_id = ?").run(periodId);
    getDb().prepare("DELETE FROM skp_plans WHERE period_id = ?").run(periodId);

    const insertSkp = getDb().prepare(
      `INSERT INTO skp_items
        (id, period_id, kode_skp, nama_skp, penugasan_dari, indikator_json, is_active, created_at, updated_at)
       VALUES (@id, @period_id, @kode_skp, @nama_skp, NULL, @indikator_json, 1, @now, @now)`
    );
    const insertMapping = getDb().prepare(
      `INSERT INTO skp_site_mappings
        (id, period_id, kode_skp, local_skp_name, site_option_text, site_option_value, match_status, last_checked_at, created_at, updated_at)
       VALUES (@id, @period_id, @kode_skp, @local_skp_name, @site_option_text, @site_option_value, @match_status, NULL, @now, @now)`
    );

    for (const item of plan.skpItems) {
      const preserved = findPreservedMapping(item.kode_skp, item.nama_skp, oldMappings);
      insertSkp.run({
        id: `skp-${periodId}-${item.kode_skp}`,
        period_id: periodId,
        kode_skp: item.kode_skp,
        nama_skp: item.nama_skp,
        indikator_json: JSON.stringify(item.indikator ?? []),
        now
      });
      insertMapping.run({
        id: `mapping-${periodId}-${item.kode_skp}`,
        period_id: periodId,
        kode_skp: item.kode_skp,
        local_skp_name: item.nama_skp,
        site_option_text: preserved?.site_option_text ?? null,
        site_option_value: preserved?.site_option_value ?? null,
        match_status: preserved ? preserved.match_status : "needs_review",
        now
      });
    }

    getDb()
      .prepare(
        `INSERT INTO skp_plans (id, period_id, source_file, profile_json, raw_text_hash, imported_at, created_at, updated_at)
         VALUES (@id, @period_id, @source_file, @profile_json, NULL, @now, @now, @now)`
      )
      .run({
        id: randomUUID(),
        period_id: periodId,
        source_file: plan.fileName,
        profile_json: JSON.stringify(plan.profile),
        now
      });

    getDb().prepare("DELETE FROM calendar_days WHERE period_id = ?").run(periodId);
    generateCalendarDays(periodId, plan.profile.periodeMulai || `${year}-01-01`, plan.profile.periodeAkhir || `${year}-12-31`);
    setSetting("active_year", String(year));
    if (plan.profile.periodeMulai) setSetting("local_managed_start_date", plan.profile.periodeMulai);
  });
  tx();

  addHistory("skp_plan.imported", "Rencana SKP disimpan", `${plan.skpItems.length} master SKP aktif diperbarui dari ${plan.fileName}.`, "success");
  return getActiveSkpPlanSummary();
}

function findPreservedMapping(
  kodeSkp: string,
  namaSkp: string,
  oldMappings: Array<{
    kode_skp: string;
    nama_skp: string | null;
    site_option_text: string | null;
    site_option_value: string | null;
    match_status: string;
  }>
): { site_option_text: string | null; site_option_value: string | null; match_status: string } | null {
  const normalizedName = normalizeSkpText(namaSkp);
  const match =
    oldMappings.find((item) => item.kode_skp === kodeSkp && normalizeSkpText(item.nama_skp ?? "") === normalizedName && ["matched", "manual", "partial"].includes(item.match_status)) ??
    oldMappings.find((item) => normalizeSkpText(item.nama_skp ?? "") === normalizedName && ["matched", "manual", "partial"].includes(item.match_status));
  if (!match?.site_option_text && !match?.site_option_value) return null;
  return {
    site_option_text: match.site_option_text,
    site_option_value: match.site_option_value,
    match_status: match.match_status
  };
}

function normalizeSkpText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function listDailyLogs(filters: Record<string, string | undefined> = {}): DailyLog[] {
  const { clauses, params } = buildDailyLogWhere(filters);
  const order = buildDailyLogOrder(filters.sort);
  return getDb()
    .prepare(`SELECT * FROM daily_logs WHERE ${clauses.join(" AND ")} ${order}`)
    .all(params) as DailyLog[];
}

export function listDailyLogsPage(filters: Record<string, string | undefined> = {}): {
  data: DailyLog[];
  summary: {
    total: number;
    submitted: number;
    notSubmitted: number;
    failed: number;
    needsReview: number;
  };
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
} {
  const page = Math.max(1, Number(filters.page || 1));
  const requestedPageSize = Math.max(1, Number(filters.pageSize || 20));
  const pageSize = Math.min(20, requestedPageSize);
  const offset = (page - 1) * pageSize;
  const { clauses, params } = buildDailyLogWhere(filters);
  const order = buildDailyLogOrder(filters.sort);
  const total = (
    getDb()
      .prepare(`SELECT COUNT(*) as c FROM daily_logs WHERE ${clauses.join(" AND ")}`)
      .get(params) as { c: number }
  ).c;
  const summary = getDb()
    .prepare(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN status_skp IN ('submitted','manual_marked_submitted') THEN 1 ELSE 0 END) as submitted,
         SUM(CASE WHEN status_skp NOT IN ('submitted','manual_marked_submitted','failed') THEN 1 ELSE 0 END) as notSubmitted,
         SUM(CASE WHEN status_skp = 'failed' THEN 1 ELSE 0 END) as failed,
         SUM(CASE WHEN status_local IN ('invalid','needs_review') THEN 1 ELSE 0 END) as needsReview
       FROM daily_logs
       WHERE ${clauses.join(" AND ")}`
    )
    .get(params) as { total: number; submitted: number | null; notSubmitted: number | null; failed: number | null; needsReview: number | null };
  const data = getDb()
    .prepare(`SELECT * FROM daily_logs WHERE ${clauses.join(" AND ")} ${order} LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: pageSize, offset }) as DailyLog[];
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    data,
    summary: {
      total: Number(summary.total ?? 0),
      submitted: Number(summary.submitted ?? 0),
      notSubmitted: Number(summary.notSubmitted ?? 0),
      failed: Number(summary.failed ?? 0),
      needsReview: Number(summary.needsReview ?? 0)
    },
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

function buildDailyLogWhere(filters: Record<string, string | undefined>): { clauses: string[]; params: Record<string, string> } {
  const clauses = ["period_id = @period_id"];
  const params: Record<string, string> = { period_id: getActivePeriod().id };
  if (filters.year) {
    clauses.push("substr(tanggal, 1, 4) = @year");
    params.year = filters.year;
  }
  if (filters.month) {
    clauses.push("substr(tanggal, 1, 7) = @month");
    params.month = filters.month;
  }
  if (filters.status_local && filters.status_local !== "all") {
    clauses.push("status_local = @status_local");
    params.status_local = filters.status_local;
  }
  if (filters.status_skp && filters.status_skp !== "all") {
    clauses.push("status_skp = @status_skp");
    params.status_skp = filters.status_skp;
  }
  if (filters.status && filters.status !== "all") {
    clauses.push("(status_local = @status OR status_skp = @status)");
    params.status = filters.status;
  }
  const skpFilter = filters.kode_skp ?? filters.skp;
  if (skpFilter && skpFilter !== "all") {
    clauses.push("kode_skp = @kode_skp");
    params.kode_skp = skpFilter;
  }
  if (filters.dateFrom) {
    clauses.push("tanggal >= @dateFrom");
    params.dateFrom = filters.dateFrom;
  }
  if (filters.dateTo) {
    clauses.push("tanggal <= @dateTo");
    params.dateTo = filters.dateTo;
  }
  if (filters.keyword) {
    clauses.push(
      "(kode_log LIKE @keyword OR nama_aktivitas LIKE @keyword OR deskripsi LIKE @keyword OR kode_skp LIKE @keyword OR nama_skp LIKE @keyword OR satuan LIKE @keyword OR link_tautan LIKE @keyword)"
    );
    params.keyword = `%${filters.keyword}%`;
  }
  return { clauses, params };
}

function buildDailyLogOrder(sort?: string): string {
  if (sort === "tanggal_desc") return "ORDER BY tanggal DESC, kode_log DESC";
  if (sort === "status") return "ORDER BY status_local ASC, status_skp ASC, tanggal ASC, kode_log ASC";
  if (sort === "skp") return "ORDER BY kode_skp ASC, tanggal ASC, kode_log ASC";
  return "ORDER BY tanggal ASC, kode_log ASC";
}

export function getDailyLog(id: string): DailyLog | undefined {
  return getDb().prepare("SELECT * FROM daily_logs WHERE id = ?").get(id) as DailyLog | undefined;
}

export function upsertDailyLog(input: Partial<DailyLog>): DailyLog {
  const periodId = input.period_id ?? getActivePeriod().id;
  const now = nowIso();
  const tanggal = input.tanggal;
  if (!tanggal) {
    throw new Error("Tanggal wajib diisi.");
  }
  const skpItem = input.kode_skp
    ? (getDb()
        .prepare("SELECT kode_skp, nama_skp FROM skp_items WHERE period_id = ? AND kode_skp = ?")
        .get(periodId, input.kode_skp) as { kode_skp: string; nama_skp: string } | undefined)
    : undefined;
  const statusLocal = input.status_local ?? (input.kode_skp ? "valid" : "needs_review");
  const row = {
    id: input.id ?? randomUUID(),
    period_id: periodId,
    kode_log: input.kode_log || nextKodeLog(periodId, tanggal),
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
    status_skp: input.status_skp ?? (tanggal > toDateKey() ? "waiting_date" : "not_submitted"),
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
    created_at: input.created_at ?? now,
    updated_at: now
  };

  if (!row.kode_log) {
    throw new Error("Kode log gagal dibuat.");
  }

  getDb()
    .prepare(
      `INSERT INTO daily_logs
        (id, period_id, kode_log, tanggal, kode_skp, nama_skp, nama_aktivitas, deskripsi, indikator_kinerja_individu, kuantitas_output, satuan, link_tautan,
         status_local, status_skp, reason_type, reason_note, source_file, source_hash, last_sync_at, last_error, last_error_code, current_url, automation_step, screenshot_path, created_at, updated_at)
       VALUES
        (@id, @period_id, @kode_log, @tanggal, @kode_skp, @nama_skp, @nama_aktivitas, @deskripsi, @indikator_kinerja_individu, @kuantitas_output, @satuan, @link_tautan,
         @status_local, @status_skp, @reason_type, @reason_note, @source_file, @source_hash, @last_sync_at, @last_error, @last_error_code, @current_url, @automation_step, @screenshot_path, @created_at, @updated_at)
       ON CONFLICT(period_id, kode_log) DO UPDATE SET
         tanggal = excluded.tanggal,
         kode_skp = excluded.kode_skp,
         nama_skp = excluded.nama_skp,
         nama_aktivitas = excluded.nama_aktivitas,
         deskripsi = excluded.deskripsi,
         indikator_kinerja_individu = excluded.indikator_kinerja_individu,
         kuantitas_output = excluded.kuantitas_output,
         satuan = excluded.satuan,
         link_tautan = excluded.link_tautan,
         status_local = excluded.status_local,
         status_skp = excluded.status_skp,
         reason_type = excluded.reason_type,
         reason_note = excluded.reason_note,
         source_file = excluded.source_file,
         source_hash = excluded.source_hash,
          last_error = excluded.last_error,
          last_error_code = excluded.last_error_code,
          current_url = excluded.current_url,
          automation_step = excluded.automation_step,
         screenshot_path = excluded.screenshot_path,
         updated_at = excluded.updated_at`
    )
    .run(row);

  refreshCalendarForDate(row.tanggal);
  return getDb().prepare("SELECT * FROM daily_logs WHERE period_id = ? AND kode_log = ?").get(periodId, row.kode_log) as DailyLog;
}

function nextKodeLog(periodId: string, tanggal: string): string {
  const like = `LOG-${tanggal}-%`;
  const rows = getDb()
    .prepare("SELECT kode_log FROM daily_logs WHERE period_id = ? AND tanggal = ? AND kode_log LIKE ?")
    .all(periodId, tanggal, like) as Array<{ kode_log: string }>;
  const max = rows.reduce((current, row) => {
    const suffix = Number(row.kode_log.slice(-2));
    return Number.isFinite(suffix) ? Math.max(current, suffix) : current;
  }, 0);
  return `LOG-${tanggal}-${String(max + 1).padStart(2, "0")}`;
}

export function deleteDailyLog(id: string): DeleteLogsResult {
  const log = getDailyLog(id);
  if (!log) return { success: true, deletedCount: 0, remainingCount: countDailyLogs() };
  const tx = getDb().transaction(() => {
    getDb().prepare("DELETE FROM sync_job_items WHERE daily_log_id = ?").run(id);
    getDb().prepare("DELETE FROM daily_logs WHERE id = ?").run(id);
    deleteOrphanSyncJobs();
  });
  tx();
  refreshCalendarForDate(log.tanggal);
  addHistory("log.deleted", "Log lokal dihapus", `${log.kode_log} dihapus dari database lokal.`, "warning", "daily_log", id);
  return { success: true, deletedCount: 1, remainingCount: countDailyLogs() };
}

export type DeleteLogsResult = { success: true; deletedCount: number; remainingCount: number };

export function deleteDailyLogsBulk(ids: string[]): DeleteLogsResult {
  const uniqueIds = Array.from(new Set(ids.map((id) => String(id || "").trim()).filter(Boolean)));
  if (uniqueIds.length === 0) return { success: true, deletedCount: 0, remainingCount: countDailyLogs() };

  const placeholders = uniqueIds.map(() => "?").join(",");
  const logs = getDb()
    .prepare(`SELECT id, period_id, tanggal FROM daily_logs WHERE id IN (${placeholders})`)
    .all(...uniqueIds) as Array<{ id: string; period_id: string; tanggal: string }>;
  if (logs.length === 0) return { success: true, deletedCount: 0, remainingCount: countDailyLogs() };

  const logIds = logs.map((log) => log.id);
  const deletePlaceholders = logIds.map(() => "?").join(",");
  const tx = getDb().transaction(() => {
    getDb().prepare(`DELETE FROM sync_job_items WHERE daily_log_id IN (${deletePlaceholders})`).run(...logIds);
    getDb().prepare(`DELETE FROM daily_logs WHERE id IN (${deletePlaceholders})`).run(...logIds);
    deleteOrphanSyncJobs();
  });
  tx();

  for (const date of new Set(logs.map((log) => log.tanggal))) refreshCalendarForDate(date);
  addHistory("log.bulk_deleted", "Log lokal terpilih dihapus", `${logs.length} data log lokal dihapus.`, "warning");
  return { success: true, deletedCount: logs.length, remainingCount: countDailyLogs() };
}

export function deleteAllDailyLogsLocal(confirm: string): DeleteLogsResult {
  if (confirm !== "HAPUS") {
    throw new Error('Konfirmasi tidak sesuai. Ketik "HAPUS" untuk menghapus semua data log lokal.');
  }

  const period = getActivePeriod();
  const count = countDailyLogs();
  const tx = getDb().transaction(() => {
    getDb().prepare("DELETE FROM sync_job_items").run();
    getDb().prepare("DELETE FROM sync_jobs").run();
    getDb().prepare("DELETE FROM daily_logs").run();
    getDb().prepare("DELETE FROM calendar_days WHERE period_id = ?").run(period.id);
  });
  tx();
  generateCalendarDays(period.id, period.start_date, period.end_date);
  addHistory("log.all_deleted", "Semua log lokal dihapus", `${count} data log lokal dihapus.`, "warning");
  return { success: true, deletedCount: count, remainingCount: countDailyLogs() };
}

function countDailyLogs(): number {
  return (getDb().prepare("SELECT COUNT(*) as c FROM daily_logs").get() as { c: number }).c;
}

function deleteOrphanSyncJobs(): void {
  getDb().prepare("DELETE FROM sync_jobs WHERE id NOT IN (SELECT DISTINCT job_id FROM sync_job_items)").run();
}

export function updateDailyLogStatus(
  id: string,
  statusLocal: StatusLocal,
  statusSkp: StatusSkp,
  message?: string,
  errorCode?: string,
  details: { automationStep?: string | null; screenshotPath?: string | null; currentUrl?: string | null } = {}
): void {
  const log = getDailyLog(id);
  getDb()
    .prepare(
      `UPDATE daily_logs
       SET status_local = @status_local,
           status_skp = @status_skp,
           last_sync_at = @last_sync_at,
           last_error = @last_error,
           last_error_code = @last_error_code,
           current_url = @current_url,
           automation_step = @automation_step,
           screenshot_path = @screenshot_path,
           updated_at = @updated_at
       WHERE id = @id`
    )
    .run({
      id,
      status_local: statusLocal,
      status_skp: statusSkp,
      last_sync_at: nowIso(),
      last_error: message ?? null,
      last_error_code: errorCode ?? null,
      current_url: details.currentUrl ?? null,
      automation_step: details.automationStep ?? null,
      screenshot_path: details.screenshotPath ?? null,
      updated_at: nowIso()
    });
  if (log) refreshCalendarForDate(log.tanggal);
}

export function updateDailyLogValidationStatus(
  id: string,
  statusLocal: StatusLocal,
  reasonType: string | null,
  reasonNote: string | null
): DailyLog | undefined {
  const log = getDailyLog(id);
  if (!log) return undefined;
  getDb()
    .prepare(
      `UPDATE daily_logs
       SET status_local = @status_local,
           reason_type = @reason_type,
           reason_note = @reason_note,
           updated_at = @updated_at
       WHERE id = @id`
    )
    .run({
      id,
      status_local: statusLocal,
      reason_type: reasonType,
      reason_note: reasonNote,
      updated_at: nowIso()
    });
  refreshCalendarForDate(log.tanggal);
  return getDailyLog(id);
}

export function markCalendarDate(date: string, status: string, reasonType: string, reasonNote: string): void {
  const periodId = getActivePeriod().id;
  getDb()
    .prepare(
      `INSERT INTO calendar_days
        (id, period_id, date, day_name, is_weekend, is_public_holiday, is_leave, holiday_name, status, reason_type, reason_note, created_at, updated_at)
       VALUES (@id, @period_id, @date, @day_name, @is_weekend, @is_public_holiday, @is_leave, @holiday_name, @status, @reason_type, @reason_note, @now, @now)
       ON CONFLICT(period_id, date) DO UPDATE SET
         status = excluded.status,
         reason_type = excluded.reason_type,
         reason_note = excluded.reason_note,
         is_public_holiday = excluded.is_public_holiday,
         is_leave = excluded.is_leave,
         holiday_name = excluded.holiday_name,
         updated_at = excluded.updated_at`
    )
    .run({
      id: `day-${periodId}-${date}`,
      period_id: periodId,
      date,
      day_name: getDayName(date),
      is_weekend: isWeekend(date) ? 1 : 0,
      is_public_holiday: reasonType === "public_holiday" ? 1 : 0,
      is_leave: ["leave", "sick_leave"].includes(reasonType) ? 1 : 0,
      holiday_name: reasonNote,
      status,
      reason_type: reasonType,
      reason_note: reasonNote,
      now: nowIso()
    });
}

export function refreshCalendarForDate(date: string): void {
  const periodId = getActivePeriod().id;
  const logs = getDb().prepare("SELECT * FROM daily_logs WHERE period_id = ? AND tanggal = ?").all(periodId, date) as DailyLog[];
  const submitted = logs.some((log) => ["submitted", "manual_marked_submitted"].includes(log.status_skp));
  const failed = logs.some((log) => log.status_skp === "failed");
  const review = logs.some((log) => log.status_local === "needs_review" || log.status_local === "invalid");
  const hasReady = logs.some((log) => ["ready", "not_submitted"].includes(log.status_skp) && log.status_local === "valid");

  let status = date > toDateKey() ? "future" : "missing";
  let reasonType: string | null = date > toDateKey() ? null : "no_work_plan";
  let reasonNote: string | null = date > toDateKey() ? null : "Belum ada rencana kerja";

  if (isWeekend(date) && getSetting("weekend_is_holiday", "true") === "true") {
    status = "weekend";
    reasonType = "weekend";
    reasonNote = "Akhir pekan";
  }
  if (logs.length > 0) {
    status = submitted ? "submitted" : failed ? "failed" : review ? "needs_review" : hasReady ? "has_log" : "has_log";
    reasonType = null;
    reasonNote = null;
  }

  markCalendarDate(date, status, reasonType ?? "other", reasonNote ?? "");
}

export function listCalendarStatus(month?: string): CalendarDay[] {
  const period = getActivePeriod();
  const params: Record<string, string> = { period_id: period.id };
  const where = ["period_id = @period_id"];
  if (month) {
    where.push("substr(date, 1, 7) = @month");
    params.month = month;
  }
  return getDb()
    .prepare(`SELECT * FROM calendar_days WHERE ${where.join(" AND ")} ORDER BY date ASC`)
    .all(params) as CalendarDay[];
}

export function listActiveHolidays(): Array<{ date: string; name: string; isJointLeave: boolean; source: string; isActive: boolean }> {
  const period = getActivePeriod();
  const rows = getDb()
    .prepare(
      `SELECT date, COALESCE(holiday_name, reason_note, 'Tanggal merah') as name, is_leave, reason_type
       FROM calendar_days
       WHERE period_id = ?
         AND (is_public_holiday = 1 OR is_leave = 1 OR status IN ('public_holiday','leave','sick_leave'))
       ORDER BY date ASC`
    )
    .all(period.id) as Array<{ date: string; name: string | null; is_leave: number; reason_type: string | null }>;
  return rows.map((row) => ({
    date: row.date,
    name: row.name || "Tanggal merah",
    isJointLeave: row.is_leave === 1 || row.reason_type === "leave",
    source: "local_calendar",
    isActive: true
  }));
}

export function getCalendarDetail(date: string): { day: CalendarDay | undefined; logs: DailyLog[] } {
  const periodId = getActivePeriod().id;
  return {
    day: getDb().prepare("SELECT * FROM calendar_days WHERE period_id = ? AND date = ?").get(periodId, date) as CalendarDay | undefined,
    logs: getDb().prepare("SELECT * FROM daily_logs WHERE period_id = ? AND tanggal = ? ORDER BY kode_log").all(periodId, date) as DailyLog[]
  };
}

type ActiveSyncQueueItem = {
  id: string;
  jobId: string;
  dailyLogId: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export function hasActiveSyncForLog(logId: string): boolean {
  return Boolean(getActiveSyncForLogIds([logId]));
}

export function getTodayLogStatus(sessionStatus: string = getSkpSessionStatus().status): TodayLogStatus {
  const period = getActivePeriod();
  const today = toDateKey();
  const logs = getDb()
    .prepare("SELECT * FROM daily_logs WHERE period_id = ? AND tanggal = ? ORDER BY kode_log ASC")
    .all(period.id, today) as DailyLog[];
  const activeQueue = getActiveSyncForLogIds(logs.map((log) => log.id));
  const state = resolveTodayLogState(logs, activeQueue);
  const selectedLog = selectTodayLog(logs, state, activeQueue);
  const requiresLogin = ["not_submitted", "failed"].includes(state) && sessionStatus !== "connected";
  const canSubmit = ["not_submitted", "failed"].includes(state) && !requiresLogin;

  return {
    success: true,
    date: today,
    displayDate: `${capitalizeText(getDayName(today))}, ${formatLongDate(today)}`,
    hasLog: logs.length > 0,
    logCount: logs.length,
    state,
    sessionStatus,
    requiresLogin,
    canSubmit,
    message: todayLogMessage(state, selectedLog, requiresLogin),
    activeQueue,
    log: selectedLog ? toTodayLogPayload(selectedLog) : null
  };
}

function getActiveSyncForLogIds(logIds: string[]): ActiveSyncQueueItem | null {
  const uniqueIds = Array.from(new Set(logIds.filter(Boolean)));
  if (uniqueIds.length === 0) return null;
  const params = Object.fromEntries(uniqueIds.map((id, index) => [`id${index}`, id]));
  const placeholders = uniqueIds.map((_, index) => `@id${index}`).join(", ");
  const row = getDb()
    .prepare(
      `SELECT
         i.id,
         i.job_id as jobId,
         i.daily_log_id as dailyLogId,
         i.status,
         i.started_at as startedAt,
         i.finished_at as finishedAt
       FROM sync_job_items i
       LEFT JOIN sync_jobs j ON j.id = i.job_id
       WHERE i.daily_log_id IN (${placeholders})
         AND i.status IN ('queued','running')
         AND COALESCE(j.status, 'running') NOT IN ('finished','finished_with_error','stopped')
       ORDER BY
         CASE WHEN i.status = 'running' THEN 0 ELSE 1 END,
         COALESCE(i.started_at, j.started_at, j.created_at) DESC
       LIMIT 1`
    )
    .get(params) as ActiveSyncQueueItem | undefined;
  return row ?? null;
}

function resolveTodayLogState(logs: DailyLog[], activeQueue: ActiveSyncQueueItem | null): TodayLogState {
  if (logs.length === 0) return "no_log";
  if (activeQueue?.status === "running") return "running";
  if (activeQueue?.status === "queued") return "queued";
  if (logs.some((log) => log.tanggal > toDateKey())) return "future";
  if (logs.some((log) => ["failed", "not_allowed_by_site"].includes(log.status_skp))) return "failed";
  if (logs.some((log) => !isSuccessfulSkpStatus(log.status_skp) && (log.status_local === "invalid" || log.status_local === "needs_review" || !isSkpMappingReady(log)))) return "needs_review";
  if (logs.some((log) => !isSuccessfulSkpStatus(log.status_skp))) return "not_submitted";
  return "submitted";
}

function selectTodayLog(logs: DailyLog[], state: TodayLogState, activeQueue: ActiveSyncQueueItem | null): DailyLog | null {
  if (logs.length === 0) return null;
  const activeLog = logs.find((log) => log.id === activeQueue?.dailyLogId);
  if (activeLog) return activeLog;
  if (state === "failed") return logs.find((log) => ["failed", "not_allowed_by_site"].includes(log.status_skp)) ?? logs[0];
  if (state === "needs_review") {
    return logs.find((log) => !isSuccessfulSkpStatus(log.status_skp) && (log.status_local === "invalid" || log.status_local === "needs_review" || !isSkpMappingReady(log))) ?? logs[0];
  }
  if (state === "not_submitted") return logs.find((log) => !isSuccessfulSkpStatus(log.status_skp)) ?? logs[0];
  return logs[0];
}

function toTodayLogPayload(log: DailyLog): TodayLogStatus["log"] {
  return {
    id: log.id,
    tanggal: log.tanggal,
    namaAktivitas: log.nama_aktivitas,
    deskripsi: log.deskripsi,
    kodeSkp: log.kode_skp,
    namaSkp: log.nama_skp,
    statusLocal: log.status_local,
    statusSkp: log.status_skp,
    lastSyncAt: log.last_sync_at,
    lastError: log.last_error,
    lastErrorCode: log.last_error_code,
    currentUrl: log.current_url,
    automationStep: log.automation_step,
    screenshotPath: log.screenshot_path
  };
}

function todayLogMessage(state: TodayLogState, log: DailyLog | null, requiresLogin: boolean): string {
  if (requiresLogin) return "Login SKP diperlukan sebelum log hari ini bisa dikirim.";
  if (state === "no_log") return "Belum ada data log untuk tanggal hari ini.";
  if (state === "not_submitted") return "Log hari ini sudah tersedia dan belum masuk SKP.";
  if (state === "queued") return "Log hari ini sedang menunggu proses kirim.";
  if (state === "running") return "Sistem sedang mengirim log hari ini ke SKP.";
  if (state === "submitted") return "Log hari ini sudah masuk SKP.";
  if (state === "failed") return summarizeErrorText(log?.last_error) || "Log hari ini gagal dikirim.";
  if (state === "future") return "Log hari ini belum masuk waktu pengiriman.";
  return log?.reason_note ?? "Log hari ini perlu dicek sebelum dikirim.";
}

function summarizeErrorText(value?: string | null): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return String(parsed.error_message ?? parsed.message ?? "Log hari ini gagal dikirim.");
  } catch {
    return text;
  }
}

function isSuccessfulSkpStatus(status?: string | null): boolean {
  return SUCCESSFUL_SKP_STATUSES.includes(String(status ?? "").toLowerCase());
}

function capitalizeText(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

export function getMonthlySuccessData(yearInput = 2026): MonthlySuccessData {
  const year = Number.isFinite(yearInput) ? Math.trunc(yearInput) : 2026;
  const period = getDb().prepare("SELECT id FROM skp_periods WHERE year = ? LIMIT 1").get(year) as { id: string } | undefined;
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;
  const params: Record<string, string | number> = {
    startDate,
    endDate,
    ...Object.fromEntries(SUCCESSFUL_SKP_STATUSES.map((status, index) => [`status${index}`, status]))
  };
  const where = ["tanggal >= @startDate", "tanggal <= @endDate", "length(tanggal) >= 10"];

  if (period) {
    where.push("period_id = @periodId");
    params.periodId = period.id;
  }

  const successPlaceholders = SUCCESSFUL_SKP_STATUSES.map((_, index) => `@status${index}`).join(", ");
  const rows = getDb()
    .prepare(
      `SELECT
         CAST(substr(tanggal, 6, 2) AS INTEGER) as month,
         COUNT(*) as totalCount,
         SUM(CASE WHEN lower(status_skp) IN (${successPlaceholders}) THEN 1 ELSE 0 END) as successCount
       FROM daily_logs
       WHERE ${where.join(" AND ")}
       GROUP BY month`
    )
    .all(params) as Array<{ month: number; totalCount: number; successCount: number | null }>;

  const byMonth = new Map(rows.map((row) => [Number(row.month), row]));
  const months = MONTH_LABELS_ID.map((label, index) => {
    const month = index + 1;
    const row = byMonth.get(month);
    const totalCount = Number(row?.totalCount ?? 0);
    const successCount = Number(row?.successCount ?? 0);
    return {
      month,
      label,
      successCount,
      totalCount,
      successRate: totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 0
    };
  });
  const totalSuccess = months.reduce((total, month) => total + month.successCount, 0);
  const bestMonth = totalSuccess > 0 ? months.reduce((best, month) => (month.successCount > best.successCount ? month : best), months[0]) : null;

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

export function getDashboardData(sessionStatus: string): Record<string, unknown> {
  const period = getActivePeriod();
  const today = toDateKey();
  const localStart = getSetting("local_managed_start_date", period.start_date);
  const successPlaceholders = SUCCESSFUL_SKP_STATUSES.map((_, index) => `@status${index}`).join(", ");
  const syncParams = {
    period_id: period.id,
    ...Object.fromEntries(SUCCESSFUL_SKP_STATUSES.map((status, index) => [`status${index}`, status]))
  };
  const syncRow = getDb()
    .prepare(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN lower(COALESCE(status_skp, '')) IN (${successPlaceholders}) THEN 1 ELSE 0 END) as submitted,
         SUM(CASE
           WHEN lower(COALESCE(status_skp, '')) NOT IN (${successPlaceholders})
            AND (
              lower(COALESCE(status_skp, '')) = 'failed'
              OR lower(COALESCE(status_local, '')) IN ('invalid','needs_review')
            )
           THEN 1 ELSE 0 END) as failed
       FROM daily_logs
       WHERE period_id = @period_id`
    )
    .get(syncParams) as { total: number; submitted: number | null; failed: number | null };
  const syncTotal = Number(syncRow.total ?? 0);
  const syncSubmitted = Number(syncRow.submitted ?? 0);
  const syncFailed = Number(syncRow.failed ?? 0);
  const syncWaiting = Math.max(0, syncTotal - syncSubmitted - syncFailed);
  const counts = {
    today: (getDb().prepare("SELECT COUNT(*) as c FROM daily_logs WHERE period_id = ? AND tanggal = ?").get(period.id, today) as { c: number }).c,
    unfilled: (
      getDb()
        .prepare("SELECT COUNT(*) as c FROM daily_logs WHERE period_id = ? AND tanggal >= ? AND tanggal <= ? AND status_skp IN ('ready','not_submitted','failed')")
        .get(period.id, localStart, today) as { c: number }
    ).c,
    missed: (
      getDb()
        .prepare("SELECT COUNT(*) as c FROM daily_logs WHERE period_id = ? AND tanggal >= ? AND tanggal < ? AND status_skp IN ('ready','not_submitted')")
        .get(period.id, localStart, today) as { c: number }
    ).c,
    submitted: (
      getDb()
        .prepare("SELECT COUNT(*) as c FROM daily_logs WHERE period_id = ? AND status_skp IN ('submitted','manual_marked_submitted')")
        .get(period.id) as { c: number }
    ).c,
    submittedThisMonth: (
      getDb()
        .prepare(
          "SELECT COUNT(*) as c FROM daily_logs WHERE period_id = ? AND substr(tanggal, 1, 7) = substr(?, 1, 7) AND status_skp IN ('submitted','manual_marked_submitted')"
        )
        .get(period.id, today) as { c: number }
    ).c,
    failed: (getDb().prepare("SELECT COUNT(*) as c FROM daily_logs WHERE period_id = ? AND tanggal >= ? AND status_skp = 'failed'").get(period.id, localStart) as { c: number }).c,
    waiting: (getDb().prepare("SELECT COUNT(*) as c FROM daily_logs WHERE period_id = ? AND status_skp = 'waiting_date'").get(period.id) as { c: number }).c,
    offDays: (
      getDb()
        .prepare("SELECT COUNT(*) as c FROM calendar_days WHERE period_id = ? AND status IN ('weekend','public_holiday','leave','sick_leave','no_plan')")
        .get(period.id) as { c: number }
    ).c,
    review: (
      getDb()
        .prepare("SELECT COUNT(*) as c FROM daily_logs WHERE period_id = ? AND tanggal >= ? AND status_local IN ('invalid','needs_review')")
        .get(period.id, localStart) as { c: number }
    ).c,
    syncTotal,
    syncSubmitted,
    syncWaiting,
    syncFailed,
    attention: (
      getDb()
        .prepare(
          `SELECT COUNT(DISTINCT l.id) as c
           FROM daily_logs l
           LEFT JOIN skp_site_mappings m ON m.period_id = l.period_id AND m.kode_skp = l.kode_skp
           WHERE l.period_id = @period_id
             AND l.tanggal >= @local_start
             AND (
               l.status_skp = 'failed'
               OR l.status_local IN ('invalid','needs_review')
               OR (l.tanggal < @today AND l.status_skp IN ('ready','not_submitted'))
               OR COALESCE(m.match_status, 'needs_review') IN ('needs_review','not_found')
             )`
        )
        .get({ period_id: period.id, today, local_start: localStart }) as { c: number }
    ).c
  };

  const todayLog = getDb().prepare("SELECT * FROM daily_logs WHERE period_id = ? AND tanggal = ? ORDER BY kode_log LIMIT 1").get(period.id, today) as
    | DailyLog
    | undefined;
  const todayDay = getCalendarDetail(today).day;
  const autoPost = getNextAutoPostAt(
    new Date(),
    {
      enabled: getSetting("auto_post_enabled", "true") === "true",
      postTime: getSetting("auto_run_start_time", "08:00"),
      timezone: getSetting("auto_post_timezone", "Asia/Jakarta"),
      activeWeekdays: getSetting("auto_post_active_weekdays", "1,2,3,4,5")
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value))
    },
    listActiveHolidays()
  );
  const problems = getDb()
    .prepare(
      `SELECT
         l.tanggal,
         CASE
           WHEN l.status_skp = 'failed' THEN 'failed'
           WHEN l.status_local IN ('invalid','needs_review') THEN 'needs_review'
           WHEN COALESCE(m.match_status, 'matched') IN ('needs_review','not_found') THEN 'needs_review'
           ELSE 'ready'
         END as status,
         CASE
           WHEN l.status_skp = 'failed' THEN COALESCE(l.last_error, 'Submit ke SKP gagal.')
           WHEN l.status_local IN ('invalid','needs_review') THEN COALESCE(l.reason_note, 'Log perlu direview.')
           WHEN COALESCE(m.match_status, 'matched') IN ('needs_review','not_found') THEN 'Mapping SKP belum cocok.'
           ELSE 'Tanggal kerja sudah lewat dan log belum terkirim.'
         END as alasan
      FROM daily_logs l
      LEFT JOIN skp_site_mappings m ON m.period_id = l.period_id AND m.kode_skp = l.kode_skp
      WHERE l.period_id = @period_id
        AND l.tanggal >= @local_start
        AND (
           l.status_skp = 'failed'
           OR l.status_local IN ('invalid','needs_review')
           OR (l.tanggal < @today AND l.status_skp IN ('ready','not_submitted'))
           OR COALESCE(m.match_status, 'matched') IN ('needs_review','not_found')
         )
       ORDER BY l.tanggal DESC
       LIMIT 8`
    )
    .all({ period_id: period.id, today, local_start: localStart }) as Array<{ tanggal: string; status: string; alasan: string }>;

  return {
    sessionStatus,
    activeYear: period.year,
    periodLabel: `${period.start_date} - ${period.end_date}`,
    localManagedStartDate: localStart,
    nextAutoRun: `${getSetting("auto_run_start_time", "08:00")} WIB`,
    counts,
    today: {
      date: today,
      dayName: getDayName(today),
      status: todayLog?.status_skp ?? todayDay?.status ?? "missing",
      log: todayLog,
      reason: todayDay?.reason_note
    },
    problems: problems.map((problem) => ({
      ...problem,
      aksi: problem.status === "needs_review" ? "Review" : problem.status === "failed" ? "Retry" : "Buat/Edit"
    })),
    autoRun: {
      enabled: getSetting("auto_run_enabled", "false") === "true",
      startTime: getSetting("auto_run_start_time", "08:00"),
      retryInterval: Number(getSetting("retry_interval_minutes", "10")),
      retryUntil: getSetting("retry_until_time", "16:00"),
      lastStatus: getSetting("auto_run_last_status", "Belum jalan")
    },
    autoPost: {
      ...autoPost,
      workerStatus: getSetting("online_worker_status", "menunggu_secret_backend"),
      sessionStatus,
      lastJobStatus: getSetting("auto_run_last_status", "Belum ada job"),
      lastJobAt: getSetting("auto_run_last_attempt_at", "")
    },
    recentHistory: listHistory(6)
  };
}

export function addHistory(
  eventType: string,
  title: string,
  message: string | null,
  severity: "info" | "success" | "warning" | "error" = "info",
  entityType?: string,
  entityId?: string
): void {
  getDb()
    .prepare(
      `INSERT INTO activity_history
        (id, event_type, title, message, entity_type, entity_id, severity, created_at)
       VALUES (@id, @event_type, @title, @message, @entity_type, @entity_id, @severity, @created_at)`
    )
    .run({
      id: randomUUID(),
      event_type: eventType,
      title,
      message,
      entity_type: entityType ?? null,
      entity_id: entityId ?? null,
      severity,
      created_at: nowIso()
    });
}

export function listHistory(limit = 100): ActivityHistory[] {
  return getDb()
    .prepare("SELECT * FROM activity_history ORDER BY created_at DESC LIMIT ?")
    .all(limit) as ActivityHistory[];
}

export function listSyncQueue(limit = 200): Array<Record<string, unknown>> {
  return getDb()
    .prepare(
      `SELECT
         i.id,
         i.job_id,
         i.daily_log_id,
         i.tanggal,
         l.nama_aktivitas,
         l.kode_skp,
         l.nama_skp,
         i.status,
         i.attempt_count,
         i.error_code,
         i.error_message,
         i.screenshot_path,
         i.started_at,
         i.finished_at,
         j.job_type,
         j.created_at as job_created_at
       FROM sync_job_items i
       LEFT JOIN daily_logs l ON l.id = i.daily_log_id
       LEFT JOIN sync_jobs j ON j.id = i.job_id
       ORDER BY COALESCE(i.started_at, i.finished_at, j.created_at) DESC
       LIMIT ?`
    )
    .all(limit) as Array<Record<string, unknown>>;
}

export function listSyncHistory(limit = 200): Array<Record<string, unknown>> {
  return getDb()
    .prepare(
      `SELECT
         h.created_at as waktu,
         h.event_type as aksi,
         NULL as tanggal_log,
         h.severity as hasil,
         NULL as error_code,
         h.message as pesan,
         NULL as screenshot_error
       FROM activity_history h
       UNION ALL
       SELECT
         COALESCE(i.finished_at, i.started_at) as waktu,
         COALESCE(j.job_type, 'sync_item') as aksi,
         i.tanggal as tanggal_log,
         i.status as hasil,
         i.error_code,
         i.error_message as pesan,
         i.screenshot_path as screenshot_error
       FROM sync_job_items i
       LEFT JOIN sync_jobs j ON j.id = i.job_id
       ORDER BY waktu DESC
       LIMIT ?`
    )
    .all(limit) as Array<Record<string, unknown>>;
}

export function listLogSyncHistory(logId: string): Array<Record<string, unknown>> {
  return getDb()
    .prepare(
      `SELECT
         i.id,
         COALESCE(i.finished_at, i.started_at) as waktu,
         COALESCE(j.job_type, 'sync_item') as aksi,
         i.status as hasil,
         i.error_code,
         i.error_message as pesan,
         i.screenshot_path
       FROM sync_job_items i
       LEFT JOIN sync_jobs j ON j.id = i.job_id
       WHERE i.daily_log_id = ?
       ORDER BY waktu DESC`
    )
    .all(logId) as Array<Record<string, unknown>>;
}

export function markDailyLogSubmittedManual(id: string): DailyLog | undefined {
  updateDailyLogStatus(id, "valid", "manual_marked_submitted", "Ditandai terkirim manual oleh pengguna.");
  addHistory("log.manual_submitted", "Log ditandai terkirim manual", "Status SKP lokal diperbarui menjadi terkirim manual.", "success", "daily_log", id);
  return getDailyLog(id);
}

export function skipDailyLog(id: string): DailyLog | undefined {
  const log = getDailyLog(id);
  if (!log) return undefined;
  getDb()
    .prepare(
      `UPDATE daily_logs
       SET status_local = 'skipped',
           status_skp = CASE WHEN status_skp = 'submitted' THEN status_skp ELSE 'not_submitted' END,
           reason_type = 'manual_skip',
           reason_note = 'Dilewati manual',
           updated_at = @now
       WHERE id = @id`
    )
    .run({ id, now: nowIso() });
  refreshCalendarForDate(log.tanggal);
  addHistory("log.skipped", "Log dilewati", `${log.kode_log} dilewati manual.`, "warning", "daily_log", id);
  return getDailyLog(id);
}

export function isSkpMappingReady(log: DailyLog): boolean {
  if (!log.kode_skp) return false;
  const row = getDb()
    .prepare("SELECT match_status FROM skp_site_mappings WHERE period_id = ? AND kode_skp = ?")
    .get(log.period_id, log.kode_skp) as { match_status: string } | undefined;
  return ["matched", "manual", "partial"].includes(row?.match_status ?? "");
}

export function createSyncJob(jobType: string, dateFrom?: string, dateTo?: string, totalItems = 0): string {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO sync_jobs
        (id, job_type, period_id, date_from, date_to, status, total_items, started_at, created_at)
       VALUES (@id, @job_type, @period_id, @date_from, @date_to, 'running', @total_items, @now, @now)`
    )
    .run({ id, job_type: jobType, period_id: getActivePeriod().id, date_from: dateFrom ?? null, date_to: dateTo ?? null, total_items: totalItems, now: nowIso() });
  return id;
}

export function finishSyncJob(id: string, status: string, counts: { success: number; failed: number; skipped: number; total: number }): void {
  getDb()
    .prepare(
      `UPDATE sync_jobs
       SET status = @status,
           total_items = @total,
           success_count = @success,
           failed_count = @failed,
           skipped_count = @skipped,
           finished_at = @now
       WHERE id = @id`
    )
    .run({ id, status, ...counts, now: nowIso() });
}

export function addSyncJobItem(jobId: string, log: DailyLog, status: string, error?: string, screenshotPath?: string, errorCode?: string): void {
  getDb()
    .prepare(
      `INSERT INTO sync_job_items
        (id, job_id, daily_log_id, tanggal, status, attempt_count, error_code, error_message, screenshot_path, started_at, finished_at)
       VALUES (@id, @job_id, @daily_log_id, @tanggal, @status, 1, @error_code, @error_message, @screenshot_path, @now, @now)`
    )
    .run({
      id: randomUUID(),
      job_id: jobId,
      daily_log_id: log.id,
      tanggal: log.tanggal,
      status,
      error_code: errorCode ?? null,
      error_message: error ?? null,
      screenshot_path: screenshotPath ?? null,
      now: nowIso()
    });
}

export function addQueuedSyncJobItem(jobId: string, log: DailyLog): string {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO sync_job_items
        (id, job_id, daily_log_id, tanggal, status, attempt_count, error_code, error_message, screenshot_path, started_at, finished_at)
       VALUES (@id, @job_id, @daily_log_id, @tanggal, 'queued', 0, NULL, NULL, NULL, NULL, NULL)`
    )
    .run({
      id,
      job_id: jobId,
      daily_log_id: log.id,
      tanggal: log.tanggal
    });
  return id;
}

export function updateSyncJobItemStatus(itemId: string, status: string, error?: string, screenshotPath?: string, errorCode?: string): void {
  const now = nowIso();
  getDb()
    .prepare(
      `UPDATE sync_job_items
       SET status = @status,
           attempt_count = CASE WHEN @status = 'running' THEN attempt_count + 1 ELSE attempt_count END,
           error_code = @error_code,
           error_message = @error_message,
           screenshot_path = @screenshot_path,
           started_at = CASE WHEN started_at IS NULL THEN @now ELSE started_at END,
           finished_at = CASE WHEN @status IN ('success','failed','skipped') THEN @now ELSE finished_at END
       WHERE id = @id`
    )
    .run({
      id: itemId,
      status,
      error_code: errorCode ?? null,
      error_message: error ?? null,
      screenshot_path: screenshotPath ?? null,
      now
    });
}

export function refreshSyncJobCounts(jobId: string, status = "running"): void {
  const counts = getSyncJobCounts(jobId);
  getDb()
    .prepare(
      `UPDATE sync_jobs
       SET status = @status,
           success_count = @successCount,
           failed_count = @failedCount,
           skipped_count = @skippedCount,
           finished_at = CASE WHEN @status IN ('finished','finished_with_error','stopped') THEN @now ELSE finished_at END
       WHERE id = @jobId`
    )
    .run({ jobId, status, ...counts, now: nowIso() });
}

export function getSyncJobProgress(jobId: string): Record<string, unknown> | undefined {
  const job = getDb().prepare("SELECT * FROM sync_jobs WHERE id = ?").get(jobId) as Record<string, unknown> | undefined;
  if (!job) return undefined;
  const items = getDb()
    .prepare(
      `SELECT
         i.id,
         i.job_id,
         i.daily_log_id,
         i.tanggal,
         l.kode_log,
         l.nama_aktivitas,
         l.kode_skp,
         l.nama_skp,
         i.status,
         i.attempt_count,
         i.error_code,
         i.error_message,
         i.screenshot_path,
         i.started_at,
         i.finished_at
       FROM sync_job_items i
       LEFT JOIN daily_logs l ON l.id = i.daily_log_id
       WHERE i.job_id = ?
       ORDER BY i.tanggal ASC, l.kode_log ASC`
    )
    .all(jobId) as Array<Record<string, unknown>>;
  const counts = getSyncJobCounts(jobId);
  const running = items.find((item) => item.status === "running") ?? null;
  return {
    success: true,
    jobId,
    job,
    items,
    running,
    total: Number(job.total_items ?? items.length),
    ...counts
  };
}

function getSyncJobCounts(jobId: string): { successCount: number; failedCount: number; skippedCount: number } {
  const rows = getDb()
    .prepare(
      `SELECT status, COUNT(*) as count
       FROM sync_job_items
       WHERE job_id = ?
       GROUP BY status`
    )
    .all(jobId) as Array<{ status: string; count: number }>;
  const byStatus = Object.fromEntries(rows.map((row) => [row.status, row.count]));
  return {
    successCount: Number(byStatus.success ?? 0),
    failedCount: Number(byStatus.failed ?? 0),
    skippedCount: Number(byStatus.skipped ?? 0)
  };
}

export function commitImportPreview(preview: ImportPreview, mode: string): Record<string, number | string | null | boolean> {
  const periodId = getActivePeriod().id;
  const now = nowIso();
  const summary = {
    ok: true,
    totalRows: preview.totalRows,
    insertedRows: 0,
    updatedRows: 0,
    skippedRows: 0,
    invalidRows: preview.invalidRows,
    reviewRows: preview.reviewRows,
    periodStart: preview.periodStart,
    periodEnd: preview.periodEnd
  };
  const tx = getDb().transaction(() => {
    getDb()
      .prepare(
        `INSERT INTO import_batches
          (id, file_name, file_path, file_hash, import_type, period_id, mode, total_rows, new_rows, updated_rows, unchanged_rows, invalid_rows, period_start, period_end, created_at)
         VALUES (@id, @file_name, @file_path, NULL, 'log_harian', @period_id, @mode, @total_rows, @new_rows, @updated_rows, @unchanged_rows, @invalid_rows, @period_start, @period_end, @created_at)`
      )
      .run({
        id: preview.id,
        file_name: preview.fileName,
        file_path: preview.filePath,
        period_id: periodId,
        mode,
        total_rows: preview.totalRows,
        new_rows: preview.newRows,
        updated_rows: preview.changedRows,
        unchanged_rows: preview.unchangedRows,
        invalid_rows: preview.invalidRows,
        period_start: preview.periodStart,
        period_end: preview.periodEnd,
        created_at: now
      });

    if (mode === "preview_only") return;
    if (mode === "replace_period" && preview.periodStart && preview.periodEnd) {
      getDb()
        .prepare("DELETE FROM daily_logs WHERE period_id = ? AND tanggal >= ? AND tanggal <= ? AND status_skp NOT IN ('submitted','manual_marked_submitted')")
        .run(periodId, preview.periodStart, preview.periodEnd);
    }

    for (const row of preview.rows) {
      if (row.status === "Tidak Valid" || row.status === "Duplikat") {
        summary.skippedRows += 1;
        continue;
      }
      if (mode === "append_new" && row.status !== "Baru" && row.status !== "Perlu Review") {
        summary.skippedRows += 1;
        continue;
      }
      if (mode === "update_changed" && !["Baru", "Berubah", "Perlu Review"].includes(row.status)) {
        summary.skippedRows += 1;
        continue;
      }
      upsertDailyLog({ ...row.data, period_id: periodId });
      if (row.status === "Berubah") summary.updatedRows += 1;
      else summary.insertedRows += 1;
    }

    if (preview.periodStart && !getSetting("local_managed_start_date", "")) {
      setSetting("local_managed_start_date", preview.periodStart);
    }
  });
  tx();
  addHistory(
    "import.committed",
    "Import Excel disimpan",
    `${summary.insertedRows} baru, ${summary.updatedRows} berubah, ${summary.skippedRows} dilewati, ${preview.invalidRows} tidak valid.`,
    "success"
  );
  return summary;
}
