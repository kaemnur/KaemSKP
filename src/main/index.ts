import { app, BrowserWindow } from "electron";
import type { BrowserWindow as BrowserWindowType } from "electron";
import { join } from "node:path";
import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { initDatabase } from "./db/database";
import { registerIpc } from "./ipc/registerIpc";
import { startScheduler } from "./scheduler/autoRunScheduler";

let mainWindow: BrowserWindowType | null = null;
let isQuitting = false;

function startupLog(message: string): void {
  try {
    appendFileSync(join(tmpdir(), "kaemskp-main.log"), `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Logging must never block app startup.
  }
}

process.on("uncaughtException", (error) => {
  startupLog(`uncaughtException: ${error.stack ?? error.message}`);
});

process.on("unhandledRejection", (error) => {
  startupLog(`unhandledRejection: ${String(error)}`);
});

function createWindow(): void {
  startupLog("createWindow:start");
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1100,
    minHeight: 720,
    title: "KaemSKP",
    backgroundColor: "#f8fafc",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  startupLog("createWindow:done");
}

app.whenReady().then(() => {
  startupLog("app:ready");
  app.setAppUserModelId("id.kaemnur.kaemskp");
  initDatabase();
  startupLog("database:initialized");
  registerIpc();
  createWindow();
  startScheduler();
  startupLog("scheduler:started");

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    mainWindow?.show();
  });
}).catch((error) => {
  startupLog(`whenReady:error ${error.stack ?? error.message}`);
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
