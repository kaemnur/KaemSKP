import { config as loadEnv } from "dotenv";
import { join } from "node:path";
import { createAutoPostWorkerService } from "./autoPostWorker";

loadEnv({ path: join(process.cwd(), ".env.local"), override: false, quiet: true });

const tickSeconds = Math.min(60, Math.max(5, Number(process.env.WORKER_TICK_SECONDS ?? 60) || 60));
const dryRun = process.env.WORKER_DRY_RUN !== "false" || process.env.WORKER_ALLOW_REAL_SEND !== "true";
const service = createAutoPostWorkerService();

let stopping = false;
let running = false;

async function tick(): Promise<void> {
  if (running || stopping) return;
  running = true;
  try {
    const results = await service.tick({ dryRun });
    for (const result of results) {
      console.info(
        JSON.stringify({
          event: "worker.tick",
          workerId: result.workerId,
          dryRun: result.dryRun,
          nowWib: result.nowWib,
          targetDate: result.targetDate,
          nextAutoPostAt: result.nextAutoPostAt,
          status: result.status,
          jobId: result.jobId,
          dailyLogCount: result.dailyLogCount,
          message: result.message
        })
      );
    }
    if (results.length === 0) {
      console.info(JSON.stringify({ event: "worker.tick", dryRun, status: "idle", message: "Tidak ada user Auto Post aktif." }));
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "worker.error",
        dryRun,
        message: error instanceof Error ? error.message : String(error)
      })
    );
  } finally {
    running = false;
  }
}

console.info(
  JSON.stringify({
    event: "worker.start",
    workerId: service.workerId,
    dryRun,
    timezone: "Asia/Jakarta",
    tickSeconds
  })
);

void tick();
const timer = setInterval(() => void tick(), tickSeconds * 1000);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopping = true;
    clearInterval(timer);
    console.info(JSON.stringify({ event: "worker.stop", signal }));
    process.exit(0);
  });
}
