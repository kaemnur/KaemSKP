import { type Locator, type Page } from "playwright";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { getActivePeriod, getDataDir, getDb, getSetting, updateSkpMapping, updateSkpSessionStatus } from "../db/database";
import type { DailyLog, SessionStatus, SkpLogVerificationResult, SkpSiteOption, SubmitResult } from "../types";
import { nowIso, toDateKey } from "../utils/date";
import {
  closeSkpContext,
  getActiveSkpContext,
  getActiveSkpPage,
  getAuthStatePath,
  getBaseUrl,
  getSessionDir,
  getSkpContext,
  getSkpCredentials,
  getSkpPage,
  setSkpSessionStatusMemory
} from "./skpSession";
import { findBestSkpOption, type SkpOptionCandidate } from "./skpMatching";

const LOG_PATH = "/skp/pegawai/logharian/cal.jsp";
const SKP_OPTION_SELECTORS = [
  ".select2-results__option:not(.loading-results)",
  "[role='option']",
  ".chosen-results li",
  ".choices__item--choice",
  ".dropdown-menu .dropdown-item",
  ".dropdown-menu li"
].join(", ");

let page: Page | null = null;

async function getAutomationPage(headless = true): Promise<Page> {
  const context = await getSkpContext(headless);
  page = page && !page.isClosed() && page.context() === context ? page : await getSkpPage(headless);
  return page;
}

async function getSubmitPage(): Promise<Page> {
  const context = getActiveSkpContext();
  logContextUse("get_submit_page", Boolean(context), getActiveSkpPage()?.url());
  if (!context) {
    updateSkpSessionStatus("not_logged_in", "Belum login ke SKP. Klik Login Ulang SKP dulu.");
    throw new SkpAutomationError("LOGIN_REQUIRED", "Belum login ke SKP. Klik Login Ulang SKP dulu.", undefined, "open_log_page");
  }

  page = page && !page.isClosed() && page.context() === context ? page : getActiveSkpPage() ?? await context.newPage();
  return page;
}

export async function openLogin(): Promise<void> {
  getSessionDir();
  const activePage = await getAutomationPage(false);
  await activePage.goto(getBaseUrl(), { waitUntil: "domcontentloaded" });
  await dismissBrowserPopups(activePage);
  const nonPortal = activePage.getByText(/Login Non Portal/i).first();
  if (await nonPortal.isVisible().catch(() => false)) {
    await nonPortal.click();
  }
}

