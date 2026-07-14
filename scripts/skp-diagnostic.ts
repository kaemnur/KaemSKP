import { config as loadEnv } from "dotenv";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";

loadEnv({ path: join(process.cwd(), ".env.local"), override: false, quiet: true });

const BASE_URL = (process.env.SKP_BASE_URL || "https://skp.sdm.kemendikdasmen.go.id").replace(/\/+$/, "");
const LOG_URL = `${BASE_URL}/skp/pegawai/logharian/cal.jsp`;
const appDataRoot = process.env.APPDATA || process.env.LOCALAPPDATA || join(process.env.USERPROFILE || process.cwd(), "AppData", "Roaming");
const sessionDir = join(appDataRoot, "KaemSKP", "sessions", "skp");
const authStatePath = join(appDataRoot, "KaemSKP", "sessions", "skp-auth-state.json");
const screenshotDir = join(appDataRoot, "KaemSKP", "screenshots", "diagnostic");

type DiagnosticStep =
  | "open_log_page"
  | "click_tambah_log"
  | "wait_modal"
  | "fill_tanggal"
  | "fill_nama_aktivitas"
  | "fill_deskripsi"
  | "select_skp"
  | "fill_output"
  | "ready_before_save";

type DiagnosticStatus = "connected" | "expired" | "error";

type StepError = {
  step: string;
  error_code: string;
  current_url: string | null;
  message: string;
  screenshot_path: string | null;
};

type StepResult = {
  step: DiagnosticStep;
  screenshot_path: string;
};

type SessionCheck = {
  phase: "reopen_with_storage_state";
  authStatePath: string;
  current_url: string;
  is_login_jsp: boolean;
  has_beranda: boolean;
  has_log_harian: boolean;
  has_logout: boolean;
  status_final: DiagnosticStatus;
};

class DiagnosticError extends Error {
  constructor(
    public step: string,
    public errorCode: string,
    message: string,
    public currentUrl?: string
  ) {
    super(message);
  }
}

async function main(): Promise<void> {
  mkdirSync(sessionDir, { recursive: true });
  mkdirSync(screenshotDir, { recursive: true });

  let context: BrowserContext | null = null;
  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    console.log(`[SKP diagnostic] sessionDir=${sessionDir}`);
    console.log(`[SKP diagnostic] authStatePath=${authStatePath}`);
    console.log(`[SKP diagnostic] screenshotDir=${screenshotDir}`);

    context = await launchContext();
    page = await getPage(context);
    await openLoginPage(page);
    console.log(
      "Login manual sampai dashboard SKP terlihat. Setelah dashboard benar-benar tampil, kembali ke terminal dan tekan ENTER. Jangan tutup browser manual."
    );
    await waitForEnter();

    const manualCheck = await checkManualDashboard(page);
    if (manualCheck.status_final !== "connected") {
      console.log(JSON.stringify(notOnDashboardOutput(manualCheck), null, 2));
      process.exitCode = 1;
      return;
    }

    await context.storageState({ path: authStatePath });
    await saveScreenshot(page, "storage_state_saved");
    await page.waitForTimeout(1000);
    await context.close();
    context = null;

    ({ browser, context } = await launchStorageStateContext());
    page = await getPage(context);
    const sessionCheck = await checkStorageStateSession(page);
    const dryRun = sessionCheck.status_final === "connected" ? await runSubmitDryRun(page) : undefined;

    await context.close();
    context = null;
    await browser.close();
    browser = null;

    console.log(
      JSON.stringify(
        dryRun ? { ...sessionCheck, dry_run_submit: dryRun } : sessionCheck,
        null,
        2
      )
    );
  } catch (error) {
    const diagnosticError = await buildStepError(error, page);
    console.log(JSON.stringify(diagnosticError, null, 2));
    process.exitCode = 1;
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

async function launchContext(): Promise<BrowserContext> {
  return chromium.launchPersistentContext(sessionDir, {
    headless: false,
    viewport: { width: 1366, height: 860 },
    locale: "id-ID",
    permissions: ["clipboard-read", "clipboard-write"],
    args: ["--disable-features=PasswordManagerOnboarding,PasswordLeakDetection"]
  });
}

async function launchStorageStateContext(): Promise<{ browser: Browser; context: BrowserContext }> {
  const browser = await chromium.launch({
    headless: false,
    args: ["--disable-features=PasswordManagerOnboarding,PasswordLeakDetection"]
  });
  const context = await browser.newContext({
    storageState: authStatePath,
    viewport: { width: 1366, height: 860 },
    locale: "id-ID",
    permissions: ["clipboard-read", "clipboard-write"]
  });
  return { browser, context };
}

async function getPage(context: BrowserContext): Promise<Page> {
  return context.pages().find((item) => !item.isClosed()) ?? context.newPage();
}

async function openLoginPage(page: Page): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  const loginNonPortal = page.getByText(/Login Non Portal/i).first();
  if (await loginNonPortal.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginNonPortal.click();
    await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
  }
}

