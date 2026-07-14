import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import dotenv from "dotenv";
import WebSocket from "ws";

dotenv.config({ path: join(process.cwd(), ".env.local"), quiet: true });
(globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = WebSocket;

type SupabaseClient = any;
type Row = Record<string, unknown>;

type TableAudit = {
  table: string;
  rowCount: number;
  columns: Array<{ name: string; type: string; notnull: number; pk: number }>;
  indexes: Array<{ name: string; unique: number; origin: string }>;
  foreignKeys: Array<Record<string, unknown>>;
};

type CountExpectation = {
  table: string;
  sourceTables: string[];
  expected: number;
};

type ValidationStatus = {
  foreignKey: "PASS" | "FAIL" | "NOT_RUN";
  duplication: "PASS" | "FAIL" | "NOT_RUN";
  encryption: "PASS" | "FAIL" | "NOT_RUN";
};

type MigrationReport = {
  ok: boolean;
  finalStatus: "VERIFIED" | "FAILED";
  startedAt: string;
  finishedAt?: string;
  sqlitePath: string;
  supabaseUrlConfigured: boolean;
  privilegedKeyConfigured: boolean;
  databaseUrlConfigured: boolean;
  migrationUserIdConfigured: boolean;
  encryptionKeyConfigured: boolean;
  authUserVerified: boolean;
  blockedReason?: string;
  sqliteAudit: TableAudit[];
  schemaCheck: Record<string, "PASS" | "FAIL">;
  tableMapping: Record<string, string>;
  beforeCounts: Record<string, number>;
  expectedRows: Record<string, number>;
  afterCounts: Record<string, number | null>;
  skippedRows: { total: number; byTable: Record<string, number>; reasons: string[] };
  failedRows: { total: number; byTable: Record<string, number>; reasons: string[] };
  mismatch: { total: number; byTable: Record<string, number> };
  validationStatus: ValidationStatus;
  validationErrors: string[];
  importedTables: string[];
  sensitiveData: {
    plaintextCredentialMigrated: false;
    encryptedCredentialRows: number;
    encryptedSessionRows: number;
  };
};

const SQLITE_TABLES = [
  "settings",
  "skp_periods",
  "skp_items",
  "skp_site_mappings",
  "skp_plans",
  "daily_logs",
  "calendar_days",
  "import_batches",
  "sync_jobs",
  "sync_job_items",
  "periodic_history",
  "activity_history"
];

const EXPECTED_COLUMNS: Record<string, string[]> = {
  profiles: ["id", "user_id", "local_profile_id", "nama_pegawai", "nip_username", "jabatan", "unit_kerja", "tahun_skp_aktif", "periode_skp", "base_url_skp", "created_at", "updated_at"],
  skp_credentials: ["id", "user_id", "encrypted_username", "encrypted_password", "encryption_version", "last_rotated_at", "created_at", "updated_at"],
  skp_sessions: ["id", "user_id", "status", "encrypted_storage_state", "encrypted_cookies", "display_name", "last_checked_at", "expires_at", "message", "created_at", "updated_at"],
  skp_plans: ["id", "user_id", "local_id", "local_period_id", "year", "start_date", "end_date", "label", "source_file", "profile_json", "raw_text_hash", "imported_at", "is_active", "created_at", "updated_at"],
  skp_plan_items: ["id", "user_id", "plan_id", "local_id", "local_period_id", "kode_skp", "nama_skp", "penugasan_dari", "indikator_json", "is_active", "site_option_text", "site_option_value", "match_status", "last_checked_at", "created_at", "updated_at"],
  daily_logs: ["id", "user_id", "local_id", "local_period_id", "plan_id", "kode_log", "tanggal", "kode_skp", "nama_skp", "nama_aktivitas", "deskripsi", "indikator_kinerja_individu", "kuantitas_output", "satuan", "link_tautan", "status_local", "status_skp", "reason_type", "reason_note", "source_file", "source_hash", "last_sync_at", "last_error", "last_error_code", "current_url", "automation_step", "screenshot_path", "created_at", "updated_at"],
  daily_log_submissions: ["id", "user_id", "daily_log_id", "scheduler_job_id", "local_job_id", "local_item_id", "tanggal", "status", "attempt_count", "error_code", "error_message", "screenshot_path", "started_at", "finished_at", "created_at", "updated_at"],
  periodic_jobs: ["id", "user_id", "local_id", "plan_id", "local_period_id", "year", "quarter", "total_skp", "success_count", "failed_count", "submit_status", "status", "mode", "error_last", "screenshot_path", "created_at", "updated_at"],
  auto_post_settings: ["id", "user_id", "enabled", "post_time", "timezone", "active_weekdays", "skip_holidays", "only_if_not_submitted", "retry_until_time", "retry_interval_minutes", "next_auto_post_at", "worker_status", "last_job_status", "last_job_at", "created_at", "updated_at"],
  holidays: ["id", "user_id", "holiday_date", "name", "is_joint_leave", "source", "is_active", "created_at", "updated_at"],
  scheduler_jobs: ["id", "user_id", "job_type", "scheduled_date", "scheduled_at", "status", "locked_at", "locked_by", "started_at", "finished_at", "attempt_count", "daily_log_id", "result_message", "error_code", "error_message", "next_auto_post_at", "created_at", "updated_at"],
  audit_logs: ["id", "user_id", "local_id", "event_type", "title", "message", "entity_type", "entity_id", "severity", "created_at"]
};

const TABLE_MAPPING: Record<string, string> = {
  settings: "profiles, skp_credentials, skp_sessions, auto_post_settings",
  skp_periods: "skp_plans",
  skp_items: "skp_plan_items",
  skp_site_mappings: "skp_plan_items.site_* columns",
  skp_plans: "skp_plans",
  daily_logs: "daily_logs",
  calendar_days: "holidays (only public_holiday/leave/sick_leave rows)",
  import_batches: "not migrated: no Supabase target table in installed schema",
  sync_jobs: "scheduler_jobs",
  sync_job_items: "daily_log_submissions",
  periodic_history: "periodic_jobs",
  activity_history: "audit_logs"
};

async function main(): Promise<void> {
  const sqlitePath = process.env.KAEMSKP_SQLITE_PATH || defaultSqlitePath();
  const report = createReport(sqlitePath);
  let db: Database.Database | null = null;

  try {
    if (!existsSync(sqlitePath)) {
      report.blockedReason = "Database SQLite tidak ditemukan.";
      return finish(report, db);
    }

    db = new Database(sqlitePath, { readonly: true });
    report.sqliteAudit = auditSqlite(db);
    for (const table of SQLITE_TABLES) report.beforeCounts[table] = countSqlite(db, table);

    const supabaseUrl = process.env.SUPABASE_URL || "";
    const secretKey = process.env.SUPABASE_SECRET_KEY || "";
    const userId = process.env.KAEMSKP_MIGRATION_USER_ID || "";
    const encryptionKey = process.env.SKP_CREDENTIAL_ENCRYPTION_KEY || "";
    if (!supabaseUrl || !secretKey || !userId || !encryptionKey) {
      report.blockedReason = "Migration production membutuhkan SUPABASE_URL, SUPABASE_SECRET_KEY, KAEMSKP_MIGRATION_USER_ID, dan SKP_CREDENTIAL_ENCRYPTION_KEY.";
      return finish(report, db);
    }
    if (!isUuid(userId)) {
      report.blockedReason = "KAEMSKP_MIGRATION_USER_ID bukan UUID valid.";
      return finish(report, db);
    }
    if (encryptionKey.length < 32) {
      report.blockedReason = "SKP_CREDENTIAL_ENCRYPTION_KEY terlalu pendek; minimal 32 karakter.";
      return finish(report, db);
    }

    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    await verifyAuthUser(supabase, userId, report);
    if (!report.authUserVerified) return finish(report, db);
    await verifyInstalledSchema(supabase, report);
    if (Object.values(report.schemaCheck).some((status) => status === "FAIL")) {
      report.blockedReason = "Schema Supabase tidak cocok dengan migrasi yang dibutuhkan.";
      return finish(report, db);
    }

    const payload = buildPayload(db, userId, encryptionKey, report);
    prevalidatePayload(payload, report);
    if (report.validationErrors.length > 0) {
      report.blockedReason = "Preflight gagal; migrasi dihentikan sebelum write ke Supabase.";
      return finish(report, db);
    }

    await importPayload(supabase, userId, payload, report);
    await validateAfterImport(supabase, userId, report);

    report.ok = report.validationErrors.length === 0 && report.failedRows.total === 0 && report.mismatch.total === 0;
    report.finalStatus = report.ok ? "VERIFIED" : "FAILED";
    finish(report, db);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report.failedRows.total += 1;
    report.failedRows.reasons.push(message);
    report.validationErrors.push(message);
    finish(report, db);
  }
}

function createReport(sqlitePath: string): MigrationReport {
  return {
    ok: false,
    finalStatus: "FAILED",
    startedAt: new Date().toISOString(),
    sqlitePath,
    supabaseUrlConfigured: Boolean(process.env.SUPABASE_URL),
    privilegedKeyConfigured: Boolean(process.env.SUPABASE_SECRET_KEY),
    databaseUrlConfigured: Boolean(process.env.SUPABASE_DATABASE_URL),
    migrationUserIdConfigured: Boolean(process.env.KAEMSKP_MIGRATION_USER_ID),
    encryptionKeyConfigured: Boolean(process.env.SKP_CREDENTIAL_ENCRYPTION_KEY),
    authUserVerified: false,
    sqliteAudit: [],
    schemaCheck: {},
    tableMapping: TABLE_MAPPING,
    beforeCounts: {},
    expectedRows: {},
    afterCounts: {},
    skippedRows: { total: 0, byTable: {}, reasons: [] },
    failedRows: { total: 0, byTable: {}, reasons: [] },
    mismatch: { total: 0, byTable: {} },
    validationStatus: { foreignKey: "NOT_RUN", duplication: "NOT_RUN", encryption: "NOT_RUN" },
    validationErrors: [],
    importedTables: [],
    sensitiveData: {
      plaintextCredentialMigrated: false,
      encryptedCredentialRows: 0,
      encryptedSessionRows: 0
    }
  };
}

function defaultSqlitePath(): string {
  const root = process.env.APPDATA || process.env.LOCALAPPDATA || join(process.env.USERPROFILE || process.cwd(), "AppData", "Roaming");
  return join(root, "KaemSKP", "kaemskp.db");
}

async function verifyAuthUser(supabase: SupabaseClient, userId: string, report: MigrationReport): Promise<void> {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error || !data.user) {
    report.blockedReason = "KAEMSKP_MIGRATION_USER_ID tidak ditemukan di auth.users.";
    report.validationErrors.push("auth.users: migration user not found");
    return;
  }
  report.authUserVerified = true;
}

