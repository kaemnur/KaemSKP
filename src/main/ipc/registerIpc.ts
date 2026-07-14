import { dialog, ipcMain, shell } from "electron";
import {
  commitImportPreview,
  deleteDailyLog,
  getCalendarDetail,
  getDashboardData,
  getDbPath,
  listCalendarStatus,
  listDailyLogs,
  listHistory,
  listSettings,
  listSkpItems,
  listSkpMappings,
  markCalendarDate,
  updateSettings,
  updateSkpMapping,
  upsertDailyLog
} from "../db/database";
import { checkSession, clearSessionData, fetchSkpDropdownOptions, openLogin } from "../automation/skpAutomation";
import { previewExcelImport } from "../import/excelImportService";
import { openSkpLogPage, pauseScheduler, resumeScheduler, retryFailed, runMissed, runRange, runToday } from "../scheduler/autoRunScheduler";
import type { ImportPreview } from "../types";

let lastPreview: ImportPreview | null = null;

export function registerIpc(): void {
  ipcMain.handle("app:getStatus", async () => {
    const sessionStatus = await checkSession();
    return getDashboardData(sessionStatus);
  });

  ipcMain.handle("auth:openLogin", async () => openLogin());
  ipcMain.handle("auth:checkSession", async () => checkSession());
  ipcMain.handle("auth:clearSession", async () => {
    await clearSessionData();
    return true;
  });
  ipcMain.handle("skp:openLogPage", async () => openSkpLogPage());
  ipcMain.handle("skp:fetchOptions", async () => fetchSkpDropdownOptions());

  ipcMain.handle("logs:list", (_event, filters) => listDailyLogs(filters ?? {}));
  ipcMain.handle("logs:save", (_event, payload) => upsertDailyLog(payload));
  ipcMain.handle("logs:delete", (_event, id: string) => deleteDailyLog(id));
  ipcMain.handle("logs:runToday", async () => runToday());
  ipcMain.handle("logs:runMissed", async () => runMissed());
  ipcMain.handle("logs:runRange", async (_event, payload: { dateFrom: string; dateTo: string }) => runRange(payload.dateFrom, payload.dateTo));
  ipcMain.handle("logs:retryFailed", async () => retryFailed());
  ipcMain.handle("scheduler:pause", () => pauseScheduler());
  ipcMain.handle("scheduler:resume", () => resumeScheduler());

  ipcMain.handle("import:chooseAndPreview", async () => {
    const result = await dialog.showOpenDialog({
      title: "Pilih file Excel Log Harian",
      filters: [{ name: "Excel", extensions: ["xlsx"] }],
      properties: ["openFile"]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    lastPreview = await previewExcelImport(result.filePaths[0]);
    return lastPreview;
  });
  ipcMain.handle("import:commitExcel", (_event, mode: string) => {
    if (!lastPreview) throw new Error("Belum ada preview import.");
    commitImportPreview(lastPreview, mode);
    return true;
  });

  ipcMain.handle("skp:list", () => listSkpItems());
  ipcMain.handle("mapping:list", () => listSkpMappings());
  ipcMain.handle("mapping:update", (_event, payload) => updateSkpMapping(payload));

  ipcMain.handle("calendar:list", (_event, month?: string) => listCalendarStatus(month));
  ipcMain.handle("calendar:detail", (_event, date: string) => getCalendarDetail(date));
  ipcMain.handle("calendar:mark", (_event, payload: { date: string; status: string; reasonType: string; reasonNote: string }) =>
    markCalendarDate(payload.date, payload.status, payload.reasonType, payload.reasonNote)
  );

  ipcMain.handle("history:list", (_event, limit?: number) => listHistory(limit ?? 100));
  ipcMain.handle("settings:get", () => ({ ...listSettings(), db_path: getDbPath() }));
  ipcMain.handle("settings:update", (_event, payload) => updateSettings(payload));
  ipcMain.handle("settings:openDataDir", async () => shell.showItemInFolder(getDbPath()));
}
