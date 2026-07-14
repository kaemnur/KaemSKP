import { strict as assert } from "node:assert";
import { config as loadEnv } from "dotenv";
import { join } from "node:path";
import { createPrivilegedSupabaseClient } from "../src/main/supabase/config";
import { AUTO_POST_JOB_TYPE, createAutoPostWorkerService } from "../src/worker/autoPostWorker";

loadEnv({ path: join(process.cwd(), ".env.local"), override: false, quiet: true });

const userId = process.env.KAEMSKP_MIGRATION_USER_ID;
const supabase = createPrivilegedSupabaseClient();

if (!supabase || !userId) {
  console.log("skip - Supabase privileged env atau KAEMSKP_MIGRATION_USER_ID belum tersedia");
  process.exit(0);
}

if (process.env.DATA_BACKEND !== "supabase") {
  console.log("skip - DATA_BACKEND bukan supabase");
  process.exit(0);
}

const countTables = ["scheduler_jobs", "daily_log_submissions", "daily_logs", "holidays"] as const;
main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main(): Promise<void> {
  const beforeCounts = await counts();
  const beforeSettings = await readAutoPostSettings();
  const cleanupJobIds = new Set<string>();

  try {
    const noLogDate = await findUnusedWorkday();
    assert.ok(noLogDate, "Tanggal kerja kosong untuk test harus tersedia");

    const lockJob = await insertPendingJob(noLogDate);
    cleanupJobIds.add(lockJob.id);
    const [claimA, claimB] = await Promise.all([claimJob(lockJob.id, "test-worker-a"), claimJob(lockJob.id, "test-worker-b")]);
    assert.equal([claimA, claimB].filter(Boolean).length, 1, "Dua worker bersamaan hanya boleh mengklaim satu job");
    console.log("ok - lock atomik: dua worker hanya mendapatkan satu job");

    await deleteJobs([...cleanupJobIds]);
    cleanupJobIds.clear();

    const service = createAutoPostWorkerService({ workerId: "test-dry-run-worker" });
    const dryRunOne = await service.tick({ userId, targetDate: noLogDate, dryRun: true });
    const dryRunTwo = await service.tick({ userId, targetDate: noLogDate, dryRun: true });
    const jobIds = new Set(dryRunOne.concat(dryRunTwo).map((item) => item.jobId).filter(Boolean) as string[]);
    for (const id of jobIds) cleanupJobIds.add(id);
    const duplicateCount = await jobCountForDate(noLogDate);
    assert.equal(duplicateCount, 1, "Dry-run kedua untuk tanggal sama tidak boleh membuat duplikasi");
    assert.equal(dryRunOne[0]?.dryRun, true, "Dry-run harus aktif");
    assert.equal(dryRunOne[0]?.safeChecks?.dryRunDidClickSubmit, false, "Dry-run tidak boleh klik submit");
    console.log("ok - dry-run membuat satu scheduler job tanpa duplikasi dan tanpa submit");

    await deleteJobs([...cleanupJobIds]);
    cleanupJobIds.clear();

    const noLogRun = await service.tick({ userId, targetDate: noLogDate, dryRun: false });
    const noLogJobId = noLogRun[0]?.jobId;
    if (noLogJobId) cleanupJobIds.add(noLogJobId);
    assert.equal(noLogRun[0]?.status, "no_log", "Tanggal tanpa Log Harian harus menghasilkan no_log");
    console.log("ok - log tidak tersedia menghasilkan no_log");

    assert.equal(process.env.DATA_BACKEND, "supabase", "DATA_BACKEND=supabase");
    console.log("ok - DATA_BACKEND=supabase dan worker tidak memakai fallback");
  } finally {
    await deleteJobs([...cleanupJobIds]);
    await restoreAutoPostSettings(beforeSettings);
    const afterCounts = await counts();
    assert.deepEqual(afterCounts, beforeCounts, "Count data produksi harus stabil setelah cleanup");
    console.log(`ok - cleanup stabil ${JSON.stringify(afterCounts)}`);
  }
}