async function verifyInstalledSchema(supabase: SupabaseClient, report: MigrationReport): Promise<void> {
  for (const [table, columns] of Object.entries(EXPECTED_COLUMNS)) {
    const { error } = await supabase.from(table).select(columns.join(","), { head: true }).limit(0);
    report.schemaCheck[table] = error ? "FAIL" : "PASS";
    if (error) report.validationErrors.push(`${table}: schema check failed`);
  }
}

function auditSqlite(db: Database.Database): TableAudit[] {
  return SQLITE_TABLES.filter((table) => tableExists(db, table)).map((table) => ({
    table,
    rowCount: countSqlite(db, table),
    columns: db.prepare(`pragma table_info(${table})`).all() as TableAudit["columns"],
    indexes: db.prepare(`pragma index_list(${table})`).all() as TableAudit["indexes"],
    foreignKeys: db.prepare(`pragma foreign_key_list(${table})`).all() as Array<Record<string, unknown>>
  }));
}

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(db.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(table));
}

function countSqlite(db: Database.Database, table: string): number {
  if (!tableExists(db, table)) return 0;
  return Number((db.prepare(`select count(*) as c from ${table}`).get() as { c: number }).c);
}

function all<T extends Row>(db: Database.Database, table: string): T[] {
  if (!tableExists(db, table)) return [];
  return db.prepare(`select * from ${table}`).all() as T[];
}

