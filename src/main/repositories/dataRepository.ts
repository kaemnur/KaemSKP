import type { ActivityHistory, DailyLog, SkpItem, SkpPlanSummary } from "../types";

export type DailyLogPage = {
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
};

export type DeleteLogsResult = { success: true; deletedCount: number; remainingCount: number };

export type DbHealth = {
  ok: boolean;
  backend: "sqlite" | "supabase";
  fallbackUsed: boolean;
  status: "ok" | "degraded" | "error";
  checkedAt: string;
  latencyMs: number;
  counts?: {
    skpPlans?: number;
    skpPlanItems?: number;
    dailyLogs?: number;
  };
  message?: string;
};

export type DataRepository = {
  backend: "sqlite" | "supabase";
  fallbackUsed: boolean;
  health(): Promise<DbHealth>;
  getActiveSkpPlanSummary(): Promise<SkpPlanSummary>;
  listSkpItems(): Promise<SkpItem[]>;
  listSkpMappings(): Promise<Array<Record<string, string | number | null>>>;
  updateSkpMapping(payload: { kode_skp: string; site_option_text: string; site_option_value: string; match_status: string }): Promise<void>;
  listDailyLogsPage(filters?: Record<string, string | undefined>): Promise<DailyLogPage>;
  getDailyLog(id: string): Promise<DailyLog | undefined>;
  upsertDailyLog(input: Partial<DailyLog>): Promise<DailyLog>;
  deleteDailyLog(id: string): Promise<DeleteLogsResult>;
  deleteDailyLogsBulk(ids: string[]): Promise<DeleteLogsResult>;
  listHistory(limit?: number): Promise<ActivityHistory[]>;
  listSyncQueue(limit?: number): Promise<Array<Record<string, unknown>>>;
  listSyncHistory(limit?: number): Promise<Array<Record<string, unknown>>>;
  listLogSyncHistory(logId: string): Promise<Array<Record<string, unknown>>>;
};

export function requestedBackend(): "sqlite" | "supabase" {
  return process.env.DATA_BACKEND === "supabase" ? "supabase" : "sqlite";
}
