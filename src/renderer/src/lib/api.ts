import { supabase } from "@/lib/supabase";

type QueryValue = string | number | boolean | undefined | null;

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim().replace(/\/+$/, "") ?? "";

export const isVercelDeployTarget = import.meta.env.VITE_DEPLOY_TARGET === "vercel";

function apiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return apiBaseUrl ? `${apiBaseUrl}${normalizedPath}` : normalizedPath;
}

function toQuery(params?: Record<string, QueryValue>): string {
  if (!params) return "";
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

async function request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  const authHeaders = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: options.body instanceof FormData
      ? { ...authHeaders, ...(options.headers ?? {}) }
      : { "Content-Type": "application/json", ...authHeaders, ...(options.headers ?? {}) }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.message ?? "Permintaan API gagal.");
  }
  return data as T;
}

export const api = {
  getStatus: () => request("/api/dashboard"),
  getSupabaseStatus: () => request("/api/supabase/status"),
  getTodayLogStatus: () => request("/api/dashboard/today-log-status"),
  getMonthlySuccess: (year = 2026) => request(`/api/dashboard/monthly-success${toQuery({ year })}`),
  authStatus: () => request("/api/auth/status"),
  openLogin: () => request("/api/auth/open-login", { method: "POST" }),
  checkSession: () => request("/api/auth/check-session"),
  clearSession: () => request("/api/auth/clear-session", { method: "POST" }),
  openSkp: () => request("/api/skp/open-log-page", { method: "POST" }),
  fetchSkpOptions: () => request("/api/mapping-skp/refresh", { method: "POST" }),
  listLogs: (filters?: Record<string, string | number>) => request(`/api/logs${toQuery(filters)}`),
  getLog: (id: string) => request(`/api/logs/${id}`),
  saveLog: (payload: Record<string, unknown>) => {
    const id = typeof payload.id === "string" ? payload.id : "";
    return request(id ? `/api/logs/${id}` : "/api/logs", { method: id ? "PUT" : "POST", body: JSON.stringify(payload) });
  },
  deleteLog: (id: string) => request(`/api/logs/${id}`, { method: "DELETE" }),
  deleteLogsBulk: (ids: string[]) => request("/api/logs/bulk", { method: "DELETE", body: JSON.stringify({ ids }) }),
  deleteAllLogs: (confirm: string) => request("/api/logs/all", { method: "DELETE", body: JSON.stringify({ confirm }) }),
  markLogSubmitted: (id: string) => request(`/api/logs/${id}/mark-submitted`, { method: "POST" }),
  skipLog: (id: string) => request(`/api/logs/${id}/skip`, { method: "POST" }),
  logSyncHistory: (id: string) => request(`/api/logs/${id}/sync-history`),
  revalidateLog: (id: string) => request(`/api/logs/${id}/revalidate`, { method: "POST" }),
  reconcileLog: (id: string) => request(`/api/logs/${id}/reconcile-skp`, { method: "POST" }),
  runLog: (id: string) => request(`/api/logs/${id}/run`, { method: "POST" }),
  runToday: () => request("/api/run/today", { method: "POST" }),
  runMissed: () => request("/api/run/missed", { method: "POST" }),
  runRange: (payload: { dateFrom: string; dateTo: string; mode?: "range" | "not_submitted" | "failed_only" }) =>
    request("/api/run/range", { method: "POST", body: JSON.stringify(payload) }),
  previewRunRange: (payload: { dateFrom: string; dateTo: string; mode?: "range" | "not_submitted" | "failed_only" }) =>
    request("/api/run/range/preview", { method: "POST", body: JSON.stringify(payload) }),
  getRunJob: (jobId: string) => request(`/api/run/jobs/${jobId}`),
  stopRunJob: (jobId: string) => request(`/api/run/jobs/${jobId}/stop`, { method: "POST" }),
  retryFailed: () => request("/api/run/retry-failed", { method: "POST" }),
  pauseScheduler: () => request("/api/scheduler/pause", { method: "POST" }),
  resumeScheduler: () => request("/api/scheduler/resume", { method: "POST" }),
  previewExcel: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request("/api/import/preview", { method: "POST", body });
  },
  commitExcelImport: (mode: string) => request("/api/import/commit", { method: "POST", body: JSON.stringify({ mode }) }),
  getProfile: () => request("/api/profile"),
  saveProfile: (payload: Record<string, string>) => request("/api/profile", { method: "POST", body: JSON.stringify(payload) }),
  testProfileLogin: () => request("/api/profile/test-login", { method: "POST" }),
  revealProfilePassword: () => request("/api/profile/credentials/reveal", { method: "POST" }),
  deleteProfileCredentials: () => request("/api/profile/credentials", { method: "DELETE" }),
  deleteProfile: () => request("/api/profile", { method: "DELETE" }),
  skpCredentialStatus: () => request("/api/skp-credentials/status"),
  saveSkpCredentials: (payload: { username: string; password: string }) =>
    request("/api/skp-credentials", { method: "PUT", body: JSON.stringify(payload) }),
  deleteSkpCredentials: () => request("/api/skp-credentials", { method: "DELETE" }),
  skpSessionStatus: () => request("/api/skp-session/status"),
  getSkpPlanSummary: () => request("/api/skp-plan/summary"),
  previewSkpPlanPdf: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request("/api/skp-plan/preview", { method: "POST", body });
  },
  saveSkpPlan: (plan?: Record<string, unknown>) => request("/api/skp-plan/commit", { method: "POST", body: JSON.stringify(plan ? { plan } : {}) }),
  exportMasterSkp: () => request("/api/skp-plan/export-master", { method: "POST" }),
  listSkp: () => request("/api/skp"),
  listMappings: () => request("/api/mapping-skp"),
  updateMapping: (payload: Record<string, string>) => request("/api/mapping-skp", { method: "POST", body: JSON.stringify(payload) }),
  periodicDefaults: () => request("/api/periodic/defaults"),
  periodicPreview: (params?: { year?: number; quarter?: number; feedbackLink?: string }) => request(`/api/periodic/preview${toQuery(params)}`),
  generatePeriodic: (payload: { year: number; quarter: number; feedbackLink?: string }) =>
    request("/api/periodic/generate", { method: "POST", body: JSON.stringify(payload) }),
  fillPeriodic: (payload: { year: number; quarter: number; items: Array<Record<string, unknown>>; overwrite?: boolean }) =>
    request("/api/periodic/fill", { method: "POST", body: JSON.stringify(payload) }),
  submitPeriodic: (payload: { year: number; quarter: number; items?: Array<Record<string, unknown>>; overwrite?: boolean }) =>
    request("/api/periodic/submit", { method: "POST", body: JSON.stringify(payload) }),
  periodicHistory: (limit?: number) => request(`/api/periodic/history${toQuery({ limit })}`),
  updatePeriodicSettings: (payload: { periodic_feedback_link: string }) =>
    request("/api/periodic/settings", { method: "POST", body: JSON.stringify(payload) }),
  listCalendar: (month?: string) => request(`/api/calendar${toQuery({ month })}`),
  listHolidays: () => request("/api/holidays"),
  calendarDetail: (date: string) => request(`/api/calendar/${date}`),
  markCalendar: (payload: { date: string; status: string; reasonType: string; reasonNote: string }) =>
    request("/api/calendar/mark", { method: "POST", body: JSON.stringify(payload) }),
  listHistory: (limit?: number) => request(`/api/history${toQuery({ limit })}`),
  listSyncQueue: (limit?: number) => request(`/api/sync-queue${toQuery({ limit })}`),
  listSyncHistory: (limit?: number) => request(`/api/sync-history${toQuery({ limit })}`),
  getSettings: () => request("/api/settings"),
  updateSettings: (payload: Record<string, string>) => request("/api/settings", { method: "POST", body: JSON.stringify(payload) }),
  openDataDir: () => request("/api/system/open-data-dir", { method: "POST" }),
  backupDatabase: () => request("/api/system/backup-database", { method: "POST" }),
  restoreDatabase: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request("/api/system/restore-database", { method: "POST", body });
  },
  clearLocalLogs: () => request("/api/system/clear-local-logs", { method: "POST" })
};