function buildPayload(db: Database.Database, userId: string, encryptionKey: string, report: MigrationReport): Record<string, Row[]> {
  const periods = all(db, "skp_periods");
  const plans = all(db, "skp_plans");
  const settings = Object.fromEntries(all<{ key: string; value: string }>(db, "settings").map((row) => [row.key, row.value ?? ""]));
  const activePeriod = periods.find((period) => Number(period.is_active) === 1) ?? periods[0];
  const planRows = transformPlans(userId, periods, plans);
  const planIdByPeriod = new Map(planRows.map((plan) => [String(plan.local_period_id), stableUuid(userId, `plan:${plan.local_period_id}`)]));
  for (const plan of planRows) plan.id = stableUuid(userId, `plan:${plan.local_period_id}`);

  const credentialRows = transformCredentials(userId, settings, encryptionKey, report);
  const sessionRows = transformSession(userId, settings, encryptionKey, report);
  const holidayRows = transformHolidays(userId, all(db, "calendar_days"));

  report.skippedRows.byTable.import_batches = countSqlite(db, "import_batches");
  report.skippedRows.total += report.skippedRows.byTable.import_batches;
  if (report.skippedRows.byTable.import_batches > 0) {
    report.skippedRows.reasons.push("import_batches skipped: no target table exists in installed Supabase schema");
  }
  report.skippedRows.byTable.calendar_days = countSqlite(db, "calendar_days") - holidayRows.length;
  report.skippedRows.total += Math.max(0, report.skippedRows.byTable.calendar_days);
  if (report.skippedRows.byTable.calendar_days > 0) {
    report.skippedRows.reasons.push("calendar_days skipped: only holiday/leave/sick_leave rows map to holidays");
  }

  const scheduler = transformSchedulerJobs(userId, all(db, "sync_jobs"), report);
  const payload: Record<string, Row[]> = {
    skp_plans: planRows,
    profiles: [transformProfile(userId, activePeriod, plans, settings)],
    skp_credentials: credentialRows,
    skp_sessions: sessionRows,
    auto_post_settings: [transformAutoPostSettings(userId, settings)],
    skp_plan_items: transformPlanItems(userId, all(db, "skp_items"), all(db, "skp_site_mappings"), planIdByPeriod),
    daily_logs: transformDailyLogs(userId, all(db, "daily_logs"), planIdByPeriod),
    holidays: holidayRows,
    periodic_jobs: transformPeriodicJobs(userId, all(db, "periodic_history"), planIdByPeriod),
    scheduler_jobs: scheduler.rows,
    audit_logs: transformAuditLogs(userId, all(db, "activity_history"))
  };

  const dailyLogIdByLocalId = new Map(payload.daily_logs.map((log) => [String(log.local_id), String(log.id)]));
  const schedulerIdByLocalId = scheduler.idByLocalId;
  payload.daily_log_submissions = transformSubmissions(userId, all(db, "sync_job_items"), dailyLogIdByLocalId, schedulerIdByLocalId);

  const expectations: CountExpectation[] = [
    { table: "profiles", sourceTables: ["settings", "skp_periods"], expected: payload.profiles.length },
    { table: "skp_credentials", sourceTables: ["settings", "profile.json"], expected: payload.skp_credentials.length },
    { table: "skp_sessions", sourceTables: ["settings", "sessions/skp-auth-state.json"], expected: payload.skp_sessions.length },
    { table: "auto_post_settings", sourceTables: ["settings"], expected: payload.auto_post_settings.length },
    { table: "skp_plans", sourceTables: ["skp_periods", "skp_plans"], expected: payload.skp_plans.length },
    { table: "skp_plan_items", sourceTables: ["skp_items", "skp_site_mappings"], expected: payload.skp_plan_items.length },
    { table: "daily_logs", sourceTables: ["daily_logs"], expected: payload.daily_logs.length },
    { table: "holidays", sourceTables: ["calendar_days"], expected: payload.holidays.length },
    { table: "periodic_jobs", sourceTables: ["periodic_history"], expected: payload.periodic_jobs.length },
    { table: "scheduler_jobs", sourceTables: ["sync_jobs"], expected: payload.scheduler_jobs.length },
    { table: "daily_log_submissions", sourceTables: ["sync_job_items"], expected: payload.daily_log_submissions.length },
    { table: "audit_logs", sourceTables: ["activity_history"], expected: payload.audit_logs.length }
  ];
  for (const item of expectations) report.expectedRows[item.table] = item.expected;

  return payload;
}

