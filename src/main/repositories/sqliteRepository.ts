import {
  deleteDailyLog,
  deleteDailyLogsBulk,
  getActiveSkpPlanSummary,
  getDailyLog,
  listDailyLogsPage,
  listHistory,
  listLogSyncHistory,
  listSkpItems,
  listSkpMappings,
  listSyncHistory,
  listSyncQueue,
  updateSkpMapping,
  upsertDailyLog
} from "../db/database";
import type { DataRepository, DbHealth } from "./dataRepository";

export function createSqliteRepository(fallbackUsed = false): DataRepository {
  return {
    backend: "sqlite",
    fallbackUsed,
    async health(): Promise<DbHealth> {
      const startedAt = Date.now();
      try {
        const summary = getActiveSkpPlanSummary();
        return {
          ok: true,
          backend: "sqlite",
          fallbackUsed,
          status: fallbackUsed ? "degraded" : "ok",
          checkedAt: new Date().toISOString(),
          latencyMs: Date.now() - startedAt,
          counts: {
            skpPlans: summary.hasActivePlan ? 1 : 0,
            skpPlanItems: summary.totalItems,
            dailyLogs: listDailyLogsPage({ page: "1", pageSize: "1" }).summary.total
          },
          message: fallbackUsed ? "Supabase tidak siap; runtime memakai SQLite fallback." : "SQLite siap."
        };
      } catch {
        return {
          ok: false,
          backend: "sqlite",
          fallbackUsed,
          status: "error",
          checkedAt: new Date().toISOString(),
          latencyMs: Date.now() - startedAt,
          message: "Database SQLite tidak siap."
        };
      }
    },
    getActiveSkpPlanSummary: async () => getActiveSkpPlanSummary(),
    listSkpItems: async () => listSkpItems(),
    listSkpMappings: async () => listSkpMappings(),
    updateSkpMapping: async (payload) => updateSkpMapping(payload),
    listDailyLogsPage: async (filters = {}) => listDailyLogsPage(filters),
    getDailyLog: async (id) => getDailyLog(id),
    upsertDailyLog: async (input) => upsertDailyLog(input),
    deleteDailyLog: async (id) => deleteDailyLog(id),
    deleteDailyLogsBulk: async (ids) => deleteDailyLogsBulk(ids),
    listHistory: async (limit = 100) => listHistory(limit),
    listSyncQueue: async (limit = 200) => listSyncQueue(limit),
    listSyncHistory: async (limit = 200) => listSyncHistory(limit),
    listLogSyncHistory: async (logId) => listLogSyncHistory(logId)
  };
}
