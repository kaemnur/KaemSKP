import cors from "cors";
import express from "express";
import multer from "multer";
import { createServer } from "node:http";
import { exec } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import dotenv from "dotenv";
import {
  commitImportPreview,
  deleteAllDailyLogsLocal,
  deleteDailyLog,
  deleteDailyLogsBulk,
  getCalendarDetail,
  getDashboardData,
  getDataDir,
  getDbPath,
  getActiveSkpPlanSummary,
  getDailyLog,
  initDatabase,
  getMonthlySuccessData,
  getTodayLogStatus,
  listCalendarStatus,
  listActiveHolidays,
  listDailyLogsPage,
  listHistory,
  listLogSyncHistory,
  listSettings,
  listSkpItems,
  listSkpMappings,
  listSyncHistory,
  listSyncQueue,
  markDailyLogSubmittedManual,
  markCalendarDate,
  skipDailyLog,
  updateSettings,
  updateSkpMapping,
  upsertDailyLog,
  backupDatabase,
  restoreDatabaseFromFile,
  clearLocalLogData
} from "../main/db/database";
import { checkSupabaseConnection, readSupabaseConfig } from "../main/supabase/config";
import { getRepository } from "../main/repositories";
import { requestedBackend } from "../main/repositories/dataRepository";
import { createSupabaseRepositoryForUser } from "../main/repositories/supabaseRepository";
import { closeAutomation, fetchSkpDropdownOptions } from "../main/automation/skpAutomation";
import { previewExcelImport } from "../main/import/excelImportService";
import { deleteProfile, deleteProfileCredentials, getProfilePassword, readPublicProfile, saveProfile } from "../main/config/profileService";
import { exportActiveMasterSkpExcel, parseSkpPlanPdf, saveParsedSkpPlan } from "../main/skpPlan/skpPlanService";
import {
  currentPeriodicDefaults,
  fillPeriodicFromPreview,
  generatePeriodicPreview,
  listPeriodicHistory,
  submitPeriodicOnly,
  updatePeriodicSettings
} from "../main/periodic/periodicService";
import {
  getRunJob,
  pauseScheduler,
  previewRange,
  reconcileLogStatusWithSkp,
  resumeScheduler,
  retryFailed,
  runLogById,
  runMissed,
  runRange,
  runToday,
  startScheduler,
  stopRunJob
} from "../main/scheduler/autoRunScheduler";
import type { ImportPreview } from "../main/types";
import type { SkpPlanParseResult } from "../main/types";
import { revalidateDailyLog } from "../main/validation/dailyLogValidation";
import { checkSession, clearSession, getAuthStatus, openLogin, openSkp } from "./services/skpAuthService";
import { requireAuthenticatedRequest, requireSupabaseAuth } from "./authMiddleware";
import { createPrivilegedSupabaseClient } from "../main/supabase/config";
import { setRuntimeSkpCredentials } from "../main/automation/skpSession";
import { createAutoPostWorkerService } from "../worker/autoPostWorker";
import { createHoliday, deleteHoliday, importHolidays, listHolidays, updateHoliday } from "./services/holidayService";
import {
  deleteCredentials,
  getCredentialStatus,
  getPublicSkpAuthStatus,
  getSkpSessionStatus as getEncryptedSkpSessionStatus,
  readCredentialsForBackend,
  saveCredentials,
  saveSkpSession
} from "./services/skpSecureStore";
import { getSupabaseDashboardData, getSupabaseMonthlySuccessData, getSupabaseTodayLogStatus } from "./services/dashboardService";

dotenv.config({ path: join(process.cwd(), ".env.local"), override: false });

const PORT = Number(process.env.PORT ?? process.env.KAEMSKP_PORT ?? 3726) || 3726;
const isProduction = process.env.NODE_ENV === "production";
const isDev = !isProduction && process.argv.includes("--dev");
const isApiOnlyMode = process.env.KAEMSKP_API_MODE === "api" || Boolean(process.env.RAILWAY_ENVIRONMENT);
const HOST = process.env.KAEMSKP_HOST || (isProduction ? "0.0.0.0" : "127.0.0.1");
const PASSWORD_MASK = "********";
let lastPreview: ImportPreview | null = null;
let lastSkpPlanPreview: SkpPlanParseResult | null = null;