function transformProfile(userId: string, activePeriod: Row | undefined, plans: Row[], settings: Record<string, string>): Row {
  const plan = activePeriod ? plans.find((item) => item.period_id === activePeriod.id) : undefined;
  const profileJson = parseJson(plan?.profile_json) as Row | null;
  const localProfile = readLocalProfile();
  return {
    user_id: userId,
    local_profile_id: "local-profile",
    nama_pegawai: stringOrNull(localProfile.namaPegawai) ?? stringOrNull(profileJson?.namaPegawai),
    nip_username: stringOrNull(localProfile.nipUsername) ?? stringOrNull(settings.skp_username),
    jabatan: stringOrNull(localProfile.jabatan) ?? stringOrNull(profileJson?.jabatan),
    unit_kerja: stringOrNull(localProfile.unitKerja) ?? stringOrNull(profileJson?.unitKerja),
    tahun_skp_aktif: activePeriod ? Number(activePeriod.year) : numberOrNull(localProfile.tahunSkpAktif),
    periode_skp: stringOrNull(localProfile.periodeSkp) ?? (activePeriod ? `${activePeriod.start_date} s/d ${activePeriod.end_date}` : null),
    base_url_skp: stringOrNull(localProfile.baseUrlSkp) ?? stringOrNull(settings.skp_base_url) ?? process.env.SKP_BASE_URL ?? "https://skp.sdm.kemendikdasmen.go.id"
  };
}

function transformCredentials(userId: string, settings: Record<string, string>, encryptionKey: string, report: MigrationReport): Row[] {
  const localProfile = readLocalProfile();
  const profilePassword = decryptLocalPassword(localProfile);
  const username = stringOrNull(localProfile.nipUsername) ?? stringOrNull(settings.skp_username) ?? stringOrNull(process.env.SKP_USERNAME);
  const password = profilePassword ?? cleanPassword(settings.skp_password) ?? stringOrNull(process.env.SKP_PASSWORD);
  if (!username && !password) return [];
  report.sensitiveData.encryptedCredentialRows = 1;
  return [{
    user_id: userId,
    encrypted_username: username ? encryptSecret(username, encryptionKey) : null,
    encrypted_password: password ? encryptSecret(password, encryptionKey) : null,
    encryption_version: "v1",
    last_rotated_at: new Date().toISOString()
  }];
}

function transformSession(userId: string, settings: Record<string, string>, encryptionKey: string, report: MigrationReport): Row[] {
  const authStatePath = join(dataDir(), "sessions", "skp-auth-state.json");
  const storageState = existsSync(authStatePath) ? readFileSync(authStatePath, "utf8") : null;
  if (storageState) report.sensitiveData.encryptedSessionRows = 1;
  return [{
    user_id: userId,
    status: settings.skp_session_status || "not_logged_in",
    encrypted_storage_state: storageState ? encryptSecret(storageState, encryptionKey) : null,
    encrypted_cookies: null,
    display_name: stringOrNull(settings.skp_session_display_name),
    last_checked_at: toIsoOrNull(settings.skp_session_last_checked_at),
    expires_at: null,
    message: stringOrNull(settings.skp_session_message)
  }];
}

function transformPlans(userId: string, periods: Row[], plans: Row[]): Row[] {
  return periods.map((period) => {
    const plan = plans.find((item) => item.period_id === period.id);
    return {
      user_id: userId,
      local_id: plan?.id ?? null,
      local_period_id: period.id,
      year: Number(period.year),
      start_date: period.start_date,
      end_date: period.end_date,
      label: period.label,
      source_file: plan?.source_file ?? null,
      profile_json: parseJson(plan?.profile_json),
      raw_text_hash: plan?.raw_text_hash ?? null,
      imported_at: toIsoOrNull(plan?.imported_at),
      is_active: Number(period.is_active) === 1,
      created_at: toIsoOrNow(period.created_at),
      updated_at: toIsoOrNow(period.updated_at)
    };
  });
}

function transformPlanItems(userId: string, items: Row[], mappings: Row[], planIdByPeriod: Map<string, string>): Row[] {
  return items.map((item) => {
    const mapping = mappings.find((row) => row.period_id === item.period_id && row.kode_skp === item.kode_skp);
    return {
      id: stableUuid(userId, `plan-item:${item.id}`),
      user_id: userId,
      plan_id: planIdByPeriod.get(String(item.period_id)) ?? null,
      local_id: item.id,
      local_period_id: item.period_id,
      kode_skp: item.kode_skp,
      nama_skp: item.nama_skp,
      penugasan_dari: item.penugasan_dari,
      indikator_json: parseJson(item.indikator_json),
      is_active: Number(item.is_active ?? 1) === 1,
      site_option_text: mapping?.site_option_text ?? null,
      site_option_value: mapping?.site_option_value ?? null,
      match_status: mapping?.match_status ?? "needs_review",
      last_checked_at: toIsoOrNull(mapping?.last_checked_at),
      created_at: toIsoOrNow(item.created_at),
      updated_at: toIsoOrNow(item.updated_at)
    };
  });
}

