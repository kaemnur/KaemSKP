import { config as loadEnv } from "dotenv";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { getDataDir, getSetting } from "../db/database";
import type { SessionStatus } from "../types";
import { resolveSkpConfig } from "../config/profileService";

const PASSWORD_MASK = "********";

loadEnv({ path: join(process.cwd(), ".env.local"), override: false, quiet: true });

let skpContext: BrowserContext | null = null;
let skpPage: Page | null = null;
let skpSessionStatus: SessionStatus = "not_logged_in";
let skpHeadless: boolean | null = null;
let runtimeSkpConfig: RuntimeSkpConfig | null = null;

export type SkpCredentials = {
  username: string | null;
  password: string | null;
};

type RuntimeSkpConfig = SkpCredentials & {
  baseUrl?: string | null;
};

export function getSessionDir(): string {
  const dir = join(getDataDir(), "sessions", "skp");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function getAuthStatePath(): string {
  const dir = join(getDataDir(), "sessions");
  mkdirSync(dir, { recursive: true });
  return join(dir, "skp-auth-state.json");
}

export function getBaseUrl(): string {
  if (runtimeSkpConfig?.baseUrl) return runtimeSkpConfig.baseUrl.replace(/\/+$/, "");
  return resolveSkpConfig(listCredentialSettings()).baseUrl;
}

export function getSkpCredentials(): SkpCredentials {
  if (runtimeSkpConfig) {
    return {
      username: runtimeSkpConfig.username,
      password: runtimeSkpConfig.password
    };
  }
  const config = resolveSkpConfig(listCredentialSettings());
  return {
    username: config.username,
    password: config.password
  };
}

export function setRuntimeSkpCredentials(config: RuntimeSkpConfig | null): void {
  runtimeSkpConfig = config;
}

export function getActiveSkpContext(): BrowserContext | null {
  if (!skpContext) return null;
  try {
    skpContext.pages();
    return skpContext;
  } catch {
    clearSkpSingleton("error");
    return null;
  }
}

export function getActiveSkpPage(): Page | null {
  const context = getActiveSkpContext();
  if (!context) return null;
  if (skpPage && !skpPage.isClosed() && skpPage.context() === context) return skpPage;
  skpPage = context.pages().find((item) => !item.isClosed()) ?? null;
  return skpPage;
}

export function getSkpSessionStatusMemory(): SessionStatus {
  return getActiveSkpContext() ? skpSessionStatus : "not_logged_in";
}

export function setSkpSessionStatusMemory(status: SessionStatus): void {
  skpSessionStatus = status;
}

export async function getSkpContext(headless: boolean): Promise<BrowserContext> {
  const activeContext = getActiveSkpContext();
  if (activeContext) return activeContext;

  const authStatePath = getAuthStatePath();
  skpContext = await chromium.launchPersistentContext(getSessionDir(), {
    headless,
    ...(existsSync(authStatePath) ? { storageState: authStatePath } : {}),
    viewport: { width: 1366, height: 860 },
    locale: "id-ID",
    permissions: ["clipboard-read", "clipboard-write"],
    args: [
      "--disable-features=PasswordManagerOnboarding,PasswordLeakDetection",
      "--window-size=1040,720",
      "--window-position=720,120"
    ]
  });
  skpHeadless = headless;
  skpSessionStatus = "checking";
  skpContext.on("close", () => clearSkpSingleton("not_logged_in"));
  return skpContext;
}

export async function getSkpPage(headless: boolean): Promise<Page> {
  const context = await getSkpContext(headless);
  skpPage = skpPage && !skpPage.isClosed() && skpPage.context() === context ? skpPage : context.pages().find((item) => !item.isClosed()) ?? await context.newPage();
  return skpPage;
}

export async function closeSkpContext(): Promise<void> {
  const context = skpContext;
  clearSkpSingleton("not_logged_in");
  await context?.close().catch(() => undefined);
}

function clearSkpSingleton(status: SessionStatus): void {
  skpContext = null;
  skpPage = null;
  skpHeadless = null;
  skpSessionStatus = status;
}

function cleanValue(value?: string | null): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function cleanPassword(value?: string | null): string | null {
  const text = cleanValue(value);
  return text && text !== PASSWORD_MASK ? text : null;
}

function listCredentialSettings(): Record<string, string> {
  return {
    skp_username: getSetting("skp_username", ""),
    skp_password: cleanPassword(getSetting("skp_password", "")) ?? "",
    skp_base_url: getSetting("skp_base_url", process.env.SKP_BASE_URL || "https://skp.sdm.kemendikdasmen.go.id")
  };
}
