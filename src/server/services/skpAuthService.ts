import type { BrowserContext, Page } from "playwright";
import { rmSync } from "node:fs";
import { closeAutomation } from "../../main/automation/skpAutomation";
import {
  closeSkpContext,
  getActiveSkpPage,
  getActiveSkpContext,
  getAuthStatePath,
  getBaseUrl,
  getSessionDir,
  getSkpContext,
  getSkpCredentials,
  getSkpPage,
  setSkpSessionStatusMemory,
  type SkpCredentials
} from "../../main/automation/skpSession";
import { getSkpSessionStatus, updateSkpSessionStatus } from "../../main/db/database";

export type SkpAuthState = "connected" | "not_logged_in" | "expired" | "checking" | "error";

export type SkpAuthStatus = {
  status: SkpAuthState;
  isLoggedIn: boolean;
  username: string | null;
  displayName: string | null;
  lastCheckedAt: string;
  message: string;
};

const LOG_PATH = "/skp/pegawai/logharian/cal.jsp";
const LOGIN_WAIT_MS = 5 * 60 * 1000;

let authPage: Page | null = null;

export function getAuthStatus(): SkpAuthStatus {
  const activeContext = getActiveSkpContext();
  if (!activeContext) {
    return persistStatus(createStatus("not_logged_in", "Belum login ke SKP. Klik Login Ulang SKP dulu."));
  }
  const stored = getSkpSessionStatus();
  if (stored.status !== "connected") {
    return persistStatus(createStatus("connected", "Terhubung ke SKP", stored.username, stored.displayName));
  }
  return getSkpSessionStatus();
}

export { getSessionDir, getSkpCredentials };
export type { SkpCredentials };

export async function checkSession(): Promise<SkpAuthStatus> {
  getSessionDir();
  const { username } = getSkpCredentials();
  const activeContext = getActiveSkpContext();
  logContextUse("check_session", Boolean(activeContext), getActiveSkpPage()?.url());
  if (!activeContext) {
    setSkpSessionStatusMemory("not_logged_in");
    return persistStatus(createStatus("not_logged_in", "Belum login ke SKP. Klik Login Ulang SKP dulu.", username));
  }

  try {
    const page = getActiveSkpPage() ?? (await getUsablePage(activeContext));
    await gotoSkp(page, LOG_PATH);
    const status = await readPageAuthStatus(page, username);
    if (status.status === "connected" || status.status === "expired" || status.status === "not_logged_in") {
      setSkpSessionStatusMemory(status.status);
      return persistStatus(status);
    }
    return status;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal mengecek session SKP.";
    setSkpSessionStatusMemory("error");
    return persistStatus(createStatus("error", `Gagal cek session, session lokal belum dihapus. ${message}`, username));
  }
}