function transformDailyLogs(userId: string, rows: Row[], planIdByPeriod: Map<string, string>): Row[] {
  return rows.map((row) => ({
    id: stableUuid(userId, `daily-log:${row.id}`),
    user_id: userId,
    local_id: row.id,
    local_period_id: row.period_id,
    plan_id: planIdByPeriod.get(String(row.period_id)) ?? null,
    kode_log: row.kode_log,
    tanggal: row.tanggal,
    kode_skp: row.kode_skp,
    nama_skp: row.nama_skp,
    nama_aktivitas: row.nama_aktivitas,
    deskripsi: row.deskripsi,
    indikator_kinerja_individu: row.indikator_kinerja_individu,
    kuantitas_output: row.kuantitas_output,
    satuan: row.satuan,
    link_tautan: row.link_tautan,
    status_local: row.status_local,
    status_skp: row.status_skp,
    reason_type: row.reason_type,
    reason_note: row.reason_note,
    source_file: row.source_file,
    source_hash: row.source_hash,
    last_sync_at: toIsoOrNull(row.last_sync_at),
    last_error: row.last_error,
    last_error_code: row.last_error_code,
    current_url: row.current_url,
    automation_step: row.automation_step,
    screenshot_path: row.screenshot_path,
    created_at: toIsoOrNow(row.created_at),
    updated_at: toIsoOrNow(row.updated_at)
  }));
}

function transformHolidays(userId: string, rows: Row[]): Row[] {
  return rows
    .filter((row) => Number(row.is_public_holiday) === 1 || Number(row.is_leave) === 1 || ["public_holiday", "leave", "sick_leave"].includes(String(row.status)))
    .map((row) => ({
      id: stableUuid(userId, `holiday:${row.date}:${row.holiday_name || row.reason_note || "Tanggal merah"}`),
      user_id: userId,
      holiday_date: row.date,
      name: row.holiday_name || row.reason_note || "Tanggal merah",
      is_joint_leave: Number(row.is_leave) === 1,
      source: "sqlite_calendar_days",
      is_active: true,
      created_at: toIsoOrNow(row.created_at),
      updated_at: toIsoOrNow(row.updated_at)
    }));
}

function transformPeriodicJobs(userId: string, rows: Row[], planIdByPeriod: Map<string, string>): Row[] {
  return rows.map((row) => ({
    id: stableUuid(userId, `periodic:${row.id}`),
    user_id: userId,
    local_id: row.id,
    plan_id: planIdByPeriod.get(String(row.period_id)) ?? null,
    local_period_id: row.period_id,
    year: Number(row.year),
    quarter: Number(row.quarter),
    total_skp: Number(row.total_skp ?? 0),
    success_count: Number(row.success_count ?? 0),
    failed_count: Number(row.failed_count ?? 0),
    submit_status: row.submit_status,
    status: row.status,
    mode: row.mode,
    error_last: row.error_last,
    screenshot_path: row.screenshot_path,
    created_at: toIsoOrNow(row.created_at),
    updated_at: toIsoOrNow(row.created_at)
  }));
}

function transformSchedulerJobs(userId: string, rows: Row[], report: MigrationReport): { rows: Row[]; idByLocalId: Map<string, string> } {
  const byKey = new Map<string, Row>();
  const keyByLocalId = new Map<string, string>();
  for (const row of rows) {
    const scheduledDate = String(row.date_from || String(row.created_at || new Date().toISOString()).slice(0, 10));
    const key = `${row.job_type ?? "unknown"}\u0000${scheduledDate}`;
    keyByLocalId.set(String(row.id), key);
    const previous = byKey.get(key);
    if (!previous || compareJobRecency(row, previous) >= 0) byKey.set(key, row);
  }

  const skipped = rows.length - byKey.size;
  if (skipped > 0) {
    report.skippedRows.byTable.scheduler_jobs = skipped;
    report.skippedRows.total += skipped;
    report.skippedRows.reasons.push("sync_jobs deduplicated to scheduler_jobs by unique key user_id,job_type,scheduled_date");
  }

  const idByKey = new Map<string, string>();
  const payload = Array.from(byKey.entries()).map(([key, row]) => {
    const scheduledDate = String(row.date_from || String(row.created_at || new Date().toISOString()).slice(0, 10));
    const id = stableUuid(userId, `scheduler:${key}`);
    idByKey.set(key, id);
    return {
      id,
      user_id: userId,
      job_type: row.job_type,
      scheduled_date: scheduledDate,
      scheduled_at: toIsoOrNow(row.started_at ?? row.created_at),
      status: normalizeSchedulerStatus(row.status),
      started_at: toIsoOrNull(row.started_at),
      finished_at: toIsoOrNull(row.finished_at),
      attempt_count: 1,
      result_message: `${row.success_count ?? 0} berhasil, ${row.failed_count ?? 0} gagal, ${row.skipped_count ?? 0} dilewati`,
      created_at: toIsoOrNow(row.created_at),
      updated_at: toIsoOrNow(row.finished_at ?? row.created_at)
    };
  });

  const idByLocalId = new Map<string, string>();
  for (const [localId, key] of keyByLocalId.entries()) {
    const id = idByKey.get(key);
    if (id) idByLocalId.set(localId, id);
  }
  return { rows: payload, idByLocalId };
}

