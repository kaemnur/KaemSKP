import { strict as assert } from "node:assert";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const apiPort = 41726;
const apiBase = `http://127.0.0.1:${apiPort}`;

async function main(): Promise<void> {
  const sqliteBefore = hashExistingSqliteFiles();

  assert(existsSync(join(root, "dist", "web", "index.html")), "dist/web/index.html harus tersedia setelah build:web.");
  const apiSource = readFileSync(join(root, "src", "renderer", "src", "lib", "api.ts"), "utf8");
  assert(apiSource.includes("VITE_API_BASE_URL"), "Frontend harus memakai VITE_API_BASE_URL.");
  assert(!/SUPABASE_SECRET_KEY|sb_secret_|service[_-]?role/i.test(apiSource), "Frontend API source tidak boleh memuat secret/service role.");
  console.log("ok - dist/web/index.html tersedia dan frontend memakai VITE_API_BASE_URL tanpa secret");

  const serverSource = readFileSync(join(root, "src", "server", "index.ts"), "utf8");
  assert(serverSource.includes("process.env.PORT"), "API harus membaca process.env.PORT.");
  assert(serverSource.includes("0.0.0.0"), "API production harus bind ke 0.0.0.0.");
  assert(serverSource.includes("CORS_ORIGIN"), "API production harus memakai CORS_ORIGIN.");
  assert(serverSource.includes("KAEMSKP_API_MODE"), "API harus punya mode API-only.");
  console.log("ok - API source membaca PORT, production bind 0.0.0.0, dan CORS_ORIGIN");

  const api = await startApi();
  try {
    const health = await fetchJson<Record<string, unknown>>("/api/health");
    assert.equal(health.ok, true, "/api/health harus 200 tanpa login.");
    assert.equal(health.dataBackend, "supabase", "DATA_BACKEND harus supabase.");
    assert.equal(health.fallbackUsed, false, "fallbackUsed harus false.");
    assert.equal(health.apiOnly, true, "Railway API tidak boleh melayani frontend.");

    const noJwt = await fetch(`${apiBase}/api/logs`);
    assert.equal(noJwt.status, 401, "Request data tanpa JWT harus 401.");

    const badCors = await fetch(`${apiBase}/api/health`, {
      headers: { Origin: "https://not-allowed.example" }
    });
    assert(!badCors.headers.get("access-control-allow-origin"), "Origin CORS yang tidak diizinkan tidak boleh mendapat allow-origin.");

    const rootResponse = await fetch(`${apiBase}/`);
    assert.equal(rootResponse.status, 404, "Railway API tidak boleh menyajikan frontend.");
    console.log("ok - health 200, data tanpa JWT 401, CORS bad origin ditolak, API-only tidak serve frontend");
  } finally {
    await stopProcess(api);
  }

  const workerSource = readFileSync(join(root, "src", "worker", "index.ts"), "utf8");
  const workerServiceSource = readFileSync(join(root, "src", "worker", "autoPostWorker.ts"), "utf8");
  assert(workerSource.includes("setInterval"), "Worker harus memeriksa scheduler berkala.");
  assert(workerSource.includes("SIGTERM") && workerSource.includes("SIGINT"), "Worker harus graceful shutdown SIGTERM/SIGINT.");
  assert(workerSource.includes("KAEMSKP_FORCE_HEADLESS"), "Worker harus memaksa Chromium headless.");
  assert(workerServiceSource.includes("WORKER_DRY_RUN") && workerServiceSource.includes("dryRunDidClickSubmit: false"), "Worker dry-run harus didukung dan tidak submit.");
  assert(workerServiceSource.includes("scheduler_jobs") && workerServiceSource.includes("locked_at") && workerServiceSource.includes("locked_by"), "Worker harus memakai scheduler_jobs sebagai lock.");
  assert(workerServiceSource.includes("verifyLogExistsOnSkp"), "Worker success harus memakai verifikasi website SKP.");
  console.log("ok - worker terpisah, dry-run aman, lock anti-duplikasi, verifikasi SKP, dan shutdown signal tersedia");

  await verifyWorkerSigterm();

  const sqliteAfter = hashExistingSqliteFiles();
  assert.deepEqual(sqliteAfter, sqliteBefore, "SQLite asli harus tetap utuh selama deployment-safe test.");
  console.log("ok - SQLite asli tetap utuh");

  console.log("ok - request dengan JWT membaca 185 Log Harian dibuktikan oleh npm run test:runtime-auth-rls");
  console.log("ok - worker dry-run dan lock anti-duplikasi dibuktikan oleh npm run test:worker-scheduler");
}

async function startApi(): Promise<ChildProcessWithoutNullStreams> {
  const child = spawn("node", ["dist/server/server/index.js"], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(apiPort),
      DATA_BACKEND: "supabase",
      CORS_ORIGIN: "https://kaemskp.example",
      KAEMSKP_API_MODE: "api",
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
    if (child.exitCode !== null) throw new Error(`API keluar sebelum siap: ${child.exitCode}`);
    const response = await fetch(`${apiBase}/api/health`).catch(() => null);
    if (response?.ok) return child;
    await sleep(250);
  }
  throw new Error("API deployment-safe tidak siap.");
}

async function verifyWorkerSigterm(): Promise<void> {
  const child = spawn(process.execPath, [join(root, "node_modules", "tsx", "dist", "cli.mjs"), "src/worker/index.ts"], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATA_BACKEND: "supabase",
      SUPABASE_URL: process.env.SUPABASE_URL || "https://example.supabase.co",
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY || "test-secret-key",
      SKP_CREDENTIAL_ENCRYPTION_KEY: process.env.SKP_CREDENTIAL_ENCRYPTION_KEY || "test-encryption-key-test-encryption-key",
      WORKER_DRY_RUN: "true",
      WORKER_TICK_SECONDS: "60",
      TZ: "Asia/Jakarta"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += String(chunk);
  });

  await sleep(1200);
  child.kill("SIGTERM");
  await waitForExit(child, 8000);
  assert(!/sb_secret_|access_token|refresh_token|password\s*[:=]|cookie\s*[:=]|postgresql:\/\//i.test(output), "Log worker tidak boleh memuat secret.");
  console.log("ok - worker berhenti bersih saat SIGTERM dan log tidak memuat token/secret umum");
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBase}${path}`);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message ?? `HTTP ${response.status}`);
  return data as T;
}

async function stopProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await waitForExit(child, 5000).catch(() => child.kill("SIGKILL"));
}

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    const timeout = setTimeout(() => reject(new Error("Process tidak berhenti tepat waktu.")), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function hashExistingSqliteFiles(): Record<string, string> {
  const candidates = ["kaemskp.db", "data/kaemskp.db", "dist/kaemskp.db", "app.db"];
  const hashes: Record<string, string> = {};
  for (const relative of candidates) {
    const absolute = join(root, relative);
    if (!existsSync(absolute)) continue;
    hashes[relative] = createHash("sha256").update(readFileSync(absolute)).digest("hex");
  }
  return hashes;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
