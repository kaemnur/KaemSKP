import { contextBridge, ipcRenderer } from "electron";

const api = {
  getStatus: () => ipcRenderer.invoke("app:getStatus"),
  openLogin: () => ipcRenderer.invoke("auth:openLogin"),
  checkSession: () => ipcRenderer.invoke("auth:checkSession"),
  clearSession: () => ipcRenderer.invoke("auth:clearSession"),
  openSkp: () => ipcRenderer.invoke("skp:openLogPage"),
  fetchSkpOptions: () => ipcRenderer.invoke("skp:fetchOptions"),
  listLogs: (filters?: Record<string, string>) => ipcRenderer.invoke("logs:list", filters),
  saveLog: (payload: Record<string, unknown>) => ipcRenderer.invoke("logs:save", payload),
  deleteLog: (id: string) => ipcRenderer.invoke("logs:delete", id),
  runToday: () => ipcRenderer.invoke("logs:runToday"),
  runMissed: () => ipcRenderer.invoke("logs:runMissed"),
  runRange: (payload: { dateFrom: string; dateTo: string }) => ipcRenderer.invoke("logs:runRange", payload),
  retryFailed: () => ipcRenderer.invoke("logs:retryFailed"),
  pauseScheduler: () => ipcRenderer.invoke("scheduler:pause"),
  resumeScheduler: () => ipcRenderer.invoke("scheduler:resume"),
  chooseAndPreviewExcel: () => ipcRenderer.invoke("import:chooseAndPreview"),
  commitExcelImport: (mode: string) => ipcRenderer.invoke("import:commitExcel", mode),
  listSkp: () => ipcRenderer.invoke("skp:list"),
  listMappings: () => ipcRenderer.invoke("mapping:list"),
  updateMapping: (payload: Record<string, string>) => ipcRenderer.invoke("mapping:update", payload),
  listCalendar: (month?: string) => ipcRenderer.invoke("calendar:list", month),
  calendarDetail: (date: string) => ipcRenderer.invoke("calendar:detail", date),
  markCalendar: (payload: { date: string; status: string; reasonType: string; reasonNote: string }) => ipcRenderer.invoke("calendar:mark", payload),
  listHistory: (limit?: number) => ipcRenderer.invoke("history:list", limit),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  updateSettings: (payload: Record<string, string>) => ipcRenderer.invoke("settings:update", payload),
  openDataDir: () => ipcRenderer.invoke("settings:openDataDir")
};

contextBridge.exposeInMainWorld("kaemskp", api);

export type KaemSkpApi = typeof api;
