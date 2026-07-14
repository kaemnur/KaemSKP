import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { decryptSecret, encryptSecret, getSkpSessionStatus, isEncryptedEnvelope, readSkpSessionForBackend, saveSkpSession } from "../src/server/services/skpSecureStore";

dotenv.config({ path: ".env.local", quiet: true });
(globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = WebSocket;

type Row = Record<string, any>;

const API = "http://127.0.0.1:3726";
const sourceUserId = requiredEnv("KAEMSKP_MIGRATION_USER_ID");
const supabaseUrl = requiredEnv("SUPABASE_URL");
const serviceKey = requiredEnv("SUPABASE_SECRET_KEY");
const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "";
if (!publicKey) throw new Error("SUPABASE_PUBLISHABLE_KEY/VITE_SUPABASE_PUBLISHABLE_KEY wajib tersedia.");

const service = createRuntimeSupabaseClient(serviceKey);

async function main(): Promise<void> {
  const startedAt = Date.now();
  const primaryPassword = `Kskp-${Date.now()}-Primary!`;
  const secondaryPassword = `Kskp-${Date.now()}-Secondary!`;
  const primaryEmail = `kaemskp-runtime-primary-${Date.now()}@example.test`;
  const secondaryEmail = `kaemskp-runtime-secondary-${Date.now()}@example.test`;
  let server: ChildProcessWithoutNullStreams | null = null;
  let primaryUserId = "";
  let secondaryUserId = "";

  const report: Record<string, unknown> = {
    ok: false,
    dataBackend: null,
    fallbackUsed: null,
    login: "NOT_RUN",
    logout: "NOT_RUN",
    unauthenticated401: "NOT_RUN",
    rlsTwoUsers: "NOT_RUN",
    credentialEncryption: "NOT_RUN",
    sessionEncryption: "NOT_RUN",
    encryptDecrypt: "NOT_RUN",
    periodicJobItemsAudit: "NOT_RUN",
    counts: {}
  };

  try {
    const initialCounts = await managedCounts(sourceUserId);
    primaryUserId = await createRuntimeUser(primaryEmail, primaryPassword);
    secondaryUserId = await createRuntimeUser(secondaryEmail, secondaryPassword);
    await copyPlanAndLogs(sourceUserId, primaryUserId);

    server = await startServer();
    const health = await api<Record<string, unknown>>("/api/health");
    report.dataBackend = health.dataBackend;
    report.fallbackUsed = health.fallbackUsed;
    assert(health.dataBackend === "supabase" && health.fallbackUsed === false, "DATA_BACKEND/fallback tidak sesuai.");

    const primaryLogin = await signIn(primaryEmail, primaryPassword);
    const secondaryLogin = await signIn(secondaryEmail, secondaryPassword);
    const primaryToken = primaryLogin.token;
    const secondaryToken = secondaryLogin.token;
    report.login = "PASS";

    const noToken = await rawFetch("/api/logs");
    assert(noToken.status === 401, "Request tanpa token harus 401.");
    report.unauthenticated401 = "PASS";

    const plan = await api<Row>("/api/skp-plan/summary", primaryToken);
    assert(plan.hasActivePlan === true && Number(plan.totalItems) === 8, "Rencana SKP user utama test tidak terbaca.");
    const logs = await api<Row>("/api/logs?page=1&pageSize=1", primaryToken);
    assert(Number(logs.pagination?.total) === 185, "185 Log Harian user utama test tidak terbaca.");

    const created = await api<Row>("/api/logs", primaryToken, {
      method: "POST",
      body: JSON.stringify({
        tanggal: "2026-12-31",
        kode_skp: "SKP-2026-01",
        nama_aktivitas: "Runtime auth RLS test",
        deskripsi: "Runtime verification row",
        kuantitas_output: "1",
        satuan: "Dokumen"
      })
    });
    const updated = await api<Row>(`/api/logs/${created.id}`, primaryToken, {
      method: "PUT",
      body: JSON.stringify({ ...created, nama_aktivitas: "Runtime auth RLS test updated" })
    });
    assert(updated.nama_aktivitas === "Runtime auth RLS test updated", "Update CRUD Log Harian gagal.");
    await api<Row>(`/api/logs/${created.id}`, primaryToken, { method: "DELETE" });
    const afterCrud = await api<Row>("/api/logs?page=1&pageSize=1", primaryToken);
    assert(Number(afterCrud.pagination?.total) === 185, "Count Log Harian setelah CRUD tidak kembali ke 185.");

    const otherUserLogs = await api<Row>("/api/logs?page=1&pageSize=1", secondaryToken);
    assert(Number(otherUserLogs.pagination?.total) === 0, "User lain bisa membaca data user utama.");
    const directPrimary = await directCount("daily_logs", primaryToken);
    const directSecondary = await directCount("daily_logs", secondaryToken);
    assert(directPrimary === 185 && directSecondary === 0, "RLS SELECT auth.uid() tidak mengisolasi user.");
    const primaryLogId = (await api<Row>("/api/logs?page=1&pageSize=1", primaryToken)).data[0].id;
    const secondaryClient = createRuntimeSupabaseClient(publicKey, secondaryToken);
    const { data: forbiddenUpdate, error: forbiddenError } = await secondaryClient.from("daily_logs").update({ nama_aktivitas: "forbidden" }).eq("id", primaryLogId).select("id");
    assert(!forbiddenError && (forbiddenUpdate ?? []).length === 0, "User lain bisa mengubah data user utama.");
    report.rlsTwoUsers = "PASS";

    const testUsername = `runtime-user-${Date.now()}`;
    const testPassword = `runtime-password-${Date.now()}!`;
    await api<Row>("/api/skp-credentials", primaryToken, {
      method: "PUT",
      body: JSON.stringify({ username: testUsername, password: testPassword })
    });
    const credentialStatus = await api<Row>("/api/skp-credentials/status", primaryToken);
    assert(credentialStatus.configured === true, "Status credential tidak configured.");
    const credentialRows = await service.from("skp_credentials").select("encrypted_username,encrypted_password").eq("user_id", primaryUserId);
    if (credentialRows.error) throw new Error(credentialRows.error.message);
    const credentialRow = credentialRows.data?.[0];
    assert(isEncryptedEnvelope(credentialRow?.encrypted_username) && isEncryptedEnvelope(credentialRow?.encrypted_password), "Credential bukan envelope terenkripsi.");
    assert(!String(credentialRow.encrypted_username).includes(testUsername) && !String(credentialRow.encrypted_password).includes(testPassword), "Database mengandung plaintext credential.");
    report.credentialEncryption = "PASS";

    const encrypted = encryptSecret("roundtrip-value");
    assert(decryptSecret(encrypted) === "roundtrip-value", "Encrypt-decrypt roundtrip gagal.");
    report.encryptDecrypt = "PASS";

    const storageState = JSON.stringify({ cookies: [{ name: "runtime", value: "secret-cookie" }], origins: [] });
    await saveSkpSession(service, primaryUserId, { status: "connected", storageState, message: "runtime test" });
    const sessionRows = await service.from("skp_sessions").select("encrypted_storage_state").eq("user_id", primaryUserId);
    if (sessionRows.error) throw new Error(sessionRows.error.message);
    const encryptedStorageState = sessionRows.data?.[0]?.encrypted_storage_state;
    assert(isEncryptedEnvelope(encryptedStorageState) && !String(encryptedStorageState).includes("secret-cookie"), "Session SKP tidak terenkripsi.");
    const decryptedSession = await readSkpSessionForBackend(service, primaryUserId);
    assert(decryptedSession.storageState === storageState, "Session terenkripsi tidak bisa dibaca backend.");
    const sessionStatus = await getSkpSessionStatus(service, primaryUserId);
    assert(sessionStatus.status === "valid", "Status session terenkripsi bukan valid.");
    report.sessionEncryption = "PASS";

    const periodicCounts = await periodicAudit();
    assert(periodicCounts.periodicJobs === 25 && periodicCounts.periodicJobItems === 0, "Audit periodic_job_items tidak sesuai.");
    report.periodicJobItemsAudit = "PASS";

    const signOutResult = await primaryLogin.client.auth.signOut();
    assert(!signOutResult.error, "Logout Supabase gagal.");
    report.logout = "PASS";

    const finalCountsBeforeCleanup = await managedCounts(sourceUserId);
    report.counts = {
      sourceInitial: initialCounts,
      sourceFinal: finalCountsBeforeCleanup,
      runtimePrimaryBeforeCleanup: await managedCounts(primaryUserId),
      runtimeSecondaryBeforeCleanup: await managedCounts(secondaryUserId),
      periodic: periodicCounts
    };
    report.ok = true;
  } finally {
    if (server) await stopServer(server);
    if (primaryUserId) await service.auth.admin.deleteUser(primaryUserId).catch(() => undefined);
    if (secondaryUserId) await service.auth.admin.deleteUser(secondaryUserId).catch(() => undefined);
  }

  console.log(JSON.stringify({ ...report, elapsedMs: Date.now() - startedAt }, null, 2));
}

async function createRuntimeUser(email: string, password: string): Promise<string> {
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(error?.message ?? "Gagal membuat runtime user.");
  return data.user.id;
}

async function copyPlanAndLogs(fromUserId: string, toUserId: string): Promise<void> {
  const plans = await fetchServiceRows("skp_plans", fromUserId, "*");
  const planIdByOld = new Map<string, string>();
  const copiedPlans = plans.map((row) => {
    const id = stableUuid(toUserId, `plan:${row.id}`);
    planIdByOld.set(row.id, id);
    return { ...row, id, user_id: toUserId };
  });
  await insertRows("skp_plans", copiedPlans);

  const items = await fetchServiceRows("skp_plan_items", fromUserId, "*");
  await insertRows(
    "skp_plan_items",
    items.map((row) => ({ ...row, id: stableUuid(toUserId, `item:${row.id}`), user_id: toUserId, plan_id: planIdByOld.get(row.plan_id) ?? null }))
  );

  const logs = await fetchServiceRows("daily_logs", fromUserId, "*");
  await insertRows(
    "daily_logs",
    logs.map((row) => ({ ...row, id: stableUuid(toUserId, `log:${row.id}`), user_id: toUserId, plan_id: row.plan_id ? planIdByOld.get(row.plan_id) ?? null : null }))
  );
}

async function fetchServiceRows(table: string, userId: string, columns: string): Promise<Row[]> {
  const { data, error } = await service.from(table).select(columns).eq("user_id", userId).range(0, 9999);
  if (error) throw new Error(`${table}: ${error.message}`);
  return data ?? [];
}

async function insertRows(table: string, rows: Row[]): Promise<void> {
  for (let index = 0; index < rows.length; index += 100) {
    const { error } = await service.from(table).insert(rows.slice(index, index + 100));
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function startServer(): Promise<ChildProcessWithoutNullStreams> {
  const child = spawn("node", ["dist/server/server/index.js"], {
    env: {
      ...process.env,
      DATA_BACKEND: "supabase",
      KAEMSKP_NO_OPEN: "1",
      KAEMSKP_DISABLE_LOCAL_SCHEDULER: "1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", () => undefined);
  child.stderr.on("data", (chunk) => {
    const text = String(chunk);
    if (!/ExperimentalWarning|DeprecationWarning/i.test(text)) process.stderr.write(text);
  });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Server keluar sebelum siap: ${child.exitCode}`);
    const response = await rawFetch("/api/health").catch(() => null);
    if (response?.ok) return child;
    await sleep(250);
  }
  throw new Error("Server runtime tidak siap.");
}

async function stopServer(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill();
  await sleep(500);
}

async function signIn(email: string, password: string): Promise<{ token: string; client: ReturnType<typeof createClient> }> {
  const client = createRuntimeSupabaseClient(publicKey);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session?.access_token) throw new Error(error?.message ?? "Login Supabase gagal.");
  return { token: data.session.access_token, client };
}

async function directCount(table: string, token: string): Promise<number> {
  const client = createRuntimeSupabaseClient(publicKey, token);
  const { count, error } = await client.from(table).select("id", { count: "exact", head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

async function managedCounts(userId: string): Promise<Record<string, number>> {
  const tables = ["skp_plans", "skp_plan_items", "daily_logs", "periodic_jobs", "periodic_job_items", "skp_credentials", "skp_sessions"];
  const entries = await Promise.all(tables.map(async (table) => {
    const { count, error } = await service.from(table).select("id", { count: "exact", head: true }).eq("user_id", userId);
    if (error) throw new Error(`${table}: ${error.message}`);
    return [table, count ?? 0] as const;
  }));
  return Object.fromEntries(entries);
}

async function periodicAudit(): Promise<{ periodicJobs: number; periodicJobItems: number; sqliteDetailSource: "none" }> {
  const counts = await managedCounts(sourceUserId);
  return {
    periodicJobs: counts.periodic_jobs,
    periodicJobItems: counts.periodic_job_items,
    sqliteDetailSource: "none"
  };
}

async function api<T>(path: string, token?: string, init: RequestInit = {}): Promise<T> {
  const response = await rawFetch(path, token, init);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message ?? `HTTP ${response.status}`);
  return data as T;
}

function rawFetch(path: string, token?: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {})
    }
  });
}

function createRuntimeSupabaseClient(key: string, token?: string) {
  return createClient(supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
    realtime: {
      transport: WebSocket as unknown as typeof globalThis.WebSocket
    }
  });
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} wajib tersedia.`);
  return value;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function stableUuid(userId: string, label: string): string {
  const hash = createHash("sha256").update(`${userId}:${label}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