function corsOrigin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void): void {
  if (!origin) {
    callback(null, true);
    return;
  }

  const allowedOrigins = (process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(origin);

  if (isProduction) {
    callback(null, allowedOrigins.includes(origin));
    return;
  }

  callback(null, isLocalhost || allowedOrigins.includes(origin));
}

async function main(): Promise<void> {
  initDatabase();
  if (process.env.KAEMSKP_DISABLE_LOCAL_SCHEDULER !== "1") {
    startScheduler();
  }

  const app = express();
  app.use(cors({
    origin: corsOrigin,
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
  }));
  app.use(express.json({ limit: "10mb" }));

  const uploadDir = join(getDataDir(), "imports");
  mkdirSync(uploadDir, { recursive: true });
  const upload = multer({ dest: uploadDir });

  app.get("/api/health", (_req, res) => {
    const backend = requestedBackend();
    res.json({ ok: true, name: "KaemSKP", port: serverAddress?.port ?? null, dataBackend: backend, fallbackUsed: false, apiOnly: isApiOnlyMode });
  });
  app.get("/api/health/database", requireSupabaseAuth, async (req, res, next) => {
    try {
      res.json(await repositoryFor(req).health());
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/supabase/status", async (_req, res, next) => {
    try {
      const config = readSupabaseConfig();
      const status = await checkSupabaseConnection();
      res.json({
        ...status,
        urlConfigured: Boolean(config.url),
        publishableKeyConfigured: Boolean(config.publishableKey),
        secretKeyConfigured: Boolean(config.secretKey),
        databaseUrlConfigured: Boolean(config.databaseUrl)
      });
    } catch (error) {
      next(error);
    }
  });

  app.use("/api", requireSupabaseAuth);

  app.get("/api/settings", (_req, res) => res.json(publicSettings()));
  app.post("/api/settings", (req, res) => {
    const payload = { ...(req.body ?? {}) };
    if (payload.skp_password === PASSWORD_MASK) delete payload.skp_password;
    res.json(maskSensitiveSettings(updateSettings(payload)));
  });

  app.get("/api/profile", (_req, res) => res.json(readPublicProfile()));
  app.post("/api/profile", (req, res) => {
    const profile = saveProfile(req.body ?? {});
    const settingsPayload: Record<string, string> = {
      skp_username: profile.nipUsername,
      skp_base_url: profile.baseUrlSkp,
      skp_password: ""
    };
    if (profile.tahunSkpAktif) settingsPayload.active_year = profile.tahunSkpAktif;
    updateSettings(settingsPayload);
    res.json(profile);
  });
  app.delete("/api/profile/credentials", (_req, res) => {
    const profile = deleteProfileCredentials();
    updateSettings({ skp_username: "", skp_password: "" });
    res.json(profile);
  });
  app.post("/api/profile/credentials/reveal", (_req, res) => {
    res.status(403).json({ ok: false, message: "Password SKP tidak pernah dikirim kembali ke frontend." });
  });
  app.delete("/api/profile", (_req, res) => {
    const profile = deleteProfile();
    updateSettings({ skp_username: "", skp_password: "" });
    res.json(profile);
  });
  app.post("/api/profile/test-login", async (req, res, next) => {
    try {
      if (isApiOnlyMode) return deploymentOnlyResponse(res);
      res.json(await openLoginForRequest(req));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/dashboard", async (req, res, next) => {
    try {
      if (usesSupabaseRuntime()) {
        res.json(await getSupabaseDashboardData(requireSupabaseClient(), authUserId(req)));
        return;
      }
      res.json(getDashboardData(getAuthStatus().status));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/dashboard/monthly-success", async (req, res, next) => {
    try {
      const requestedYear = Number(req.query.year ?? 2026);
      const year = Number.isFinite(requestedYear) ? requestedYear : 2026;
      if (usesSupabaseRuntime()) {
        res.json(await getSupabaseMonthlySuccessData(requireSupabaseClient(), authUserId(req), year));
        return;
      }
      res.json(getMonthlySuccessData(year));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/dashboard/today-log-status", async (req, res, next) => {
    try {
      if (usesSupabaseRuntime()) {
        res.json(await getSupabaseTodayLogStatus(requireSupabaseClient(), authUserId(req)));
        return;
      }
      res.json(getTodayLogStatus(getAuthStatus().status));
    } catch (error) {
      console.error("Gagal membaca status log hari ini", error);
      res.json(todayLogStatusError());
    }
  });

  app.get("/api/logs", async (req, res, next) => {
    try {
      res.json(await repositoryFor(req).listDailyLogsPage(req.query as Record<string, string>));
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/logs", async (req, res, next) => {
    try {
      res.json(await repositoryFor(req).upsertDailyLog(req.body));
    } catch (error) {
      next(error);
    }
  });
  app.delete("/api/logs/bulk", async (req, res, next) => {
    try {
      res.json(await repositoryFor(req).deleteDailyLogsBulk(Array.isArray(req.body?.ids) ? req.body.ids : []));
    } catch (error) {
      next(error);
    }
  });
  app.delete("/api/logs/all", (req, res) => {
    res.json(deleteAllDailyLogsLocal(req.body?.confirm));
  });
  app.get("/api/logs/:id", async (req, res, next) => {
    try {
      const log = await repositoryFor(req).getDailyLog(req.params.id);
      if (!log) return res.status(404).json({ ok: false, message: "Log tidak ditemukan." });
      return res.json(log);
    } catch (error) {
      next(error);
    }
  });
  app.put("/api/logs/:id", async (req, res, next) => {
    try {
      res.json(await repositoryFor(req).upsertDailyLog({ ...req.body, id: req.params.id }));
    } catch (error) {
      next(error);
    }
  });
  app.delete("/api/logs/:id", async (req, res, next) => {
    try {
      res.json(await repositoryFor(req).deleteDailyLog(req.params.id));
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/logs/:id/run", async (req, res, next) => {
    try {
      const result = await runLogById(req.params.id);
      res.json({ ...result, log: getDailyLog(req.params.id) ?? null });
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/logs/:id/revalidate", async (req, res, next) => {
    try {
      res.json(await revalidateDailyLog(req.params.id, { checkSiteMapping: true }));
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/logs/:id/reconcile-skp", async (req, res, next) => {
    try {
      res.json(await reconcileLogStatusWithSkp(req.params.id));
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/logs/:id/sync-history", async (req, res, next) => {
    try {
      res.json(await repositoryFor(req).listLogSyncHistory(req.params.id));
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/logs/:id/mark-submitted", (req, res) => res.json(markDailyLogSubmittedManual(req.params.id)));
  app.post("/api/logs/:id/skip", (req, res) => res.json(skipDailyLog(req.params.id)));

  app.post("/api/import/preview", upload.single("file"), async (req, res, next) => {
    try {
      if (!req.file) throw new Error("File Excel belum dipilih.");
      lastPreview = await previewExcelImport(req.file.path, req.file.originalname);
      res.json(lastPreview);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/import/commit", (req, res) => {
    if (!lastPreview) throw new Error("Belum ada preview import.");
    res.json(commitImportPreview(lastPreview, req.body?.mode ?? "update_changed"));
  });

  app.get("/api/skp-plan/summary", async (_req, res, next) => {
    try {
      res.json(await repositoryFor(_req).getActiveSkpPlanSummary());
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/skp-plan/preview", upload.single("file"), async (req, res, next) => {
    try {
      if (!req.file) throw new Error("File PDF Rencana SKP belum dipilih.");
      lastSkpPlanPreview = await parseSkpPlanPdf(req.file.path, req.file.originalname);
      res.json(lastSkpPlanPreview);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/skp-plan/commit", (req, res) => {
    const plan = (req.body?.plan as SkpPlanParseResult | undefined) ?? lastSkpPlanPreview;
    if (!plan) throw new Error("Belum ada preview Rencana SKP.");
    const summary = saveParsedSkpPlan(plan);
    saveProfile({
      namaPegawai: plan.profile.nama,
      nipUsername: plan.profile.nip,
      jabatan: plan.profile.jabatan,
      unitKerja: plan.profile.unitKerja,
      tahunSkpAktif: String(plan.profile.tahun),
      periodeSkp: `${plan.profile.periodeMulai} s/d ${plan.profile.periodeAkhir}`
    });
    res.json(summary);
  });
  app.post("/api/skp-plan/export-master", async (_req, res, next) => {
    try {
      res.json(await exportActiveMasterSkpExcel());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/calendar", (req, res) => res.json(listCalendarStatus(req.query.month as string | undefined)));
  app.get("/api/holidays", async (req, res, next) => {
    try {
      if (requestedBackend() === "supabase") {
        res.json(await listHolidays(requireSupabaseClient(), authUserId(req)));
        return;
      }
      res.json(listActiveHolidays());
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/holidays", async (req, res, next) => {
    try {
      res.json(await createHoliday(requireSupabaseClient(), authUserId(req), req.body ?? {}));
    } catch (error) {
      next(error);
    }
  });
  app.put("/api/holidays/:id", async (req, res, next) => {
    try {
      res.json(await updateHoliday(requireSupabaseClient(), authUserId(req), req.params.id, req.body ?? {}));
    } catch (error) {
      next(error);
    }
  });
  app.delete("/api/holidays/:id", async (req, res, next) => {
    try {
      res.json(await deleteHoliday(requireSupabaseClient(), authUserId(req), req.params.id));
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/holidays/import", upload.single("file"), async (req, res, next) => {
    try {
      const raw = req.file ? readFileSync(req.file.path, "utf8") : String(req.body?.content ?? "");
      res.json(await importHolidays(requireSupabaseClient(), authUserId(req), raw, req.body?.format));
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/calendar/:date", (req, res) => res.json(getCalendarDetail(req.params.date)));
  app.post("/api/calendar/mark", (req, res) => {
    markCalendarDate(req.body.date, req.body.status, req.body.reasonType, req.body.reasonNote);
    res.json({ ok: true });
  });

  app.get("/api/worker/status", async (req, res, next) => {
    try {
      res.json(await createAutoPostWorkerService().getStatus(authUserId(req)));
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/worker/next-run", async (req, res, next) => {
    try {
      res.json(await createAutoPostWorkerService().getNextRun(authUserId(req)));
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/worker/run-now", async (req, res, next) => {
    try {
      const requestedDryRun = req.body?.dryRun !== false;
      const dryRun = process.env.WORKER_ALLOW_REAL_SEND === "true" ? requestedDryRun : true;
      const results = await createAutoPostWorkerService().tick({
        userId: authUserId(req),
        targetDate: typeof req.body?.targetDate === "string" ? req.body.targetDate.slice(0, 10) : undefined,
        dryRun
      });
      res.json({ ok: true, dryRun, results });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/skp", async (_req, res, next) => {
    try {
      res.json(await repositoryFor(_req).listSkpItems());
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/mapping-skp", async (_req, res, next) => {
    try {
      res.json(await repositoryFor(_req).listSkpMappings());
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/mapping-skp", async (req, res, next) => {
    try {
      await repositoryFor(req).updateSkpMapping(req.body);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/mapping-skp/refresh", async (_req, res, next) => {
    try {
      if (isApiOnlyMode) return deploymentOnlyResponse(res);
      const options = await fetchSkpDropdownOptions();
      res.json(options);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/periodic/defaults", (_req, res, next) => {
    try {
      res.json(currentPeriodicDefaults());
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/periodic/preview", (req, res, next) => {
    try {
      res.json(
        generatePeriodicPreview({
          year: req.query.year ? Number(req.query.year) : undefined,
          quarter: req.query.quarter ? Number(req.query.quarter) : undefined,
          feedbackLink: typeof req.query.feedbackLink === "string" ? req.query.feedbackLink : undefined
        })
      );
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/periodic/generate", (req, res, next) => {
    try {
      res.json(
        generatePeriodicPreview({
          year: req.body?.year ? Number(req.body.year) : undefined,
          quarter: req.body?.quarter ? Number(req.body.quarter) : undefined,
          feedbackLink: req.body?.feedbackLink,
          persistFeedbackLink: true,
          recordHistory: true
        })
      );
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/periodic/fill", async (req, res, next) => {
    try {
      if (isApiOnlyMode) return deploymentOnlyResponse(res);
      res.json(
        await fillPeriodicFromPreview({
          year: req.body?.year ? Number(req.body.year) : undefined,
          quarter: req.body?.quarter ? Number(req.body.quarter) : undefined,
          items: Array.isArray(req.body?.items) ? req.body.items : [],
          overwrite: Boolean(req.body?.overwrite),
          submit: false
        })
      );
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/periodic/submit", async (req, res, next) => {
    try {
      if (isApiOnlyMode) return deploymentOnlyResponse(res);
      res.json(
        await submitPeriodicOnly({
          year: req.body?.year ? Number(req.body.year) : undefined,
          quarter: req.body?.quarter ? Number(req.body.quarter) : undefined,
          items: Array.isArray(req.body?.items) ? req.body.items : [],
          overwrite: Boolean(req.body?.overwrite)
        })
      );
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/periodic/history", (req, res, next) => {
    try {
      res.json(listPeriodicHistory(Number(req.query.limit ?? 100)));
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/periodic/settings", (req, res, next) => {
    try {
      res.json(updatePeriodicSettings(req.body ?? {}));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/run/today", async (_req, res, next) => {
    try {
      if (isApiOnlyMode) return deploymentOnlyResponse(res);
      res.json(await runToday());
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/run/missed", async (_req, res, next) => {
    try {
      if (isApiOnlyMode) return deploymentOnlyResponse(res);
      res.json(await runMissed());
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/run/range", async (req, res, next) => {
    try {
      if (isApiOnlyMode) return deploymentOnlyResponse(res);
      res.json(await runRange(req.body.dateFrom, req.body.dateTo, req.body.mode ?? "range"));
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/run/range/preview", (req, res) => {
    res.json(previewRange(req.body.dateFrom, req.body.dateTo, req.body.mode ?? "range"));
  });
  app.get("/api/run/jobs/:jobId", (req, res) => {
    const job = getRunJob(req.params.jobId);
    if (!job) return res.status(404).json({ ok: false, message: "Job tidak ditemukan." });
    return res.json(job);
  });
  app.post("/api/run/jobs/:jobId/stop", (req, res) => {
    res.json(stopRunJob(req.params.jobId));
  });
  app.post("/api/run/retry-failed", async (_req, res, next) => {
    try {
      if (isApiOnlyMode) return deploymentOnlyResponse(res);
      res.json(await retryFailed());
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/scheduler/pause", (_req, res) => {
    if (isApiOnlyMode) return deploymentOnlyResponse(res);
    pauseScheduler();
    res.json({ ok: true });
  });
  app.post("/api/scheduler/resume", (_req, res) => {
    if (isApiOnlyMode) return deploymentOnlyResponse(res);
    resumeScheduler();
    res.json({ ok: true });
  });

  app.get("/api/history", async (req, res, next) => {
    try {
      res.json(await repositoryFor(req).listHistory(Number(req.query.limit || 100)));
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/sync-queue", async (req, res, next) => {
    try {
      res.json(await repositoryFor(req).listSyncQueue(Number(req.query.limit || 200)));
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/sync-history", async (req, res, next) => {
    try {
      res.json(await repositoryFor(req).listSyncHistory(Number(req.query.limit || 200)));
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/skp-credentials/status", async (req, res, next) => {
    try {
      res.json(await getCredentialStatus(requireSupabaseClient(), authUserId(req)));
    } catch (error) {
      next(error);
    }
  });
  app.put("/api/skp-credentials", async (req, res, next) => {
    try {
      res.json(await saveCredentials(requireSupabaseClient(), authUserId(req), {
        username: String(req.body?.username ?? ""),
        password: String(req.body?.password ?? "")
      }));
    } catch (error) {
      next(error);
    }
  });
  app.delete("/api/skp-credentials", async (req, res, next) => {
    try {
      res.json(await deleteCredentials(requireSupabaseClient(), authUserId(req)));
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/skp-session/status", async (req, res, next) => {
    try {
      res.json(await getEncryptedSkpSessionStatus(requireSupabaseClient(), authUserId(req)));
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/auth/open-login", async (req, res, next) => {
    try {
      if (isApiOnlyMode) return deploymentOnlyResponse(res);
      res.json(await openLoginForRequest(req));
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/auth/check-session", async (_req, res, next) => {
    try {
      res.json(await checkSession());
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/auth/status", async (req, res, next) => {
    try {
      if (usesSupabaseRuntime()) {
        res.json(await getPublicSkpAuthStatus(requireSupabaseClient(), authUserId(req)));
        return;
      }
      res.json(getAuthStatus());
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/auth/clear-session", async (_req, res, next) => {
    try {
      res.json(await clearSession());
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/skp/open-log-page", async (_req, res, next) => {
    try {
      if (isApiOnlyMode) return deploymentOnlyResponse(res);
      res.json(await openSkp());
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/system/open-data-dir", (_req, res) => {
    if (isApiOnlyMode) return deploymentOnlyResponse(res);
    openPath(getDataDir());
    res.json({ ok: true });
  });
  app.post("/api/system/backup-database", async (_req, res, next) => {
    try {
      if (isApiOnlyMode) return deploymentOnlyResponse(res);
      res.json(await backupDatabase());
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/system/restore-database", upload.single("file"), (req, res, next) => {
    try {
      if (isApiOnlyMode) return deploymentOnlyResponse(res);
      if (!req.file) throw new Error("File database belum dipilih.");
      res.json(restoreDatabaseFromFile(req.file.path));
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/system/clear-local-logs", (_req, res) => {
    if (isApiOnlyMode) return deploymentOnlyResponse(res);
    res.json(clearLocalLogData());
  });

  if (isDev) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      root: join(process.cwd(), "src", "renderer"),
      resolve: {
        alias: {
          "@": join(process.cwd(), "src", "renderer", "src")
        }
      },
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else if (!isApiOnlyMode) {
    const webDir = join(__dirname, "..", "..", "web");
    app.use(express.static(webDir));
    app.get("*", (_req, res) => res.sendFile(join(webDir, "index.html")));
  } else {
    app.use((_req, res) => res.status(404).json({ ok: false, message: "Route tidak tersedia di service API." }));
  }

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ ok: false, message });
  });

  const server = createServer(app);
  server.listen(PORT, HOST, () => {
    serverAddress = { port: PORT };
    const url = `http://${HOST}:${PORT}`;
    console.log(`KaemSKP berjalan di ${url}`);
    if (!isProduction && !isApiOnlyMode) openBrowser(url);
  });
}

let serverAddress: { port: number } | null = null;

function openBrowser(url: string): void {
  if (process.env.KAEMSKP_NO_OPEN === "1") return;
  if (isProduction) return;
  if (process.platform === "win32") {
    exec(`start "" "${url}"`);
  } else if (process.platform === "darwin") {
    exec(`open "${url}"`);
  } else {
    exec(`xdg-open "${url}"`);
  }
}

function openPath(path: string): void {
  if (isApiOnlyMode) return;
  if (process.platform === "win32") {
    exec(`explorer "${path}"`);
  } else if (process.platform === "darwin") {
    exec(`open "${path}"`);
  } else {
    exec(`xdg-open "${path}"`);
  }
}

function deploymentOnlyResponse(res: express.Response): express.Response {
  return res.status(409).json({
    ok: false,
    code: "FEATURE_NOT_AVAILABLE_ON_RAILWAY_API",
    message: "Fitur ini hanya tersedia di aplikasi desktop lokal atau melalui background worker yang sesuai."
  });
}

function todayLogStatusError(): Record<string, unknown> {
  const date = todayDateKeyWIB();
  return {
    success: false,
    date,
    displayDate: displayDateWIB(date),
    state: "error",
    hasLog: false,
    logCount: 0,
    log: null,
    activeQueue: null,
    sessionStatus: "error",
    requiresLogin: false,
    canSubmit: false,
    message: "Gagal membaca log hari ini"
  };
}

function todayDateKeyWIB(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Jakarta"
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function displayDateWIB(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  const formatted = new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(value);
  return formatted ? formatted.charAt(0).toUpperCase() + formatted.slice(1) : date;
}

function publicSettings(): Record<string, string> {
  return { ...maskSensitiveSettings(listSettings()), db_path: getDbPath() };
}

function maskSensitiveSettings(settings: Record<string, string>): Record<string, string> {
  return {
    ...settings,
    skp_password: settings.skp_password ? PASSWORD_MASK : ""
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void closeAutomation().finally(() => process.exit(0));
  });
}

function repositoryFor(req: express.Request) {
  if (usesSupabaseRuntime()) {
    return createSupabaseRepositoryForUser(authUserId(req));
  }
  return getRepository();
}

function usesSupabaseRuntime(): boolean {
  return requestedBackend() === "supabase" || isApiOnlyMode;
}

function authUserId(req: express.Request): string {
  return requireAuthenticatedRequest(req).authUser.id;
}

function requireSupabaseClient() {
  const client = createPrivilegedSupabaseClient();
  if (!client) throw new Error("Konfigurasi Supabase backend belum lengkap.");
  return client;
}

async function openLoginForRequest(req: express.Request) {
  const client = requireSupabaseClient();
  const userId = authUserId(req);
  const credentials = await readCredentialsForBackend(client, userId);
  setRuntimeSkpCredentials(credentials);
  const status = await openLogin();
  if (status.status === "connected" && existsSync(getAuthStatePathForStore())) {
    const storageState = readFileSync(getAuthStatePathForStore(), "utf8");
    await saveSkpSession(client, userId, {
      status: "connected",
      storageState,
      displayName: status.displayName,
      message: status.message
    });
  }
  return status;
}

function getAuthStatePathForStore(): string {
  return join(getDataDir(), "sessions", "skp-auth-state.json");
}