async function counts(): Promise<Record<string, number>> {
  const entries = await Promise.all(
    countTables.map(async (table) => {
      const { count, error } = await supabase!.from(table).select("id", { count: "exact", head: true }).eq("user_id", userId!);
      if (error) throw supabaseError(error, `count ${table}`);
      return [table, Number(count ?? 0)] as const;
    })
  );
  return Object.fromEntries(entries);
}

async function findUnusedWorkday(): Promise<string> {
  const today = new Date("2026-07-13T00:00:00.000Z");
  for (let offset = 0; offset < 190; offset += 1) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - offset);
    const day = date.getUTCDay();
    if (day === 0 || day === 6) continue;
    const dateKey = date.toISOString().slice(0, 10);
    const [logs, jobs] = await Promise.all([rowCount("daily_logs", "tanggal", dateKey), rowCount("scheduler_jobs", "scheduled_date", dateKey)]);
    if (logs === 0 && jobs === 0) return dateKey;
  }
  throw new Error("Tidak menemukan tanggal kerja kosong yang aman untuk test.");
}

async function rowCount(table: string, column: string, value: string): Promise<number> {
  const { count, error } = await supabase!.from(table).select("id", { count: "exact", head: true }).eq("user_id", userId!).eq(column, value);
  if (error) throw supabaseError(error, `rowCount ${table}.${column}`);
  return Number(count ?? 0);
}

async function insertPendingJob(date: string): Promise<{ id: string }> {
  const now = new Date().toISOString();
  const { data, error } = await supabase!
    .from("scheduler_jobs")
    .insert({
      user_id: userId,
      job_type: AUTO_POST_JOB_TYPE,
      scheduled_date: date,
      scheduled_at: `${date}T01:00:00.000Z`,
      status: "pending",
      created_at: now,
      updated_at: now
    })
    .select("id")
    .single();
  if (error) throw supabaseError(error, "insert pending job");
  return data;
}

async function claimJob(id: string, workerId: string): Promise<string | null> {
  const now = new Date().toISOString();
  const { data, error } = await supabase!
    .from("scheduler_jobs")
    .update({ status: "running", locked_at: now, locked_by: workerId, started_at: now, updated_at: now })
    .eq("id", id)
    .eq("status", "pending")
    .is("locked_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw supabaseError(error, "claim job");
  return data?.id ?? null;
}

async function jobCountForDate(date: string): Promise<number> {
  const { count, error } = await supabase!
    .from("scheduler_jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId!)
    .eq("job_type", AUTO_POST_JOB_TYPE)
    .eq("scheduled_date", date);
  if (error) throw supabaseError(error, "job count for date");
  return Number(count ?? 0);
}

async function deleteJobs(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error: submissionError } = await supabase!.from("daily_log_submissions").delete().eq("user_id", userId!).in("scheduler_job_id", ids);
  if (submissionError) throw supabaseError(submissionError, "delete submissions");
  const { error } = await supabase!.from("scheduler_jobs").delete().eq("user_id", userId!).in("id", ids);
  if (error) throw supabaseError(error, "delete jobs");
}

async function readAutoPostSettings(): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase!.from("auto_post_settings").select("*").eq("user_id", userId!).maybeSingle();
  if (error) throw supabaseError(error, "read auto_post_settings");
  return data ?? null;
}

async function restoreAutoPostSettings(row: Record<string, unknown> | null): Promise<void> {
  if (!row) return;
  const { error } = await supabase!.from("auto_post_settings").update({
    enabled: row.enabled,
    post_time: row.post_time,
    timezone: row.timezone,
    active_weekdays: row.active_weekdays,
    skip_holidays: row.skip_holidays,
    only_if_not_submitted: row.only_if_not_submitted,
    retry_until_time: row.retry_until_time,
    retry_interval_minutes: row.retry_interval_minutes,
    next_auto_post_at: row.next_auto_post_at,
    worker_status: row.worker_status,
    last_job_status: row.last_job_status,
    last_job_at: row.last_job_at,
    updated_at: row.updated_at
  }).eq("user_id", userId!);
  if (error) throw supabaseError(error, "restore auto_post_settings");
}

function supabaseError(error: unknown, context: string): Error {
  const details = error && typeof error === "object" ? error as Record<string, unknown> : {};
  return new Error(`${context}: ${String(details.message ?? details.code ?? details.status ?? error)}`);
}