async function checkManualDashboard(page: Page): Promise<SessionCheck> {
  await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await saveScreenshot(page, "manual_dashboard_check");
  return buildSessionCheck(page, await visibleText(page));
}

async function checkStorageStateSession(page: Page): Promise<SessionCheck> {
  await page.goto(LOG_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await saveScreenshot(page, "storage_state_reopen_log_page");
  return buildSessionCheck(page, await visibleText(page));
}

async function buildSessionCheck(page: Page, text: string): Promise<SessionCheck> {
  const currentUrl = page.url();
  const isLoginJsp = isLoginJspUrl(currentUrl);
  const hasBeranda = /Beranda/i.test(text);
  const hasLogHarian = /Log Harian/i.test(text);
  const hasLogout = /Logout/i.test(text);
  const dashboard = await detectDashboardPage(page, text);

  return {
    phase: "reopen_with_storage_state",
    authStatePath,
    current_url: currentUrl,
    is_login_jsp: isLoginJsp,
    has_beranda: hasBeranda,
    has_log_harian: hasLogHarian,
    has_logout: hasLogout,
    status_final: isLoginJsp ? "expired" : dashboard ? "connected" : "error"
  };
}

function notOnDashboardOutput(check: SessionCheck): SessionCheck & {
  status_final: "error";
  error_code: "NOT_ON_DASHBOARD";
  message: string;
} {
  return {
    ...check,
    status_final: "error",
    error_code: "NOT_ON_DASHBOARD",
    message: "Dashboard SKP belum terdeteksi setelah ENTER. Auth state tidak disimpan."
  };
}

async function waitForEnter(): Promise<void> {
  const terminal = createInterface({ input, output });
  try {
    await terminal.question("");
  } finally {
    terminal.close();
  }
}

async function runSubmitDryRun(page: Page): Promise<{ ok: true; steps: StepResult[] } | { ok: false; steps: StepResult[]; error: StepError }> {
  const steps: StepResult[] = [];

  try {
    await page.goto(LOG_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    await assertNotLogin(page, "open_log_page");
    steps.push(await recordStep(page, "open_log_page"));

    await clickAddLog(page);
    await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
    await assertNotLogin(page, "click_tambah_log");
    steps.push(await recordStep(page, "click_tambah_log"));

    await waitForLogForm(page);
    steps.push(await recordStep(page, "wait_modal"));

    await fillDate(page, diagnosticData().tanggal);
    steps.push(await recordStep(page, "fill_tanggal"));

    await fillField(page, ["nama aktivitas", "aktivitas", "activity"], diagnosticData().namaAktivitas, "ACTIVITY_FIELD_NOT_FOUND", "fill_nama_aktivitas");
    steps.push(await recordStep(page, "fill_nama_aktivitas"));

    await fillDescription(page, diagnosticData().deskripsi);
    steps.push(await recordStep(page, "fill_deskripsi"));

    await selectSkp(page);
    steps.push(await recordStep(page, "select_skp"));

    await fillOutput(page);
    steps.push(await recordStep(page, "fill_output"));

    steps.push(await recordStep(page, "ready_before_save"));

    return { ok: true, steps };
  } catch (error) {
    const stepError = await buildStepError(error, page);
    return { ok: false, steps, error: stepError };
  }
}

async function recordStep(page: Page, step: DiagnosticStep): Promise<StepResult> {
  return {
    step,
    screenshot_path: await saveScreenshot(page, step)
  };
}

async function clickAddLog(page: Page): Promise<void> {
  const labels = [/tambah.*log/i, /log.*baru/i, /tambah/i, /input.*log/i, /add/i];
  for (const label of labels) {
    const button = page.getByRole("button", { name: label }).first();
    if (await button.isVisible({ timeout: 1500 }).catch(() => false)) {
      await button.click();
      return;
    }
    const link = page.getByRole("link", { name: label }).first();
    if (await link.isVisible({ timeout: 1500 }).catch(() => false)) {
      await link.click();
      return;
    }
  }

  const textTrigger = page.getByText(/tambah.*log|log.*baru|input.*log|tambah/i).first();
  if (await textTrigger.isVisible({ timeout: 1500 }).catch(() => false)) {
    await textTrigger.click();
    return;
  }

  const cssTrigger = page
    .locator('a[href*="add" i], a[href*="input" i], a[href*="logharian" i], button[onclick*="add" i], button[onclick*="input" i], input[type="button"], input[type="submit"]')
    .filter({ hasText: /tambah|input|add|baru/i })
    .first();
  if (await cssTrigger.isVisible({ timeout: 1500 }).catch(() => false)) {
    await cssTrigger.click();
    return;
  }

  throw new DiagnosticError("click_tambah_log", "ADD_LOG_BUTTON_NOT_FOUND", "Tombol Tambah Log tidak ditemukan.", page.url());
}

async function waitForLogForm(page: Page): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(500);
    await assertNotLogin(page, "wait_modal");
    const title = await page.getByText(/tambah.*log harian|log harian|nama aktivitas|kuantitas output/i).first().isVisible({ timeout: 500 }).catch(() => false);
    const dateField = await page.locator('input[type="date"], input[name*="tanggal" i], input[id*="tanggal" i], input[name*="tgl" i], input[id*="tgl" i]').first().isVisible({ timeout: 500 }).catch(() => false);
    const activityField = await page
      .locator('input[name*="aktivitas" i], input[id*="aktivitas" i], textarea[name*="aktivitas" i], textarea[id*="aktivitas" i]')
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (title && (dateField || activityField)) return;
  }

  throw new DiagnosticError("wait_modal", "LOG_FORM_NOT_OPENED", "Modal Tambah Log Harian tidak terbuka setelah klik Tambah Log.", page.url());
}