export async function checkSession(): Promise<SessionStatus> {
  getSessionDir();
  const activeContext = getActiveSkpContext();
  logContextUse("check_session", Boolean(activeContext), getActiveSkpPage()?.url());
  if (!activeContext) {
    updateSkpSessionStatus("not_logged_in", "Belum login ke SKP. Klik Login Ulang SKP dulu.");
    setSkpSessionStatusMemory("not_logged_in");
    return "not_logged_in";
  }
  try {
    const activePage = getActiveSkpPage() ?? activeContext.pages()[0] ?? (await activeContext.newPage());
    await activePage.goto(`${getBaseUrl()}${LOG_PATH}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await activePage.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    if (await detectLoginPage(activePage)) {
      updateSkpSessionStatus("expired", "Session SKP perlu login ulang.");
      setSkpSessionStatusMemory("expired");
      return "expired";
    }
    if (await detectDashboardPage(activePage)) {
      updateSkpSessionStatus("connected", "Terhubung ke SKP");
      setSkpSessionStatusMemory("connected");
      return "connected";
    }
    updateSkpSessionStatus("error", "Halaman SKP belum bisa dipastikan, session lokal belum dihapus.");
    setSkpSessionStatusMemory("error");
    return "error";
  } catch {
    updateSkpSessionStatus("error", "Gagal cek session, session lokal belum dihapus.");
    setSkpSessionStatusMemory("error");
    return "error";
  }
}

export async function openLogHarian(headless = true): Promise<void> {
  const context = getActiveSkpContext();
  logContextUse("open_log_harian", Boolean(context), getActiveSkpPage()?.url());
  if (!context) {
    updateSkpSessionStatus("not_logged_in", "Belum login ke SKP. Klik Login Ulang SKP dulu.");
    throw new SkpAutomationError("LOGIN_REQUIRED", "Belum login ke SKP. Klik Login Ulang SKP dulu.", undefined, "open_log_harian");
  }
  const activePage = page && !page.isClosed() && page.context() === context ? page : getActiveSkpPage() ?? await context.newPage();
  page = activePage;
  await activePage.goto(`${getBaseUrl()}${LOG_PATH}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await activePage.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await dismissBrowserPopups(activePage);
  if (await detectLoginPage(activePage)) {
    updateSkpSessionStatus("expired", "Session SKP perlu login ulang.");
    setSkpSessionStatusMemory("expired");
    throw new SkpAutomationError("SESSION_EXPIRED", "Session SKP perlu login ulang.", activePage.url(), "open_log_harian");
  }
  updateSkpSessionStatus("connected", "Terhubung ke SKP");
  setSkpSessionStatusMemory("connected");
}

export async function fetchSkpDropdownOptions(): Promise<SkpSiteOption[]> {
  await openLogHarian(true);
  const activeContext = getActiveSkpContext();
  if (!activeContext) throw new SkpAutomationError("LOGIN_REQUIRED", "Belum login ke SKP. Klik Login Ulang SKP dulu.", undefined, "fetch_skp_options");
  const activePage = page && !page.isClosed() && page.context() === activeContext ? page : getActiveSkpPage() ?? await activeContext.newPage();
  page = activePage;
  await clickAddLog(activePage);
  await waitForLogForm(activePage);
  const dropdown = await waitForSkpDropdown(activePage);
  if (!dropdown) throw new SkpAutomationError("SKP_DROPDOWN_NOT_FOUND", "Dropdown SKP tidak ditemukan.", activePage.url(), "fetch_skp_options");
  const options = await readSkpOptions(activePage, dropdown);
  return options.filter((item) => item.text);
}

export async function submitDailyLog(log: DailyLog): Promise<SubmitResult> {
  getSessionDir();
  let step = "start";
  const setStep = (nextStep: string): void => {
    step = nextStep;
    logAutomationStep(log.kode_log, step);
  };
  try {
    if (log.tanggal > toDateKey()) {
      return { ok: false, status: "not_allowed_by_site", errorCode: "SITE_NOT_ALLOWED", message: "Tanggal masa depan tidak diproses." };
    }

    logContextUse("submit_daily_log_start", Boolean(getActiveSkpContext()), getActiveSkpPage()?.url());
    const activePage = await getSubmitPage();

    setStep("open_log_page");
    await openLogPageForSubmit(activePage);
    await assertLoggedIn(activePage, "SESSION_EXPIRED", "Session SKP diarahkan ke halaman login saat membuka Log Harian.", step);

    setStep("click_tambah_log");
    await clickAddLog(activePage);
    await activePage.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
    await assertLoggedIn(activePage, "LOGIN_PAGE_DETECTED_DURING_SUBMIT", "Session SKP diarahkan ke halaman login setelah klik Tambah Log.", step);

    setStep("wait_modal");
    await waitForLogForm(activePage);
    await assertLoggedIn(activePage, "LOGIN_PAGE_DETECTED_DURING_SUBMIT", "Session SKP diarahkan ke halaman login saat membuka form.", step);

    setStep("fill_tanggal");
    await fillDate(activePage, log.tanggal);
    setStep("fill_nama_aktivitas");
    await fillField(activePage, ["nama aktivitas", "aktivitas", "activity"], log.nama_aktivitas ?? "", "ACTIVITY_FIELD_NOT_FOUND");
    setStep("fill_deskripsi");
    await fillDescription(activePage, log.deskripsi ?? "");
    setStep("select_skp");
    await selectSkp(activePage, log);
    setStep("fill_output");
    await fillField(activePage, ["kuantitas output", "kuantitas", "output", "volume"], log.kuantitas_output ?? "", "VALIDATION_ERROR", false);
    await fillField(activePage, ["satuan", "unit"], log.satuan ?? "", "VALIDATION_ERROR", false);
    if (log.link_tautan) {
      await fillField(activePage, ["link", "tautan", "url"], log.link_tautan, "VALIDATION_ERROR", false);
    }

    setStep("ready_before_save");
    await activePage.waitForTimeout(300).catch(() => undefined);

    setStep("click_simpan");
    const saveResult = await clickSimpan(activePage, step);

    setStep("detect_result");
    try {
      await detectSaveResult(activePage, saveResult, step);
    } catch (error) {
      setStep("verify_after_save");
      const verification = await verifyLogExistsOnSkp(log).catch(() => null);
      if (verification?.foundOnSkp) {
        return {
          ok: true,
          status: "submitted",
          foundOnSkp: true,
          message: `Log ${log.kode_log} ditemukan di SKP setelah pengecekan ulang.`
        };
      }
      throw error;
    }

    return { ok: true, status: "submitted", message: `Log ${log.kode_log} terkirim pada ${nowIso()}.` };
  } catch (error) {
    const activePage = page && !page.isClosed() ? page : null;
    const currentUrl = error instanceof SkpAutomationError ? error.currentUrl : activePage?.url();
    const lastStep = error instanceof SkpAutomationError ? error.step ?? step : step;
  const automationError =
      error instanceof SkpAutomationError
        ? new SkpAutomationError(error.code, error.message, currentUrl, lastStep, error.details)
        : new SkpAutomationError("UNKNOWN_ERROR", (error as Error).message, currentUrl, lastStep);
    const screenshotPath = await captureErrorScreenshot(log.kode_log).catch(() => undefined);
    return {
      ok: false,
      status: automationError.code === "SITE_NOT_ALLOWED" ? "not_allowed_by_site" : "failed",
      errorCode: automationError.code,
      message: buildErrorMessage(automationError, screenshotPath),
      screenshotPath,
      currentUrl: automationError.currentUrl,
      step: automationError.step,
      validationText: automationError.details.validation_text,
      availableSkpOptions: automationError.details.available_skp_options
    };
  }
}

type VerificationCandidate = {
  text: string;
  source: string;
};

type LogMatchScore = {
  score: number;
  text: string;
  reasons: string[];
};

export async function verifyLogExistsOnSkp(log: DailyLog): Promise<SkpLogVerificationResult> {
  getSessionDir();
  const activePage = await getSubmitPage();
  await openLogPageForVerification(activePage, log.tanggal);
  const filteredByDate = await applyLogDateFilter(activePage, log.tanggal);
  await activePage.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await activePage.waitForTimeout(800).catch(() => undefined);

  const candidates = await readVerificationCandidates(activePage);
  const best = findBestLogMatch(log, candidates, filteredByDate);
  const foundOnSkp = best.score >= (best.text.length > 800 ? 8 : 6);

  return {
    success: true,
    foundOnSkp,
    checkedAt: nowIso(),
    confidence: best.score,
    message: foundOnSkp ? "Data ditemukan di SKP." : "Data belum ditemukan di SKP.",
    matchedText: foundOnSkp ? best.text.slice(0, 500) : undefined,
    currentUrl: activePage.url()
  };
}

async function openLogPageForVerification(activePage: Page, date: string): Promise<void> {
  logContextUse("verify_open_log_page", true, activePage.url());
  await activePage.goto(`${getBaseUrl()}${LOG_PATH}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await activePage.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await dismissBrowserPopups(activePage);
  await assertLoggedIn(activePage, "SESSION_EXPIRED", "Session SKP perlu login ulang saat cek status log.", "verify_open_log_page");

  const month = date.slice(0, 7);
  await activePage
    .evaluate(({ isoDate, monthValue }) => {
      const win = window as unknown as {
        jQuery?: (selector: string) => {
          fullCalendar?: (action: string, value?: string) => void;
        };
      };
      const calendar = win.jQuery?.("#calendar");
      if (calendar?.fullCalendar) {
        calendar.fullCalendar("gotoDate", isoDate);
      }
      const monthCalendar = win.jQuery?.(".calendar");
      if (monthCalendar?.fullCalendar) {
        monthCalendar.fullCalendar("gotoDate", monthValue);
      }
    }, { isoDate: date, monthValue: month })
    .catch(() => undefined);
}

async function applyLogDateFilter(activePage: Page, isoDate: string): Promise<boolean> {
  const [year, month, day] = isoDate.split("-");
  const slashDate = toIndonesianDate(isoDate);
  const dashDate = toIndonesianDateWithDash(isoDate);
  const monthValue = year && month ? `${year}-${month}` : isoDate.slice(0, 7);
  const changed = await activePage
    .evaluate(
      ({ iso, slash, dash, monthOnly }) => {
        const labelsByFor = new Map<string, string>();
        for (const label of Array.from(document.querySelectorAll("label"))) {
          const forValue = label.getAttribute("for");
          if (forValue) labelsByFor.set(forValue, label.textContent ?? "");
        }

        const controls = Array.from(document.querySelectorAll("input, select")) as Array<HTMLInputElement | HTMLSelectElement>;
        let didChange = false;
        for (const control of controls) {
          if (!isUsable(control)) continue;
          const input = control as HTMLInputElement;
          const type = (input.type || "").toLowerCase();
          const meta = [
            control.id,
            control.getAttribute("name"),
            control.getAttribute("placeholder"),
            control.getAttribute("aria-label"),
            labelsByFor.get(control.id)
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          const looksDateLike =
            type === "date" ||
            type === "month" ||
            /tanggal|tgl|date|periode|bulan|month|mulai|akhir|from|to/.test(meta);
          if (!looksDateLike) continue;

          const nextValue = type === "date" ? iso : type === "month" || /bulan|month/.test(meta) ? monthOnly : slash;
          setNativeValue(input, nextValue);
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          input.dispatchEvent(new Event("blur", { bubbles: true }));
          if (!input.value && type !== "date" && type !== "month") {
            setNativeValue(input, dash);
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
            input.dispatchEvent(new Event("blur", { bubbles: true }));
          }
          didChange = true;
        }

        return didChange;

        function isUsable(element: Element): boolean {
          const html = element as HTMLElement;
          const control = element as HTMLInputElement | HTMLSelectElement;
          const type = "type" in control ? String(control.type || "").toLowerCase() : "";
          const style = window.getComputedStyle(html);
          return type !== "hidden" && !control.disabled && style.display !== "none" && style.visibility !== "hidden" && html.getClientRects().length > 0;
        }

        function setNativeValue(control: HTMLInputElement | HTMLSelectElement, value: string): void {
          if (control instanceof HTMLSelectElement) return;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          if (setter) setter.call(control, value);
          else control.value = value;
        }
      },
      { iso: isoDate, slash: slashDate, dash: dashDate, monthOnly: monthValue }
    )
    .catch(() => false);

  if (changed) {
    await clickFilterButton(activePage);
    await activePage.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    await activePage.waitForTimeout(800).catch(() => undefined);
  }
  return changed;
}

async function clickFilterButton(activePage: Page): Promise<void> {
  for (const pattern of [/cari/i, /tampilkan/i, /filter/i, /lihat/i, /search/i, /terapkan/i, /refresh/i]) {
    for (const locator of [activePage.getByRole("button", { name: pattern }).first(), activePage.getByRole("link", { name: pattern }).first()]) {
      if (await locator.isVisible({ timeout: 700 }).catch(() => false)) {
        await locator.click({ timeout: 3000 }).catch(() => undefined);
        return;
      }
    }
  }
}

async function readVerificationCandidates(activePage: Page): Promise<VerificationCandidate[]> {
  const selectors = [
    "tbody tr",
    "table tr",
    ".fc-event",
    ".event",
    ".list-group-item",
    ".card",
    ".panel",
    ".media",
    "li",
    "[class*='log' i]",
    "[class*='aktivitas' i]"
  ].join(", ");
  const raw = await activePage
    .locator(selectors)
    .evaluateAll((nodes) =>
      nodes
        .map((node) => {
          const element = node as HTMLElement;
          const style = window.getComputedStyle(element);
          if (style.display === "none" || style.visibility === "hidden" || element.getClientRects().length === 0) return null;
          const text = (element.innerText || element.textContent || "").trim();
          if (!text) return null;
          return { text, source: element.tagName.toLowerCase() };
        })
        .filter((item): item is { text: string; source: string } => Boolean(item))
    )
    .catch(() => []);

  const bodyText = await activePage.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  const candidates = [...raw, { text: bodyText, source: "body" }].filter((item) => item.text.trim().length > 0);
  const seen = new Set<string>();
  return candidates.filter((item) => {
    const key = normalizeForComparison(item.text).slice(0, 300);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findBestLogMatch(log: DailyLog, candidates: VerificationCandidate[], filteredByDate: boolean): LogMatchScore {
  const scores = candidates.map((candidate) => scoreCandidateText(log, candidate.text, filteredByDate));
  return scores.reduce<LogMatchScore>((best, current) => (current.score > best.score ? current : best), { score: 0, text: "", reasons: [] });
}

function scoreCandidateText(log: DailyLog, text: string, filteredByDate: boolean): LogMatchScore {
  const normalizedText = normalizeForComparison(text);
  const reasons: string[] = [];
  let score = 0;

  const dateMatched = buildDateVariants(log.tanggal).some((variant) => normalizedText.includes(normalizeForComparison(variant)));
  if (dateMatched) {
    score += 3;
    reasons.push("tanggal");
  } else if (filteredByDate) {
    score += 1.5;
    reasons.push("filter_tanggal");
  }

  const activity = normalizeForComparison(log.nama_aktivitas);
  const activityOverlap = tokenOverlap(activity, normalizedText);
  const activityMatched = Boolean(activity && (normalizedText.includes(activity) || activityOverlap >= 0.6));
  if (activityMatched) {
    score += normalizedText.includes(activity) ? 4 : 2.5;
    reasons.push("aktivitas");
  }

  const description = normalizeForComparison(log.deskripsi);
  const descriptionOverlap = tokenOverlap(description, normalizedText);
  const descriptionMatched = Boolean(description && (containsMeaningful(normalizedText, description) || descriptionOverlap >= 0.38));
  if (descriptionMatched) {
    score += containsMeaningful(normalizedText, description) ? 2.5 : 1.5;
    reasons.push("deskripsi");
  }

  const kodeSkp = normalizeForComparison(log.kode_skp);
  const namaSkp = normalizeForComparison(log.nama_skp);
  const skpMatched = Boolean((kodeSkp && normalizedText.includes(kodeSkp)) || (namaSkp && containsMeaningful(normalizedText, namaSkp)));
  if (skpMatched) {
    score += 2;
    reasons.push("skp");
  }

  const quantity = normalizeForComparison(log.kuantitas_output);
  const unit = normalizeForComparison(log.satuan);
  const quantityMatched = Boolean(quantity && quantity.length > 1 && normalizedText.includes(quantity));
  const unitMatched = Boolean(unit && normalizedText.includes(unit));
  if (quantityMatched) {
    score += 1;
    reasons.push("kuantitas");
  }
  if (unitMatched) {
    score += 1;
    reasons.push("satuan");
  }

  if (!activityMatched && !descriptionMatched) score = Math.min(score, 4);
  if (!dateMatched && !filteredByDate && text.length > 800) score = Math.min(score, 5);
  if (score >= 6 && !skpMatched && !descriptionMatched && !quantityMatched && !unitMatched && description) score -= 1.5;

  return { score, text, reasons };
}

function containsMeaningful(haystack: string, needle: string): boolean {
  if (!needle) return false;
  if (needle.length <= 80) return haystack.includes(needle);
  const excerpt = meaningfulTokens(needle).slice(0, 12).join(" ");
  return excerpt.length > 12 && haystack.includes(excerpt);
}

function tokenOverlap(needle: string, haystack: string): number {
  const tokens = meaningfulTokens(needle);
  if (tokens.length === 0) return 0;
  const haystackTokens = new Set(meaningfulTokens(haystack));
  const matched = tokens.filter((token) => haystackTokens.has(token)).length;
  return matched / tokens.length;
}

function meaningfulTokens(value: string): string[] {
  return Array.from(new Set(value.split(" ").filter((token) => token.length >= 4 && !/^\d+$/.test(token))));
}

function buildDateVariants(isoDate: string): string[] {
  const [year, month, day] = isoDate.split("-");
  const monthIndex = Math.max(0, Number(month) - 1);
  const monthNames = ["januari", "februari", "maret", "april", "mei", "juni", "juli", "agustus", "september", "oktober", "november", "desember"];
  const shortMonthNames = ["jan", "feb", "mar", "apr", "mei", "jun", "jul", "agu", "sep", "okt", "nov", "des"];
  return [
    isoDate,
    `${day}/${month}/${year}`,
    `${day}-${month}-${year}`,
    `${day} ${monthNames[monthIndex]} ${year}`,
    `${day} ${shortMonthNames[monthIndex]} ${year}`
  ].filter(Boolean);
}

async function ensureLoggedIn(): Promise<void> {
  const activePage = await getAutomationPage(true);
  await activePage.goto(`${getBaseUrl()}${LOG_PATH}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await activePage.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await dismissBrowserPopups(activePage);
  if (!(await detectLoginPage(activePage))) {
    if (await detectLogPage(activePage)) {
      await assertLogPage(activePage, "ensure_logged_in");
      updateSkpSessionStatus("connected", "Terhubung ke SKP");
      return;
    }
    throw new SkpAutomationError("LOG_PAGE_NOT_FOUND", "Halaman Log Harian SKP tidak terbuka dan halaman login tidak terdeteksi jelas.", activePage.url(), "ensure_logged_in");
  }

  const loginNonPortal = activePage.getByText(/Login Non Portal/i).first();
  if (await loginNonPortal.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loginNonPortal.click();
    await activePage.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
  }

  const { username, password } = getSkpCredentials();
  if (!username || !password) {
    throw new SkpAutomationError("LOGIN_REQUIRED", "Session SKP belum login dan credential otomatis belum tersedia di Settings atau .env.local.", activePage.url(), "ensure_logged_in");
  }

  const filled = await autofillCredentials(activePage, username, password);
  if (!filled) {
    throw new SkpAutomationError("LOGIN_REQUIRED", "Form login SKP tidak bisa diisi otomatis. Login manual diperlukan.", activePage.url(), "auto_login");
  }

  await submitLogin(activePage);
  await activePage.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await activePage.goto(`${getBaseUrl()}${LOG_PATH}`, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
  await activePage.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  if (await detectLoginPage(activePage)) {
    updateSkpSessionStatus("expired", "Session SKP perlu login ulang.");
    throw new SkpAutomationError("LOGIN_REQUIRED", "Auto-login SKP gagal. Periksa username/password atau login manual.", activePage.url(), "auto_login");
  }
  await assertLogPage(activePage, "auto_login");
  updateSkpSessionStatus("connected", "Terhubung ke SKP");
}

async function openLogPageForSubmit(activePage: Page): Promise<void> {
  logContextUse("open_log_page", true, activePage.url());
  await activePage.goto(`${getBaseUrl()}${LOG_PATH}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await activePage.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await dismissBrowserPopups(activePage);
  if (await detectLoginPage(activePage)) {
    updateSkpSessionStatus("expired", "Session SKP perlu login ulang.");
    setSkpSessionStatusMemory("expired");
    throw new SkpAutomationError("SESSION_EXPIRED", "Session SKP perlu login ulang.", activePage.url(), "open_log_page");
  }
  if (!(await detectDashboardPage(activePage))) {
    throw new SkpAutomationError("LOG_PAGE_NOT_FOUND", "Halaman Log Harian SKP belum bisa dipastikan.", activePage.url(), "open_log_page");
  }
  updateSkpSessionStatus("connected", "Terhubung ke SKP");
  setSkpSessionStatusMemory("connected");
}

async function autofillCredentials(activePage: Page, username: string, password: string): Promise<boolean> {
  const usernameInput = activePage
    .locator('input[name*="user" i], input[name*="nip" i], input[id*="user" i], input[id*="nip" i], input[type="text"], input:not([type])')
    .first();
  const passwordInput = activePage.locator('input[type="password"], input[name*="pass" i], input[id*="pass" i]').first();
  if (!(await usernameInput.isVisible({ timeout: 5000 }).catch(() => false)) || !(await passwordInput.isVisible({ timeout: 5000 }).catch(() => false))) {
    return false;
  }
  await usernameInput.fill(username);
  await passwordInput.fill(password);
  return true;
}

async function submitLogin(activePage: Page): Promise<void> {
  const submit = activePage.getByRole("button", { name: /masuk|login|sign in/i }).first();
  if (await submit.isVisible({ timeout: 5000 }).catch(() => false)) {
    await submit.click();
    return;
  }
  const inputSubmit = activePage.locator('input[type="submit"], button[type="submit"]').first();
  if (await inputSubmit.isVisible({ timeout: 3000 }).catch(() => false)) {
    await inputSubmit.click();
    return;
  }
  await activePage.keyboard.press("Enter");
}

async function assertLoggedIn(activePage: Page, code: string, message: string, step: string): Promise<void> {
  if (await detectLoginPage(activePage)) throw new SkpAutomationError(code, message, activePage.url(), step);
}

async function assertLogPage(activePage: Page, step: string): Promise<void> {
  if (!(await detectLogPage(activePage))) {
    throw new SkpAutomationError("LOG_PAGE_NOT_FOUND", "Halaman Log Harian SKP tidak ditemukan.", activePage.url(), step);
  }
}

async function detectLoginPage(activePage: Page): Promise<boolean> {
  const url = activePage.url().toLowerCase();
  if (isLoginJspUrl(url)) return true;
  const text = (await activePage.locator("body").innerText({ timeout: 3000 }).catch(() => "")).toLowerCase();
  if (text.includes("login non portal")) return true;
  return false;
}

async function detectLogPage(activePage: Page): Promise<boolean> {
  const url = activePage.url().toLowerCase();
  if (url.includes("/pegawai/logharian") || url.includes("logharian")) return true;
  const text = (await activePage.locator("body").innerText({ timeout: 3000 }).catch(() => "")).toLowerCase();
  return text.includes("log harian") || (text.includes("tanggal") && (text.includes("aktivitas") || text.includes("simpan")));
}

async function detectDashboardPage(activePage: Page): Promise<boolean> {
  const url = activePage.url().toLowerCase();
  if (isLoginJspUrl(url)) return false;
  const text = (await activePage.locator("body").innerText({ timeout: 3000 }).catch(() => "")).toLowerCase();
  return text.includes("beranda") || text.includes("log harian") || text.includes("logout") || text.includes("keluar") || text.includes("sasaran kinerja");
}

async function dismissBrowserPopups(activePage: Page): Promise<void> {
  await activePage.keyboard.press("Escape").catch(() => undefined);
}

async function clickAddLog(activePage: Page): Promise<void> {
  const labels = [/tambah.*log/i, /log.*baru/i, /tambah/i, /input.*log/i, /add/i];
  for (const label of labels) {
    const button = activePage.getByRole("button", { name: label }).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      await activePage.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
      return;
    }
    const link = activePage.getByRole("link", { name: label }).first();
    if (await link.isVisible().catch(() => false)) {
      await link.click();
      await activePage.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
      return;
    }
  }

  const textTrigger = activePage.getByText(/tambah.*log|log.*baru|input.*log|tambah/i).first();
  if (await textTrigger.isVisible().catch(() => false)) {
    await textTrigger.click();
    return;
  }

  const cssTrigger = activePage
    .locator('a[href*="add" i], a[href*="input" i], a[href*="logharian" i], button[onclick*="add" i], button[onclick*="input" i], input[type="button"], input[type="submit"]')
    .filter({ hasText: /tambah|input|add|baru/i })
    .first();
  if (await cssTrigger.isVisible().catch(() => false)) {
    await cssTrigger.click();
    return;
  }

  throw new SkpAutomationError("ADD_LOG_BUTTON_NOT_FOUND", "Tombol Tambah Log Harian tidak ditemukan.", activePage.url(), "open_add_log_form");
}

async function waitForLogForm(activePage: Page): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await activePage.waitForTimeout(500).catch(() => undefined);
    await assertLoggedIn(activePage, "LOGIN_PAGE_DETECTED_DURING_SUBMIT", "Session SKP diarahkan ke halaman login saat menunggu form.", "wait_log_form");
    const formTitle = await activePage.getByText(/tambah.*log harian|log harian|nama aktivitas|kuantitas output/i).first().isVisible({ timeout: 500 }).catch(() => false);
    const dateField = await activePage.locator('input[type="date"], input[name*="tanggal" i], input[id*="tanggal" i], input[name*="tgl" i], input[id*="tgl" i]').first().isVisible({ timeout: 500 }).catch(() => false);
    const activityField = await activePage
      .locator('input[name*="aktivitas" i], input[id*="aktivitas" i], textarea[name*="aktivitas" i], textarea[id*="aktivitas" i]')
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (formTitle && (dateField || activityField)) return;
  }
  throw new SkpAutomationError("LOG_FORM_NOT_OPENED", "Modal/Form Tambah Log Harian tidak terbuka setelah klik Tambah Log.", activePage.url(), "open_add_log_form");
}

type SaveClickResult = {
  saveButton: Locator;
  beforeUrl: string;
};

async function clickSimpan(activePage: Page, step: string): Promise<SaveClickResult> {
  const saveButton = await findSaveButton(activePage);
  if (!saveButton) {
    throw new SkpAutomationError("SAVE_BUTTON_NOT_FOUND", "Tombol Simpan tidak ditemukan.", activePage.url(), step);
  }

  const beforeUrl = activePage.url();
  await saveButton.click();
  return { saveButton, beforeUrl };
}

async function detectSaveResult(activePage: Page, saveResult: SaveClickResult, step: string): Promise<void> {
  await activePage.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await activePage.waitForTimeout(1000).catch(() => undefined);
  await assertLoggedIn(activePage, "LOGIN_PAGE_DETECTED_DURING_SUBMIT", "Session SKP diarahkan ke halaman login setelah klik Simpan.", step);

  const validationText = await readValidationText(activePage);
  if (validationText) {
    throw new SkpAutomationError("VALIDATION_ERROR", validationText, activePage.url(), step, { validation_text: validationText });
  }

  const successVisible = await activePage.getByText(/berhasil|sukses|success|tersimpan|disimpan/i).first().isVisible({ timeout: 1500 }).catch(() => false);
  const saveStillVisible = await saveResult.saveButton.isVisible({ timeout: 1500 }).catch(() => false);
  if (successVisible || activePage.url() !== saveResult.beforeUrl || !saveStillVisible) return;

  throw new SkpAutomationError("LOG_SAVE_FAILED", "Situs tidak menampilkan tanda simpan berhasil.", activePage.url(), step);
}

async function readValidationText(activePage: Page): Promise<string | null> {
  const validation = activePage
    .locator(
      [
        ".alert-danger",
        ".alert-error",
        ".invalid-feedback",
        ".error",
        ".help-block",
        "[class*='error' i]",
        "[class*='invalid' i]",
        "[role='alert']"
      ].join(", ")
    )
    .filter({ hasText: /wajib|harus diisi|tidak valid|validasi|gagal|error|failed|required|silakan pilih/i })
    .first();
  if (await validation.isVisible({ timeout: 1500 }).catch(() => false)) {
    const text = await validation.innerText({ timeout: 1500 }).catch(() => "");
    if (text.trim()) return text.trim();
  }

  const textNode = activePage.getByText(/wajib|harus diisi|tidak valid|validasi|gagal|error|failed|required|silakan pilih/i).first();
  if (await textNode.isVisible({ timeout: 1000 }).catch(() => false)) {
    const text = await textNode.innerText({ timeout: 1000 }).catch(() => "");
    if (text.trim()) return text.trim();
  }
  return null;
}

async function findSaveButton(activePage: Page): Promise<Locator | null> {
  for (const locator of [
    activePage.getByRole("button", { name: /simpan|save/i }).first(),
    activePage.getByRole("link", { name: /simpan|save/i }).first(),
    activePage.locator('button[type="submit"], input[type="submit"], input[value*="simpan" i], input[value*="save" i]').first(),
    activePage.getByText(/^\s*(simpan|save)\s*$/i).first()
  ]) {
    if (await locator.isVisible({ timeout: 1500 }).catch(() => false)) return locator;
  }
  return null;
}

async function fillDate(activePage: Page, isoDate: string): Promise<void> {
  const filledByVisibleLabel = await fillControlByVisibleText(activePage, ["tanggal", "tgl"], isoDate, "input", isoDate);
  if (filledByVisibleLabel) return;

  const control = await findTextControl(activePage, ["tanggal", "tgl", "date"]);
  if (!control || !(await control.isVisible({ timeout: 1000 }).catch(() => false))) {
    throw new SkpAutomationError("DATE_FIELD_NOT_FOUND", "Field Tanggal tidak ditemukan.", activePage.url(), "fill_tanggal");
  }

  const type = (await control.getAttribute("type").catch(() => null))?.toLowerCase();
  await control.fill(isoDate);
  await control.evaluate((node) => {
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    node.dispatchEvent(new Event("blur", { bubbles: true }));
  }).catch(() => undefined);

  const value = await control.inputValue().catch(() => "");
  if (!value && type !== "date") {
    await control.fill(toIndonesianDateWithDash(isoDate));
    await control.evaluate((node) => {
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
      node.dispatchEvent(new Event("blur", { bubbles: true }));
    }).catch(() => undefined);
  }
}

async function fillField(activePage: Page, aliases: string[], value: string, errorCode: string, required = true): Promise<void> {
  if (!value && !required) return;
  const filledByVisibleLabel = await fillControlByVisibleText(activePage, aliases, value, "input, textarea");
  if (filledByVisibleLabel) return;

  for (const alias of aliases) {
    const pattern = new RegExp(escapeRegExp(alias), "i");
    const control = activePage.getByLabel(pattern).first();
    if (await control.isVisible().catch(() => false)) {
      await control.fill(value);
      return;
    }
    const placeholder = activePage.getByPlaceholder(pattern).first();
    if (await placeholder.isVisible().catch(() => false)) {
      await placeholder.fill(value);
      return;
    }
  }

  const byVisibleText = await findControlNearVisibleText(activePage, aliases, "input, textarea");
  if (byVisibleText && (await byVisibleText.isVisible().catch(() => false))) {
    await byVisibleText.fill(value);
    return;
  }

  for (const token of fieldTokens(aliases)) {
    const byAttribute = activePage
      .locator(
        `input[name*="${token}" i], input[id*="${token}" i], input[placeholder*="${token}" i], textarea[name*="${token}" i], textarea[id*="${token}" i], textarea[placeholder*="${token}" i]`
      )
      .first();
    if (await byAttribute.isVisible().catch(() => false)) {
      await byAttribute.fill(value);
      return;
    }
  }

  const byNearbyLabel = await findControlNearLabel(activePage, aliases, "input, textarea");
  if (byNearbyLabel && (await byNearbyLabel.isVisible().catch(() => false))) {
    await byNearbyLabel.fill(value);
    return;
  }

  if (required) {
    throw new SkpAutomationError(errorCode, `Field ${aliases[0]} tidak ditemukan.`, activePage.url(), `fill_${fieldTokens(aliases)[0] ?? "field"}`);
  }
}

async function fillDescription(activePage: Page, value: string): Promise<void> {
  const plainField = await findTextControl(activePage, ["deskripsi", "uraian", "keterangan"]);
  if (plainField && (await plainField.isVisible().catch(() => false))) {
    await plainField.fill(value);
    return;
  }

  const editor = activePage.locator('[contenteditable="true"], .note-editable, .tox-edit-area, iframe').first();
  if (await editor.isVisible().catch(() => false)) {
    const tagName = await editor.evaluate((node) => node.tagName.toLowerCase()).catch(() => "");
    if (tagName === "iframe") {
      const frame = activePage.frameLocator("iframe").first();
      await pasteTextIntoLocator(activePage, frame.locator("body").first(), value);
      return;
    }
    await pasteTextIntoLocator(activePage, editor, value);
    return;
  }

  for (const frame of activePage.frames()) {
    const frameEditor = frame.locator('[contenteditable="true"], .note-editable, body').first();
    if (await frameEditor.isVisible().catch(() => false)) {
      await pasteTextIntoLocator(activePage, frameEditor, value);
      return;
    }
  }

  throw new SkpAutomationError("DESCRIPTION_EDITOR_NOT_FOUND", "Editor Deskripsi tidak ditemukan.", activePage.url(), "fill_deskripsi");
}

async function fillControlByVisibleText(
  activePage: Page,
  aliases: string[],
  value: string,
  controlSelector: "input" | "input, textarea",
  dateValue?: string
): Promise<boolean> {
  return activePage
    .evaluate(
      ({ aliases: rawAliases, value: rawValue, controlSelector: rawControlSelector, dateValue: rawDateValue }) => {
        const labels = rawAliases.map((item) => normalizeForPage(item));
        const labelElements = Array.from(document.querySelectorAll("label, div, span, td, th, p, strong")).filter((element) => {
          const htmlElement = element as HTMLElement;
          const text = normalizeForPage(htmlElement.innerText || htmlElement.textContent || "");
          return labels.includes(text) && isVisible(htmlElement);
        }) as HTMLElement[];

        for (const label of labelElements) {
          const controls = Array.from(document.querySelectorAll(rawControlSelector)).filter((node) => {
            const control = node as HTMLInputElement | HTMLTextAreaElement;
            const type = "type" in control ? String(control.type || "").toLowerCase() : "";
            return type !== "hidden" && !control.disabled && isVisible(control) && Boolean(label.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING);
          }) as Array<HTMLInputElement | HTMLTextAreaElement>;

          const control = controls[0];
          if (!control) continue;
          const nextValue = control instanceof HTMLInputElement && control.type === "date" && rawDateValue ? rawDateValue : rawValue;
          setNativeValue(control, nextValue);
          control.dispatchEvent(new Event("input", { bubbles: true }));
          control.dispatchEvent(new Event("change", { bubbles: true }));
          control.dispatchEvent(new Event("blur", { bubbles: true }));
          return true;
        }
        return false;

        function isVisible(element: HTMLElement): boolean {
          const style = window.getComputedStyle(element);
          return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
        }

        function normalizeForPage(text: string): string {
          return text
            .toLowerCase()
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        }

        function setNativeValue(control: HTMLInputElement | HTMLTextAreaElement, nextValue: string): void {
          const prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
          if (setter) setter.call(control, nextValue);
          else control.value = nextValue;
        }
      },
      { aliases, value, controlSelector, dateValue }
    )
    .catch(() => false);
}

async function findTextControl(activePage: Page, aliases: string[]): Promise<Locator | null> {
  for (const alias of aliases) {
    const pattern = new RegExp(escapeRegExp(alias), "i");
    const labeled = activePage.getByLabel(pattern).first();
    if (await labeled.isVisible({ timeout: 1000 }).catch(() => false)) return labeled;
    const placeholder = activePage.getByPlaceholder(pattern).first();
    if (await placeholder.isVisible({ timeout: 1000 }).catch(() => false)) return placeholder;
  }

  const byVisibleText = await findControlNearVisibleText(activePage, aliases, "input, textarea");
  if (byVisibleText && (await byVisibleText.isVisible({ timeout: 1000 }).catch(() => false))) return byVisibleText;

  for (const token of fieldTokens(aliases)) {
    const byAttribute = activePage
      .locator(
        `textarea[name*="${token}" i], textarea[id*="${token}" i], textarea[placeholder*="${token}" i], input[name*="${token}" i], input[id*="${token}" i], input[placeholder*="${token}" i]`
      )
      .first();
    if (await byAttribute.isVisible({ timeout: 1000 }).catch(() => false)) return byAttribute;
  }

  return findControlNearLabel(activePage, aliases, "input, textarea");
}

async function findControlNearLabel(activePage: Page, aliases: string[], selector: "input, textarea" | "select"): Promise<Locator | null> {
  for (const alias of aliases) {
    const pattern = new RegExp(escapeRegExp(alias), "i");
    const label = activePage.locator("label").filter({ hasText: pattern }).first();
    if (!(await label.isVisible({ timeout: 1000 }).catch(() => false))) continue;

    const forValue = await label.getAttribute("for").catch(() => null);
    if (forValue) {
      const byFor = activePage.locator(`${selector}[id="${escapeCssAttribute(forValue)}"]`).first();
      if (await byFor.isVisible({ timeout: 1000 }).catch(() => false)) return byFor;
    }

    const nearby =
      selector === "select"
        ? label.locator("xpath=following::select[1]")
        : label.locator("xpath=following::*[self::input or self::textarea][1]");
    if (await nearby.isVisible({ timeout: 1000 }).catch(() => false)) return nearby;
  }
  return null;
}

async function findControlNearVisibleText(activePage: Page, aliases: string[], selector: "input, textarea" | "select"): Promise<Locator | null> {
  for (const alias of aliases) {
    const textNode = activePage.getByText(new RegExp(`^\\s*${escapeRegExp(alias)}\\s*$`, "i")).first();
    if (!(await textNode.isVisible({ timeout: 1000 }).catch(() => false))) continue;

    const xpath = selector === "select" ? "following::select[1]" : "following::*[self::input or self::textarea][1]";
    const nearby = textNode.locator(`xpath=${xpath}`);
    if (await nearby.isVisible({ timeout: 1000 }).catch(() => false)) return nearby;
  }
  return null;
}

async function pasteTextIntoLocator(activePage: Page, target: Locator, value: string): Promise<void> {
  await target.click({ timeout: 5000 });
  await activePage.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => undefined);
  const pasted = await activePage
    .evaluate(async (text) => {
      await navigator.clipboard.writeText(text);
      return true;
    }, value)
    .catch(() => false);

  if (pasted) {
    await activePage.keyboard.press(process.platform === "darwin" ? "Meta+V" : "Control+V");
  } else {
    await activePage.keyboard.insertText(value);
  }
}

async function findSkpSelect(activePage: Page): Promise<Locator | null> {
  const selectByLabel = activePage.getByLabel(/skp/i).first();
  if ((await isSelectElement(selectByLabel)) && (await selectByLabel.isVisible().catch(() => false))) return selectByLabel;
  for (const token of ["skp", "sasaran", "kinerja", "kode"]) {
    const byAttribute = activePage.locator(`select[name*="${token}" i], select[id*="${token}" i], select[aria-label*="${token}" i]`).first();
    if (await byAttribute.isVisible().catch(() => false)) return byAttribute;
  }
  const nearLabel = await findControlNearLabel(activePage, ["skp", "sasaran kinerja pegawai", "sasaran", "kinerja"], "select");
  if (nearLabel && (await nearLabel.isVisible().catch(() => false))) return nearLabel;
  const select = activePage.locator("select").filter({ hasText: /PIP|SKP|Sasaran|Kinerja/i }).first();
  if (await select.isVisible().catch(() => false)) return select;
  return null;
}

type SkpDropdownControl =
  | { kind: "native"; select: Locator }
  | { kind: "custom"; trigger: Locator; sourceSelect: Locator | null };

async function waitForSkpDropdown(activePage: Page, timeoutMs = 15_000): Promise<SkpDropdownControl | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const nativeSelect = await findSkpSelect(activePage);
    if (nativeSelect) return { kind: "native", select: nativeSelect };

    const sourceSelect = await findAnySkpSelect(activePage);
    const customTrigger = await findSkpCustomDropdown(activePage, sourceSelect);
    if (customTrigger) return { kind: "custom", trigger: customTrigger, sourceSelect };

    await activePage.waitForTimeout(500).catch(() => undefined);
  }
  return null;
}

async function findAnySkpSelect(activePage: Page): Promise<Locator | null> {
  const byLabel = activePage.getByLabel(/skp|sasaran kinerja|sasaran|kinerja/i).first();
  if (await isSelectElement(byLabel)) return byLabel;

  for (const token of ["skp", "sasaran", "kinerja", "kode"]) {
    const byAttribute = activePage.locator(`select[name*="${token}" i], select[id*="${token}" i], select[aria-label*="${token}" i]`).first();
    if ((await byAttribute.count().catch(() => 0)) > 0) return byAttribute;
  }

  const selectWithOptions = activePage.locator("select").filter({ hasText: /PIP|SKP|Sasaran|Kinerja/i }).first();
  if ((await selectWithOptions.count().catch(() => 0)) > 0) return selectWithOptions;
  return null;
}

async function findSkpCustomDropdown(activePage: Page, sourceSelect: Locator | null): Promise<Locator | null> {
  if (sourceSelect) {
    const id = await sourceSelect.getAttribute("id").catch(() => null);
    if (id) {
      for (const locator of [
        activePage.locator(`[aria-labelledby="select2-${escapeCssAttribute(id)}-container"]`).first(),
        activePage.locator(`[id="select2-${escapeCssAttribute(id)}-container"]`).first(),
        sourceSelect.locator(
          "xpath=following::*[contains(concat(' ', normalize-space(@class), ' '), ' select2-container ') or contains(concat(' ', normalize-space(@class), ' '), ' chosen-container ')][1]"
        )
      ]) {
        if (await locator.isVisible({ timeout: 1000 }).catch(() => false)) return locator;
      }
    }

    const siblingWidget = sourceSelect.locator(
      "xpath=following::*[@role='combobox' or contains(concat(' ', normalize-space(@class), ' '), ' select2-selection ') or contains(concat(' ', normalize-space(@class), ' '), ' chosen-single ')][1]"
    );
    if (await siblingWidget.isVisible({ timeout: 1000 }).catch(() => false)) return siblingWidget;
  }

  const nearLabel = await findCustomControlNearLabel(activePage, ["skp", "sasaran kinerja pegawai", "sasaran", "kinerja"]);
  if (nearLabel) return nearLabel;

  for (const locator of [
    activePage.locator(".select2-selection, .select2-selection__rendered, [role='combobox'], .chosen-single").filter({ hasText: /pilih|skp|sasaran|kinerja|pip/i }).first(),
    activePage.locator(".select2-selection, [role='combobox'], .chosen-single").first()
  ]) {
    if (await locator.isVisible({ timeout: 1000 }).catch(() => false)) return locator;
  }
  return null;
}

async function findCustomControlNearLabel(activePage: Page, aliases: string[]): Promise<Locator | null> {
  for (const alias of aliases) {
    const label = activePage.locator("label").filter({ hasText: new RegExp(escapeRegExp(alias), "i") }).first();
    if (!(await label.isVisible({ timeout: 1000 }).catch(() => false))) continue;
    const nearby = label.locator(
      "xpath=following::*[@role='combobox' or contains(concat(' ', normalize-space(@class), ' '), ' select2-selection ') or contains(concat(' ', normalize-space(@class), ' '), ' select2-container ') or contains(concat(' ', normalize-space(@class), ' '), ' chosen-single ')][1]"
    );
    if (await nearby.isVisible({ timeout: 1000 }).catch(() => false)) return nearby;
  }
  return null;
}

async function isSelectElement(locator: Locator): Promise<boolean> {
  return (await locator.evaluate((node) => node.tagName.toLowerCase() === "select").catch(() => false)) === true;
}

async function selectSkp(activePage: Page, log: DailyLog): Promise<void> {
  const dropdown = await waitForSkpDropdown(activePage);
  if (!dropdown) throw new SkpAutomationError("SKP_DROPDOWN_NOT_FOUND", "Dropdown SKP tidak ditemukan.", activePage.url(), "select_skp");

  let options: SkpSiteOption[] = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    options = await readSkpOptions(activePage, dropdown);
    if (options.some((item) => isSelectableSkpOption(item.text))) break;
    await activePage.waitForTimeout(600).catch(() => undefined);
  }

  const siteMapping = await resolveSkpOption(log);
  const match = findBestSkpOption(log, options, siteMapping);

  if (match) {
    await chooseSkpOption(activePage, dropdown, match);
    persistSkpMapping(log, match);
    return;
  }

  const availableOptions = options.filter((item) => item.text && isSelectableSkpOption(item.text)).map((item) => item.text);

  throw new SkpAutomationError(
    "SKP_OPTION_NOT_FOUND",
    availableOptions.length > 0 ? "Opsi SKP tidak cocok dengan dropdown website." : "Opsi SKP tidak terbaca dari dropdown website.",
    activePage.url(),
    "select_skp",
    { available_skp_options: availableOptions }
  );
}

async function readSkpOptions(activePage: Page, dropdown: SkpDropdownControl): Promise<SkpSiteOption[]> {
  if (dropdown.kind === "native") return readNativeSkpOptions(dropdown.select);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await dropdown.trigger.click({ timeout: 5000 }).catch(async () => {
      await dropdown.trigger.locator("xpath=ancestor-or-self::*[@role='combobox' or contains(concat(' ', normalize-space(@class), ' '), ' select2-selection ')][1]").click({ timeout: 2000 });
    });
    await activePage.waitForTimeout(400).catch(() => undefined);
    const options = await readVisibleCustomSkpOptions(activePage);
    if (options.length > 0) return options;
    await activePage.keyboard.press("ArrowDown").catch(() => undefined);
    await activePage.waitForTimeout(300).catch(() => undefined);
  }

  if (dropdown.sourceSelect) return readNativeSkpOptions(dropdown.sourceSelect);
  return [];
}

async function readNativeSkpOptions(select: Locator): Promise<SkpSiteOption[]> {
  return select.locator("option").evaluateAll((nodes) =>
    nodes.map((node) => ({ text: (node.textContent ?? "").trim(), value: (node as HTMLOptionElement).value }))
  );
}

async function readVisibleCustomSkpOptions(activePage: Page): Promise<SkpSiteOption[]> {
  const rawOptions = await activePage.locator(SKP_OPTION_SELECTORS).evaluateAll((nodes) =>
    nodes
      .filter((node) => {
        const element = node as HTMLElement;
        const style = window.getComputedStyle(element);
        return style.visibility !== "hidden" && style.display !== "none" && element.getClientRects().length > 0;
      })
      .map((node) => {
        const element = node as HTMLElement;
        return {
          text: (element.innerText || element.textContent || "").trim(),
          value: element.getAttribute("data-value") || element.getAttribute("value") || element.getAttribute("id") || ""
        };
      })
  );

  const seen = new Set<string>();
  return rawOptions.filter((item) => {
    const key = `${item.text}\u0000${item.value}`;
    if (!item.text || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function chooseSkpOption(activePage: Page, dropdown: SkpDropdownControl, match: SkpSiteOption): Promise<void> {
  if (dropdown.kind === "native") {
    await selectNativeOption(dropdown.select, match);
    return;
  }

  await readSkpOptions(activePage, dropdown);
  const clicked = await clickCustomOption(activePage, match);
  if (clicked) return;

  if (dropdown.sourceSelect) {
    await selectNativeOption(dropdown.sourceSelect, match);
    return;
  }

  throw new SkpAutomationError("SKP_OPTION_NOT_FOUND", "Opsi SKP ditemukan tetapi tidak bisa diklik.", activePage.url(), "select_skp", {
    available_skp_options: (await readVisibleCustomSkpOptions(activePage)).filter((item) => isSelectableSkpOption(item.text)).map((item) => item.text)
  });
}

async function selectNativeOption(select: Locator, match: SkpSiteOption): Promise<void> {
  if (match.value) {
    const byValue = await select.selectOption({ value: match.value }).then(() => true).catch(() => false);
    if (byValue) return;
  }
  if (match.text) {
    const byLabel = await select.selectOption({ label: match.text }).then(() => true).catch(() => false);
    if (byLabel) return;
  }
  await select.evaluate(
    (node, option) => {
      const selectNode = node as HTMLSelectElement;
      const normalizedText = normalizeForPage(option.text);
      const normalizedValue = normalizeForPage(option.value);
      const selected = Array.from(selectNode.options).find((item) => {
        const text = normalizeForPage(item.textContent || "");
        const value = normalizeForPage(item.value || "");
        return (normalizedValue && value === normalizedValue) || (normalizedText && text === normalizedText) || (normalizedText && text.includes(normalizedText));
      });
      if (!selected) return;
      selectNode.value = selected.value;
      selectNode.dispatchEvent(new Event("input", { bubbles: true }));
      selectNode.dispatchEvent(new Event("change", { bubbles: true }));

      function normalizeForPage(value: string): string {
        return value
          .toLowerCase()
          .normalize("NFKD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }
    },
    { text: match.text, value: match.value }
  );
}

async function clickCustomOption(activePage: Page, match: SkpSiteOption): Promise<boolean> {
  const options = activePage.locator(SKP_OPTION_SELECTORS);
  const count = await options.count().catch(() => 0);
  const matchText = normalizeForComparison(match.text);
  const matchValue = normalizeForComparison(match.value);
  let fallbackIndex = -1;

  for (let index = 0; index < count; index += 1) {
    const option = options.nth(index);
    if (!(await option.isVisible().catch(() => false))) continue;
    const text = (await option.innerText().catch(() => "")).trim();
    const value = (await option.getAttribute("data-value").catch(() => null)) || (await option.getAttribute("value").catch(() => null)) || "";
    const normalizedText = normalizeForComparison(text);
    const normalizedValue = normalizeForComparison(value);
    if ((matchValue && normalizedValue === matchValue) || (matchText && normalizedText === matchText)) {
      await option.click({ timeout: 5000 });
      return true;
    }
    if (fallbackIndex < 0 && matchText && (normalizedText.includes(matchText) || matchText.includes(normalizedText))) {
      fallbackIndex = index;
    }
  }

  if (fallbackIndex >= 0) {
    await options.nth(fallbackIndex).click({ timeout: 5000 });
    return true;
  }
  return false;
}

async function resolveSkpOption(log: DailyLog): Promise<SkpOptionCandidate | null> {
  const mapping = getDb()
    .prepare("SELECT site_option_text, site_option_value, match_status FROM skp_site_mappings WHERE period_id = ? AND kode_skp = ?")
    .get(getActivePeriod().id, log.kode_skp) as { site_option_text?: string; site_option_value?: string; match_status: string } | undefined;
  if (mapping?.match_status && ["matched", "partial", "manual"].includes(mapping.match_status) && (mapping.site_option_text || mapping.site_option_value)) {
    return { text: mapping.site_option_text ?? null, value: mapping.site_option_value ?? null };
  }
  if (log.kode_skp) {
    const item = getDb().prepare("SELECT nama_skp FROM skp_items WHERE period_id = ? AND kode_skp = ?").get(getActivePeriod().id, log.kode_skp) as
      | { nama_skp: string }
      | undefined;
    if (item) return { text: item.nama_skp, value: null };
  }
  if (log.nama_skp) return { text: log.nama_skp, value: null };
  return null;
}

function persistSkpMapping(log: DailyLog, match: SkpSiteOption): void {
  if (!log.kode_skp || !match.text) return;
  updateSkpMapping({
    kode_skp: log.kode_skp,
    site_option_text: match.text,
    site_option_value: match.value ?? "",
    match_status: "matched"
  });
}

function isSelectableSkpOption(text: string): boolean {
  return Boolean(text.trim()) && !/^[-\s]*(pilih|select|--)/i.test(text.trim());
}

function normalizeForComparison(value?: string | null): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function isDebugSubmitMode(): boolean {
  return getSetting("debug_submit_mode", process.env.DEBUG_SUBMIT_MODE || "false") === "true";
}

function toIndonesianDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return year && month && day ? `${day}/${month}/${year}` : isoDate;
}

function toIndonesianDateWithDash(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return year && month && day ? `${day}-${month}-${year}` : isoDate;
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

async function captureErrorScreenshot(code: string): Promise<string | undefined> {
  if (!page || page.isClosed()) return undefined;
  const safeCode = code.replace(/[^a-z0-9-]/gi, "_");
  const dir = join(getDataDir(), "screenshots");
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}_${safeCode}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

export async function closeAutomation(): Promise<void> {
  await closeSkpContext();
  page = null;
}

export async function clearSessionData(): Promise<void> {
  await closeAutomation();
  rmSync(getSessionDir(), { recursive: true, force: true });
  rmSync(getAuthStatePath(), { force: true });
}

function buildErrorMessage(error: SkpAutomationError, screenshotPath?: string): string {
  return JSON.stringify({
    error_code: error.code,
    error_message: error.message,
    current_url: error.currentUrl ?? null,
    step: error.step ?? null,
    automation_step: error.step ?? null,
    validation_text: error.details.validation_text ?? null,
    available_skp_options: error.details.available_skp_options ?? null,
    screenshot_path: screenshotPath ?? null
  });
}

function logAutomationStep(kodeLog: string, step: string): void {
  const currentUrl = page && !page.isClosed() ? page.url() : null;
  console.info(
    JSON.stringify({
      using_active_context: Boolean(getActiveSkpContext()),
      current_url: currentUrl,
      automation_step: step,
      kode_log: kodeLog
    })
  );
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

class SkpAutomationError extends Error {
  constructor(
    public code: string,
    message: string,
    public currentUrl?: string,
    public step?: string,
    public details: { validation_text?: string; available_skp_options?: string[] } = {}
  ) {
    super(message);
  }
}