export async function openLogin(): Promise<SkpAuthStatus> {
  getSessionDir();
  const { username } = getSkpCredentials();

  try {
    const page = await getAuthPage(false);
    await gotoBase(page);
    await clickLoginNonPortal(page);
    await waitForLoginForm(page);
    const hasCredentials = await autofillCredentials(page);
    if (hasCredentials) await clickSubmitLogin(page);

    const status = await waitForLoginSuccess(page, LOGIN_WAIT_MS);
    if (status.status === "connected") {
      await page.context().storageState({ path: getAuthStatePath() });
      await page.waitForTimeout(1500).catch(() => undefined);
      await moveLoginBrowserToBackground(page);
      setSkpSessionStatusMemory("connected");
    }
    return persistStatus(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Login SKP belum selesai.";
    return persistStatus(createStatus("error", message, username));
  }
}

export async function openSkp(): Promise<SkpAuthStatus> {
  getSessionDir();
  const { username } = getSkpCredentials();
  const activeContext = getActiveSkpContext();
  logContextUse("open_skp", Boolean(activeContext), getActiveSkpPage()?.url());
  if (!activeContext) {
    setSkpSessionStatusMemory("not_logged_in");
    return persistStatus(createStatus("not_logged_in", "LOGIN_REQUIRED: Klik Login Ulang SKP dulu.", username));
  }

  try {
    const page = getActiveSkpPage() ?? (await getUsablePage(activeContext));
    await gotoSkp(page, LOG_PATH);
    const status = await readPageAuthStatus(page, username);
    if (status.status === "connected" || status.status === "expired" || status.status === "not_logged_in") {
      setSkpSessionStatusMemory(status.status);
      return persistStatus(status);
    }
    return status;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal membuka SKP.";
    setSkpSessionStatusMemory("error");
    return persistStatus(createStatus("error", `Gagal membuka SKP, session lokal belum dihapus. ${message}`, username));
  }
}

export async function clearSession(): Promise<SkpAuthStatus> {
  await closeLoginBrowser();
  await closeAutomation().catch(() => undefined);
  rmSync(getSessionDir(), { recursive: true, force: true });
  rmSync(getAuthStatePath(), { force: true });
  return persistStatus(createStatus("not_logged_in", "Session SKP lokal sudah dihapus.", getSkpCredentials().username, null));
}

export async function waitForLoginSuccess(page: Page, timeoutMs = LOGIN_WAIT_MS): Promise<SkpAuthStatus> {
  const startedAt = Date.now();
  const { username } = getSkpCredentials();

  while (Date.now() - startedAt < timeoutMs) {
    const status = await readPageAuthStatus(page, username);
    if (status.status === "connected") return status;
    await page.waitForTimeout(2000);
  }

  return createStatus("not_logged_in", "Login SKP belum selesai dalam 5 menit.", username);
}

export async function closeLoginBrowser(): Promise<void> {
  await closeAuthContext();
}

async function getAuthPage(headless: boolean): Promise<Page> {
  const context = await getSkpContext(headless);
  authPage = authPage && !authPage.isClosed() && authPage.context() === context ? authPage : await getSkpPage(headless);
  return authPage;
}

async function closeAuthContext(): Promise<void> {
  await closeSkpContext();
  authPage = null;
}

async function getUsablePage(context: BrowserContext): Promise<Page> {
  const existing = context.pages().find((item) => !item.isClosed());
  return existing ?? context.newPage();
}

async function gotoBase(page: Page): Promise<void> {
  await page.goto(getBaseUrl(), { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
}

async function gotoSkp(page: Page, path: string): Promise<void> {
  const baseUrl = getBaseUrl();
  await page.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
}

async function clickLoginNonPortal(page: Page): Promise<void> {
  const loginNonPortal = page.getByText(/Login Non Portal/i).first();
  if (await loginNonPortal.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginNonPortal.click();
    await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
  }
}

async function waitForLoginForm(page: Page): Promise<void> {
  if (!(await detectLoginPage(page))) return;
  await page.locator('input[type="password"], input[name*="pass" i], input[id*="pass" i]').first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
}

async function autofillCredentials(page: Page): Promise<boolean> {
  const { username, password } = getSkpCredentials();
  if (!username || !password) return false;

  const usernameInput = page
    .locator('input[name*="user" i], input[name*="nip" i], input[id*="user" i], input[id*="nip" i], input[type="text"], input:not([type])')
    .first();
  const passwordInput = page.locator('input[type="password"], input[name*="pass" i], input[id*="pass" i]').first();
  const usernameVisible = await usernameInput.isVisible({ timeout: 5000 }).catch(() => false);
  const passwordVisible = await passwordInput.isVisible({ timeout: 5000 }).catch(() => false);
  if (!usernameVisible || !passwordVisible) {
    return false;
  }

  await usernameInput.fill(username);
  await passwordInput.fill(password);
  return true;
}

async function clickSubmitLogin(page: Page): Promise<void> {
  const submit = page.getByRole("button", { name: /masuk|login|sign in/i }).first();
  if (await submit.isVisible({ timeout: 5000 }).catch(() => false)) {
    await submit.click();
  } else {
    const inputSubmit = page.locator('input[type="submit"], button[type="submit"]').first();
    if (await inputSubmit.isVisible({ timeout: 3000 }).catch(() => false)) {
      await inputSubmit.click();
    } else {
      await page.keyboard.press("Enter");
    }
  }
  await page.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => undefined);
}

async function moveLoginBrowserToBackground(page: Page): Promise<void> {
  try {
    const session = await page.context().newCDPSession(page);
    const target = await session.send("Browser.getWindowForTarget");
    await session.send("Browser.setWindowBounds", {
      windowId: target.windowId,
      bounds: { windowState: "minimized" }
    });
    await session.detach().catch(() => undefined);
  } catch {
    await shrinkLoginBrowser(page);
  }
}

async function shrinkLoginBrowser(page: Page): Promise<void> {
  try {
    const session = await page.context().newCDPSession(page);
    const target = await session.send("Browser.getWindowForTarget");
    await session.send("Browser.setWindowBounds", {
      windowId: target.windowId,
      bounds: { windowState: "normal", left: 980, top: 520, width: 520, height: 420 }
    });
    await session.detach().catch(() => undefined);
  } catch {
    await page.setViewportSize({ width: 520, height: 420 }).catch(() => undefined);
  }
}

async function readPageAuthStatus(page: Page, username: string | null): Promise<SkpAuthStatus> {
  const text = await getVisibleText(page);
  logContextUse("read_auth_status", Boolean(getActiveSkpContext()), page.url());

  if (await detectLoginPage(page, text)) {
    return createStatus("expired", "Session SKP perlu login ulang.", username);
  }

  if (await detectDashboardPage(page, text, username)) {
    return createStatus("connected", "Terhubung ke SKP", username, extractDisplayName(text, username));
  }

  return createStatus("error", "Halaman SKP belum bisa dipastikan, session lokal belum dihapus.", username);
}

export async function detectLoginPage(page: Page, visibleText?: string): Promise<boolean> {
  const url = page.url().toLowerCase();
  const text = (visibleText ?? (await getVisibleText(page))).toLowerCase();
  if (isLoginJspUrl(url)) return true;
  if (text.includes("login non portal")) return true;
  return false;
}

export async function detectDashboardPage(page: Page, visibleText?: string, username?: string | null): Promise<boolean> {
  const url = page.url().toLowerCase();
  const text = (visibleText ?? (await getVisibleText(page))).toLowerCase();
  if (isLoginJspUrl(url)) return false;
  if (username && text.includes(username.toLowerCase())) return true;
  return (
    text.includes("beranda") ||
    text.includes("log harian") ||
    text.includes("logout") ||
    text.includes("keluar") ||
    text.includes("sasaran kinerja")
  );
}

async function getVisibleText(page: Page): Promise<string> {
  return page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
}

function extractDisplayName(text: string, username: string | null): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const generic = /^(dashboard|log harian|skp|logout|keluar|menu|profil|beranda|aplikasi pengelolaan kinerja)$/i;
  const candidate = lines.find((line) => line.length >= 3 && line.length <= 80 && !generic.test(line) && (!username || line !== username));
  return candidate ?? null;
}

function logContextUse(automationStep: string, usingActiveContext: boolean, currentUrl?: string): void {
  console.info(
    JSON.stringify({
      using_active_context: usingActiveContext,
      current_url: currentUrl ?? null,
      automation_step: automationStep
    })
  );
}

function isLoginJspUrl(value: string): boolean {
  const lower = value.toLowerCase();
  try {
    const parsed = new URL(value);
    return parsed.pathname.toLowerCase().endsWith("/skp/site/login.jsp");
  } catch {
    return lower.includes("/skp/site/login.jsp") || lower.includes("login.jsp");
  }
}

function createStatus(status: SkpAuthState, message: string, username: string | null = getSkpCredentials().username, displayName: string | null = null): SkpAuthStatus {
  return {
    status,
    isLoggedIn: status === "connected",
    username,
    displayName,
    lastCheckedAt: new Date().toISOString(),
    message
  };
}

function persistStatus(status: SkpAuthStatus): SkpAuthStatus {
  return updateSkpSessionStatus(status.status, status.message, status.displayName);
}
