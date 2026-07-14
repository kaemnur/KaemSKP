import { join } from "node:path";
import dotenv from "dotenv";
import WebSocket from "ws";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: join(process.cwd(), ".env.local"), quiet: true });

type Row = Record<string, any>;

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  const userId = process.env.KAEMSKP_MIGRATION_USER_ID;
  if (!url || !key || !userId) {
    throw new Error("SUPABASE_URL, SUPABASE_SECRET_KEY, dan KAEMSKP_MIGRATION_USER_ID wajib tersedia.");
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket }
  });

  const beforeCount = await countRows(supabase, userId);
  const plan = await activePlan(supabase, userId);
  const skpItem = await firstSkpItem(supabase, userId, plan.id);
  const kodeLog = `TEST-${Date.now()}`;
  let createdId = "";

  try {
    const inserted = await insertTestLog(supabase, userId, plan, skpItem, kodeLog);
    createdId = inserted.id;
    const afterInsertCount = await countRows(supabase, userId);
    if (afterInsertCount !== beforeCount + 1) throw new Error(`Count setelah insert tidak sesuai: ${afterInsertCount}`);

    const edited = await updateTestLog(supabase, userId, createdId);
    if (edited.nama_aktivitas !== "CRUD Supabase Test Edited") throw new Error("Update test log tidak terbaca.");

    await deleteTestLog(supabase, userId, createdId);
    createdId = "";
    const afterDeleteCount = await countRows(supabase, userId);
    if (afterDeleteCount !== beforeCount) throw new Error(`Count setelah delete tidak kembali: ${afterDeleteCount}`);

    console.log(
      JSON.stringify(
        {
          ok: true,
          beforeCount,
          afterInsertCount,
          afterDeleteCount,
          inserted: true,
          edited: true,
          deleted: true,
          testKodeLog: kodeLog
        },
        null,
        2
      )
    );
  } finally {
    if (createdId) {
      await supabase.from("daily_logs").delete().eq("user_id", userId).eq("id", createdId);
    }
  }
}

async function countRows(supabase: any, userId: string): Promise<number> {
  const { count, error } = await supabase.from("daily_logs").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (error) throw new Error(error.message);
  return Number(count ?? 0);
}

async function activePlan(supabase: any, userId: string): Promise<Row> {
  const { data, error } = await supabase.from("skp_plans").select("*").eq("user_id", userId).eq("is_active", true).limit(1).single();
  if (error) throw new Error(error.message);
  return data;
}

async function firstSkpItem(supabase: any, userId: string, planId: string): Promise<Row> {
  const { data, error } = await supabase
    .from("skp_plan_items")
    .select("*")
    .eq("user_id", userId)
    .eq("plan_id", planId)
    .order("kode_skp", { ascending: true })
    .limit(1)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function insertTestLog(supabase: any, userId: string, plan: Row, skpItem: Row, kodeLog: string): Promise<Row> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("daily_logs")
    .insert({
      user_id: userId,
      local_id: kodeLog,
      local_period_id: plan.local_period_id,
      plan_id: plan.id,
      kode_log: kodeLog,
      tanggal: "2026-07-13",
      kode_skp: skpItem.kode_skp,
      nama_skp: skpItem.nama_skp,
      nama_aktivitas: "CRUD Supabase Test",
      deskripsi: "Data test sementara untuk validasi repository Supabase.",
      indikator_kinerja_individu: "Validasi CRUD",
      kuantitas_output: "1",
      satuan: "kegiatan",
      link_tautan: null,
      status_local: "valid",
      status_skp: "not_submitted",
      reason_type: null,
      reason_note: null,
      source_file: "test-supabase-crud",
      source_hash: null,
      created_at: now,
      updated_at: now
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function updateTestLog(supabase: any, userId: string, id: string): Promise<Row> {
  const { data, error } = await supabase
    .from("daily_logs")
    .update({ nama_aktivitas: "CRUD Supabase Test Edited", updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function deleteTestLog(supabase: any, userId: string, id: string): Promise<void> {
  const { error } = await supabase.from("daily_logs").delete().eq("user_id", userId).eq("id", id);
  if (error) throw new Error(error.message);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