function compareJobRecency(a: Row, b: Row): number {
  const aTime = new Date(String(a.finished_at ?? a.started_at ?? a.created_at ?? 0)).getTime();
  const bTime = new Date(String(b.finished_at ?? b.started_at ?? b.created_at ?? 0)).getTime();
  return (Number.isNaN(aTime) ? 0 : aTime) - (Number.isNaN(bTime) ? 0 : bTime);
}

function transformSubmissions(userId: string, rows: Row[], logIdByLocalId: Map<string, string>, schedulerIdByLocalId: Map<string, string>): Row[] {
  return rows.map((row) => ({
    id: stableUuid(userId, `submission:${row.id}`),
    user_id: userId,
    daily_log_id: logIdByLocalId.get(String(row.daily_log_id)) ?? null,
    scheduler_job_id: schedulerIdByLocalId.get(String(row.job_id)) ?? null,
    local_job_id: row.job_id,
    local_item_id: row.id,
    tanggal: row.tanggal,
    status: row.status,
    attempt_count: Number(row.attempt_count ?? 0),
    error_code: row.error_code,
    error_message: row.error_message,
    screenshot_path: row.screenshot_path,
    started_at: toIsoOrNull(row.started_at),
    finished_at: toIsoOrNull(row.finished_at),
    created_at: toIsoOrNow(row.started_at ?? row.finished_at),
    updated_at: toIsoOrNow(row.finished_at ?? row.started_at)
  }));
}

function transformAuditLogs(userId: string, rows: Row[]): Row[] {
  return rows.map((row) => ({
    id: stableUuid(userId, `audit:${row.id}`),
    user_id: userId,
    local_id: row.id,
    event_type: row.event_type,
    title: row.title,
    message: row.message,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    severity: row.severity,
    created_at: toIsoOrNow(row.created_at)
  }));
}

function transformAutoPostSettings(userId: string, settings: Record<string, string>): Row {
  return {
    user_id: userId,
    enabled: settings.auto_post_enabled !== "false",
    post_time: settings.auto_run_start_time || "08:00",
    timezone: settings.auto_post_timezone || "Asia/Jakarta",
    active_weekdays: (settings.auto_post_active_weekdays || "1,2,3,4,5").split(",").map((value) => Number(value.trim())),
    retry_until_time: settings.retry_until_time || "16:00",
    retry_interval_minutes: Number(settings.retry_interval_minutes || 10),
    worker_status: "waiting_for_worker",
    last_job_status: settings.auto_run_last_status || null,
    last_job_at: toIsoOrNull(settings.auto_run_last_attempt_at)
  };
}

function prevalidatePayload(payload: Record<string, Row[]>, report: MigrationReport): void {
  const required: Record<string, string[]> = {
    profiles: ["user_id", "base_url_skp"],
    skp_plans: ["user_id", "local_period_id", "year", "start_date", "end_date", "label"],
    skp_plan_items: ["user_id", "plan_id", "kode_skp", "nama_skp"],
    daily_logs: ["user_id", "plan_id", "local_period_id", "kode_log", "tanggal", "status_local", "status_skp"],
    holidays: ["user_id", "holiday_date", "name"],
    periodic_jobs: ["user_id", "plan_id", "local_id", "year", "quarter", "status", "mode"],
    scheduler_jobs: ["user_id", "job_type", "scheduled_date", "scheduled_at", "status"],
    daily_log_submissions: ["user_id", "daily_log_id", "scheduler_job_id", "local_item_id", "tanggal", "status"],
    audit_logs: ["user_id", "local_id", "event_type", "title"]
  };
  for (const [table, columns] of Object.entries(required)) {
    payload[table].forEach((row, index) => {
      for (const column of columns) {
        if (row[column] === null || row[column] === undefined || row[column] === "") {
          report.validationErrors.push(`${table}[${index}]: missing required ${column}`);
          report.failedRows.byTable[table] = (report.failedRows.byTable[table] ?? 0) + 1;
          report.failedRows.total += 1;
        }
      }
    });
  }
  for (const [table, key] of Object.entries({
    skp_plans: "user_id,local_period_id",
    skp_plan_items: "user_id,plan_id,kode_skp",
    daily_logs: "user_id,local_period_id,kode_log",
    holidays: "user_id,holiday_date,name",
    periodic_jobs: "user_id,local_id",
    scheduler_jobs: "user_id,job_type,scheduled_date",
    daily_log_submissions: "user_id,local_item_id",
    audit_logs: "user_id,local_id"
  })) {
    const duplicateCount = countDuplicates(payload[table], key.split(","));
    if (duplicateCount > 0) {
      report.validationErrors.push(`${table}: duplicate source keys=${duplicateCount}`);
      report.failedRows.byTable[table] = (report.failedRows.byTable[table] ?? 0) + duplicateCount;
      report.failedRows.total += duplicateCount;
    }
  }
}

async function importPayload(supabase: SupabaseClient, userId: string, payload: Record<string, Row[]>, report: MigrationReport): Promise<void> {
  await upsertBatch(supabase, "skp_plans", payload.skp_plans, "user_id,local_period_id", report);
  await upsertBatch(supabase, "profiles", payload.profiles, "user_id", report);
  await upsertBatch(supabase, "skp_credentials", payload.skp_credentials, "user_id", report);
  await upsertBatch(supabase, "skp_sessions", payload.skp_sessions, "user_id", report);
  await upsertBatch(supabase, "auto_post_settings", payload.auto_post_settings, "user_id", report);
  await upsertBatch(supabase, "skp_plan_items", payload.skp_plan_items, "user_id,plan_id,kode_skp", report);
  await upsertBatch(supabase, "daily_logs", payload.daily_logs, "user_id,local_period_id,kode_log", report);
  await upsertBatch(supabase, "holidays", payload.holidays, "user_id,holiday_date,name", report);
  await upsertBatch(supabase, "periodic_jobs", payload.periodic_jobs, "user_id,local_id", report);
  await upsertBatch(supabase, "scheduler_jobs", payload.scheduler_jobs, "user_id,job_type,scheduled_date", report);
  await upsertBatch(supabase, "daily_log_submissions", payload.daily_log_submissions, "user_id,local_item_id", report);
  await insertMissingByLocalId(supabase, "audit_logs", userId, payload.audit_logs, report);
}