async function fillDate(page: Page, isoDate: string): Promise<void> {
  const control = await findTextControl(page, ["tanggal", "tgl", "date"]);
  if (!control || !(await control.isVisible({ timeout: 1000 }).catch(() => false))) {
    throw new DiagnosticError("fill_tanggal", "DATE_FIELD_NOT_FOUND", "Field Tanggal tidak ditemukan.", page.url());
  }

  const type = (await control.getAttribute("type").catch(() => null))?.toLowerCase();
  const dateValue = type === "date" ? isoDate : toIndonesianDate(isoDate);
  await control.fill(dateValue);
}

async function fillDescription(page: Page, value: string): Promise<void> {
  const plainField = await findTextControl(page, ["deskripsi", "uraian", "keterangan"]);
  if (plainField && (await plainField.isVisible({ timeout: 1000 }).catch(() => false))) {
    await plainField.fill(value);
    return;
  }

  const editor = page.locator('[contenteditable="true"], .note-editable, iframe').first();
  if (await editor.isVisible({ timeout: 1000 }).catch(() => false)) {
    const tagName = await editor.evaluate((node) => node.tagName.toLowerCase()).catch(() => "");
    if (tagName === "iframe") {
      await pasteTextIntoLocator(page, page.frameLocator("iframe").first().locator("body").first(), value);
      return;
    }
    await pasteTextIntoLocator(page, editor, value);
    return;
  }

  for (const frame of page.frames()) {
    const frameEditor = frame.locator('[contenteditable="true"], .note-editable, body').first();
    if (await frameEditor.isVisible({ timeout: 1000 }).catch(() => false)) {
      await pasteTextIntoLocator(page, frameEditor, value);
      return;
    }
  }

  throw new DiagnosticError("fill_deskripsi", "DESCRIPTION_EDITOR_NOT_FOUND", "Editor Deskripsi tidak ditemukan.", page.url());
}

async function selectSkp(page: Page): Promise<void> {
  const select = await findSkpSelect(page);
  if (!select) {
    throw new DiagnosticError("select_skp", "SKP_DROPDOWN_NOT_FOUND", "Dropdown SKP tidak ditemukan.", page.url());
  }

  const preferredValue = clean(process.env.SKP_DIAG_SKP_VALUE);
  const preferredText = clean(process.env.SKP_DIAG_SKP_TEXT);
  const options = await select.locator("option").evaluateAll((nodes) =>
    nodes.map((node) => ({ text: (node.textContent ?? "").trim(), value: (node as HTMLOptionElement).value }))
  );
  const selectableOptions = options.filter((item) => item.text && !/^[-\s]*(pilih|select|--)/i.test(item.text));
  const match =
    (preferredValue ? selectableOptions.find((item) => item.value === preferredValue) : undefined) ??
    (preferredText ? selectableOptions.find((item) => normalizeText(item.text).includes(normalizeText(preferredText))) : undefined) ??
    selectableOptions[0];

  if (!match) {
    throw new DiagnosticError("select_skp", "SKP_OPTION_NOT_FOUND", "Dropdown SKP tidak memiliki opsi yang bisa dipilih.", page.url());
  }

  if (match.value) {
    await select.selectOption({ value: match.value });
  } else {
    await select.selectOption({ label: match.text });
  }
}