async function upsertBatch(supabase: SupabaseClient, table: string, rows: Row[], onConflict: string, report: MigrationReport): Promise<void> {
  if (rows.length === 0) {
    if (!report.importedTables.includes(table)) report.importedTables.push(table);
    return;
  }
  for (let index = 0; index < rows.length; index += 200) {
    const batch = rows.slice(index, index + 200);
    const { error } = await supabase.from(table).upsert(batch, { onConflict });
    if (error) {
      report.failedRows.total += batch.length;
      report.failedRows.byTable[table] = (report.failedRows.byTable[table] ?? 0) + batch.length;
      throw new Error(`${table}: ${error.message}`);
    }
  }
  if (!report.importedTables.includes(table)) report.importedTables.push(table);
}

async function insertMissingByLocalId(supabase: SupabaseClient, table: string, userId: string, rows: Row[], report: MigrationReport): Promise<void> {
  const existingRows = await fetchRows(supabase, table, userId, "local_id");
  const existing = new Set(existingRows.map((row) => String(row.local_id)));
  const missing = rows.filter((row) => !existing.has(String(row.local_id)));
  if (missing.length === 0) {
    if (!report.importedTables.includes(table)) report.importedTables.push(table);
    return;
  }
  for (let index = 0; index < missing.length; index += 200) {
    const batch = missing.slice(index, index + 200);
    const { error } = await supabase.from(table).insert(batch);
    if (error) {
      report.failedRows.total += batch.length;
      report.failedRows.byTable[table] = (report.failedRows.byTable[table] ?? 0) + batch.length;
      throw new Error(`${table}: ${error.message}`);
    }
  }
  if (!report.importedTables.includes(table)) report.importedTables.push(table);
}

async function validateAfterImport(supabase: SupabaseClient, userId: string, report: MigrationReport): Promise<void> {
  for (const [table, expected] of Object.entries(report.expectedRows)) {
    const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true }).eq("user_id", userId);
    if (error) throw new Error(`${table}: ${error.message}`);
    const actual = count ?? 0;
    report.afterCounts[table] = actual;
    const mismatch = Math.abs(actual - expected);
    if (mismatch > 0) {
      report.mismatch.byTable[table] = mismatch;
      report.mismatch.total += mismatch;
      report.validationErrors.push(`${table}: expected=${expected}, actual=${actual}`);
    }
  }

  await validateForeignKeys(supabase, userId, report);
  await validateDuplicates(supabase, userId, report);
  await validateEncryption(supabase, userId, report);
}

async function validateForeignKeys(supabase: SupabaseClient, userId: string, report: MigrationReport): Promise<void> {
  const plans = new Set((await fetchRows(supabase, "skp_plans", userId, "id")).map((row) => String(row.id)));
  const dailyLogs = new Set((await fetchRows(supabase, "daily_logs", userId, "id")).map((row) => String(row.id)));
  const schedulerJobs = new Set((await fetchRows(supabase, "scheduler_jobs", userId, "id")).map((row) => String(row.id)));
  const checks: Array<{ table: string; rows: Row[]; column: string; parent: Set<string>; nullable: boolean }> = [
    { table: "skp_plan_items", rows: await fetchRows(supabase, "skp_plan_items", userId, "plan_id"), column: "plan_id", parent: plans, nullable: false },
    { table: "daily_logs", rows: await fetchRows(supabase, "daily_logs", userId, "plan_id"), column: "plan_id", parent: plans, nullable: false },
    { table: "periodic_jobs", rows: await fetchRows(supabase, "periodic_jobs", userId, "plan_id"), column: "plan_id", parent: plans, nullable: false },
    { table: "daily_log_submissions", rows: await fetchRows(supabase, "daily_log_submissions", userId, "daily_log_id,scheduler_job_id"), column: "daily_log_id", parent: dailyLogs, nullable: false },
    { table: "daily_log_submissions", rows: await fetchRows(supabase, "daily_log_submissions", userId, "daily_log_id,scheduler_job_id"), column: "scheduler_job_id", parent: schedulerJobs, nullable: false }
  ];
  let failures = 0;
  for (const check of checks) {
    for (const row of check.rows) {
      const value = row[check.column];
      if ((value === null || value === undefined) && check.nullable) continue;
      if (value === null || value === undefined || !check.parent.has(String(value))) failures += 1;
    }
  }
  report.validationStatus.foreignKey = failures === 0 ? "PASS" : "FAIL";
  if (failures > 0) report.validationErrors.push(`foreign keys: orphan rows=${failures}`);
}

async function validateDuplicates(supabase: SupabaseClient, userId: string, report: MigrationReport): Promise<void> {
  const checks: Record<string, string[]> = {
    skp_plans: ["user_id", "local_period_id"],
    skp_plan_items: ["user_id", "plan_id", "kode_skp"],
    daily_logs: ["user_id", "local_period_id", "kode_log"],
    holidays: ["user_id", "holiday_date", "name"],
    periodic_jobs: ["user_id", "local_id"],
    scheduler_jobs: ["user_id", "job_type", "scheduled_date"],
    daily_log_submissions: ["user_id", "local_item_id"],
    audit_logs: ["user_id", "local_id"]
  };
  let failures = 0;
  for (const [table, columns] of Object.entries(checks)) {
    const rows = await fetchRows(supabase, table, userId, columns.join(","));
    failures += countDuplicates(rows, columns);
  }
  report.validationStatus.duplication = failures === 0 ? "PASS" : "FAIL";
  if (failures > 0) report.validationErrors.push(`duplicates: rows=${failures}`);
}

async function validateEncryption(supabase: SupabaseClient, userId: string, report: MigrationReport): Promise<void> {
  const credentials = await fetchRows(supabase, "skp_credentials", userId, "encrypted_username,encrypted_password,encryption_version");
  const sessions = await fetchRows(supabase, "skp_sessions", userId, "encrypted_storage_state,encrypted_cookies");
  let failures = 0;
  for (const row of credentials) {
    if (row.encryption_version !== "v1") failures += 1;
    for (const column of ["encrypted_username", "encrypted_password"]) {
      const value = row[column];
      if (value && !isEncryptedEnvelope(String(value))) failures += 1;
    }
  }
  for (const row of sessions) {
    for (const column of ["encrypted_storage_state", "encrypted_cookies"]) {
      const value = row[column];
      if (value && !isEncryptedEnvelope(String(value))) failures += 1;
    }
  }
  report.validationStatus.encryption = failures === 0 ? "PASS" : "FAIL";
  if (failures > 0) report.validationErrors.push(`encryption: invalid encrypted envelopes=${failures}`);
}

async function fetchRows(supabase: SupabaseClient, table: string, userId: string, columns: string): Promise<Row[]> {
  const { data, error } = await supabase.from(table).select(columns).eq("user_id", userId).range(0, 9999);
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data ?? []) as Row[];
}

function countDuplicates(rows: Row[], columns: string[]): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const row of rows) {
    const key = columns.map((column) => String(row[column] ?? "")).join("\u0000");
    if (seen.has(key)) duplicates += 1;
    else seen.add(key);
  }
  return duplicates;
}

function normalizeSchedulerStatus(status: unknown): string {
  const text = String(status ?? "");
  if (["finished", "success"].includes(text)) return "success";
  if (["running", "pending"].includes(text)) return text;
  if (["skipped", "stopped"].includes(text)) return "failed";
  if (text === "finished_with_error") return "failed";
  return "pending";
}

function parseJson(value: unknown): unknown {
  if (!value) return null;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function toIsoOrNow(value: unknown): string {
  return toIsoOrNull(value) ?? new Date().toISOString();
}

function toIsoOrNull(value: unknown): string | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function stringOrNull(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function numberOrNull(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanPassword(value: unknown): string | null {
  const text = stringOrNull(value);
  return text && text !== "********" ? text : null;
}

function dataDir(): string {
  const root = process.env.APPDATA || process.env.LOCALAPPDATA || join(process.env.USERPROFILE || process.cwd(), "AppData", "Roaming");
  return join(root, "KaemSKP");
}

type LocalProfile = {
  namaPegawai?: string;
  nipUsername?: string;
  unitKerja?: string;
  jabatan?: string;
  tahunSkpAktif?: string;
  periodeSkp?: string;
  baseUrlSkp?: string;
  passwordEncrypted?: string;
  passwordIv?: string;
  passwordTag?: string;
};

function readLocalProfile(): LocalProfile {
  const path = join(dataDir(), "profile.json");
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as LocalProfile;
  } catch {
    return {};
  }
}

function decryptLocalPassword(profile: LocalProfile): string | null {
  if (!profile.passwordEncrypted || !profile.passwordIv || !profile.passwordTag) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", localSecret(), Buffer.from(profile.passwordIv, "base64"));
    decipher.setAuthTag(Buffer.from(profile.passwordTag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(profile.passwordEncrypted, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function localSecret(): Buffer {
  const material = [process.env.USERNAME, process.env.USERDOMAIN, process.env.COMPUTERNAME, dataDir()].filter(Boolean).join("|");
  return createHash("sha256").update(material).digest();
}

function encryptSecret(value: string, keyMaterial: string): string {
  const iv = randomBytes(12);
  const key = createHash("sha256").update(keyMaterial).digest();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(":");
}

function isEncryptedEnvelope(value: string): boolean {
  const parts = value.split(":");
  return parts.length === 4 && parts[0] === "v1" && parts.slice(1).every((part) => part.length > 0);
}

function stableUuid(userId: string, label: string): string {
  const hash = createHash("sha256").update(`${userId}:${label}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function isUuid(value: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(value);
}

function finish(report: MigrationReport, db: Database.Database | null): void {
  report.finishedAt = new Date().toISOString();
  report.finalStatus = report.ok ? "VERIFIED" : "FAILED";
  writeFileSync(join(process.cwd(), "migration-report.json"), JSON.stringify(report, null, 2), "utf8");
  db?.close();
  if (!report.ok) {
    console.error(report.blockedReason || report.validationErrors.join("; ") || "Migrasi belum valid.");
    process.exitCode = 1;
  }
}

void main();