async function fillOutput(page: Page): Promise<void> {
  const data = diagnosticData();
  await fillField(page, ["kuantitas output", "kuantitas", "output", "volume"], data.kuantitasOutput, "OUTPUT_FIELD_NOT_FOUND", "fill_output");
  await fillField(page, ["satuan", "unit"], data.satuan, "UNIT_FIELD_NOT_FOUND", "fill_output");
  if (data.link) {
    await fillField(page, ["link", "tautan", "url"], data.link, "LINK_FIELD_NOT_FOUND", "fill_output");
  }
}

async function fillField(page: Page, aliases: string[], value: string, errorCode: string, step: DiagnosticStep): Promise<void> {
  const control = await findTextControl(page, aliases);
  if (!control || !(await control.isVisible({ timeout: 1000 }).catch(() => false))) {
    throw new DiagnosticError(step, errorCode, `Field ${aliases[0]} tidak ditemukan.`, page.url());
  }
  await control.fill(value);
}

async function findTextControl(page: Page, aliases: string[]): Promise<Locator | null> {
  for (const alias of aliases) {
    const pattern = new RegExp(escapeRegExp(alias), "i");
    const labeled = page.getByLabel(pattern).first();
    if (await labeled.isVisible({ timeout: 1000 }).catch(() => false)) return labeled;
    const placeholder = page.getByPlaceholder(pattern).first();
    if (await placeholder.isVisible({ timeout: 1000 }).catch(() => false)) return placeholder;
  }

  for (const token of fieldTokens(aliases)) {
    const byAttribute = page
      .locator(
        `input[name*="${token}" i], input[id*="${token}" i], input[placeholder*="${token}" i], textarea[name*="${token}" i], textarea[id*="${token}" i], textarea[placeholder*="${token}" i]`
      )
      .first();
    if (await byAttribute.isVisible({ timeout: 1000 }).catch(() => false)) return byAttribute;
  }

  return findControlNearLabel(page, aliases, "input, textarea");
}

async function findSkpSelect(page: Page): Promise<Locator | null> {
  const selectByLabel = page.getByLabel(/skp/i).first();
  if ((await selectByLabel.isVisible({ timeout: 1000 }).catch(() => false)) && (await isSelectElement(selectByLabel))) return selectByLabel;
  for (const token of ["skp", "sasaran", "kinerja", "kode"]) {
    const byAttribute = page.locator(`select[name*="${token}" i], select[id*="${token}" i], select[aria-label*="${token}" i]`).first();
    if (await byAttribute.isVisible({ timeout: 1000 }).catch(() => false)) return byAttribute;
  }
  const nearLabel = await findControlNearLabel(page, ["skp", "sasaran kinerja pegawai", "sasaran", "kinerja"], "select");
  if (nearLabel && (await nearLabel.isVisible({ timeout: 1000 }).catch(() => false))) return nearLabel;
  const select = page.locator("select").filter({ hasText: /PIP|SKP|Sasaran|Kinerja/i }).first();
  if (await select.isVisible({ timeout: 1000 }).catch(() => false)) return select;
  return null;
}

async function isSelectElement(locator: Locator): Promise<boolean> {
  return locator.evaluate((node) => node.tagName.toLowerCase() === "select").catch(() => false);
}

async function findControlNearLabel(page: Page, aliases: string[], selector: "input, textarea" | "select"): Promise<Locator | null> {
  for (const alias of aliases) {
    const pattern = new RegExp(escapeRegExp(alias), "i");
    const label = page.locator("label").filter({ hasText: pattern }).first();
    if (!(await label.isVisible({ timeout: 1000 }).catch(() => false))) continue;

    const forValue = await label.getAttribute("for").catch(() => null);
    if (forValue) {
      const byFor = page.locator(`${selector}[id="${escapeCssAttribute(forValue)}"]`).first();
      if (await byFor.isVisible({ timeout: 1000 }).catch(() => false)) return byFor;
    }

    const nearby = selector === "select" ? label.locator("xpath=following::select[1]") : label.locator("xpath=following::*[self::input or self::textarea][1]");
    if (await nearby.isVisible({ timeout: 1000 }).catch(() => false)) return nearby;
  }
  return null;
}

async function pasteTextIntoLocator(page: Page, target: Locator, value: string): Promise<void> {
  await target.click({ timeout: 5000 });
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => undefined);
  const pasted = await page
    .evaluate(async (text) => {
      await navigator.clipboard.writeText(text);
      return true;
    }, value)
    .catch(() => false);

  if (pasted) {
    await page.keyboard.press(process.platform === "darwin" ? "Meta+V" : "Control+V");
  } else {
    await page.keyboard.insertText(value);
  }
}

async function assertNotLogin(page: Page, step: DiagnosticStep): Promise<void> {
  if (await detectLoginPage(page)) {
    throw new DiagnosticError(step, "SESSION_EXPIRED", "Session diarahkan kembali ke halaman login.", page.url());
  }
}

async function detectLoginPage(page: Page, text?: string): Promise<boolean> {
  const url = safePageUrl(page).toLowerCase();
  const visible = (text ?? (await visibleText(page))).toLowerCase();
  return isLoginJspUrl(url) || visible.includes("login non portal");
}

async function detectDashboardPage(page: Page, text?: string): Promise<boolean> {
  const url = safePageUrl(page);
  const visible = (text ?? (await visibleText(page))).toLowerCase();
  if (isLoginJspUrl(url)) return false;
  return (
    visible.includes("beranda") ||
    visible.includes("log harian") ||
    visible.includes("logout") ||
    visible.includes("muhammad nur")
  );
}

async function visibleText(page: Page): Promise<string> {
  return page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
}

async function saveScreenshot(page: Page, step: string): Promise<string> {
  const fileName = `${new Date().toISOString().replace(/[:.]/g, "-")}_${safeName(step)}.png`;
  const filePath = join(screenshotDir, fileName);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function buildStepError(error: unknown, page: Page | null): Promise<StepError> {
  const step = error instanceof DiagnosticError ? error.step : "unknown";
  const screenshotPath = page && !page.isClosed() ? await saveScreenshot(page, `${step}_failed`).catch(() => null) : null;
  return {
    step,
    error_code: error instanceof DiagnosticError ? error.errorCode : "UNKNOWN_ERROR",
    current_url: error instanceof DiagnosticError ? error.currentUrl ?? safeNullablePageUrl(page) : safeNullablePageUrl(page),
    message: error instanceof Error ? error.message : "Diagnostic gagal tanpa detail error.",
    screenshot_path: screenshotPath
  };
}

function diagnosticData(): {
  tanggal: string;
  namaAktivitas: string;
  deskripsi: string;
  kuantitasOutput: string;
  satuan: string;
  link: string;
} {
  return {
    tanggal: clean(process.env.SKP_DIAG_TANGGAL) || todayInJakarta(),
    namaAktivitas: clean(process.env.SKP_DIAG_NAMA_AKTIVITAS) || "Diagnostik KaemSKP dry-run",
    deskripsi: clean(process.env.SKP_DIAG_DESKRIPSI) || "Isian diagnostik KaemSKP. Dry-run berhenti sebelum Simpan.",
    kuantitasOutput: clean(process.env.SKP_DIAG_KUANTITAS_OUTPUT) || "1",
    satuan: clean(process.env.SKP_DIAG_SATUAN) || "dokumen",
    link: clean(process.env.SKP_DIAG_LINK) || ""
  };
}

function todayInJakarta(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function toIndonesianDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return year && month && day ? `${day}/${month}/${year}` : isoDate;
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

function safePageUrl(page: Page): string {
  try {
    return page.url();
  } catch {
    return "";
  }
}

function safeNullablePageUrl(page: Page | null): string | null {
  if (!page) return null;
  return safePageUrl(page) || null;
}

function fieldTokens(aliases: string[]): string[] {
  return Array.from(
    new Set(
      aliases
        .flatMap((alias) => alias.toLowerCase().split(/[^a-z0-9]+/i))
        .map((token) => token.trim())
        .filter((token) => token.length >= 3)
    )
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeCssAttribute(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function clean(value?: string | null): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function safeName(value: string): string {
  return value.replace(/[^a-z0-9_-]/gi, "_");
}

main().catch((error) => {
  console.log(
    JSON.stringify(
      {
        step: "bootstrap",
        error_code: "BOOTSTRAP_ERROR",
        current_url: null,
        message: error instanceof Error ? error.message : "Diagnostic gagal saat bootstrap.",
        screenshot_path: null
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
