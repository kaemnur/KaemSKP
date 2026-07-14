import { type Locator, type Page } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { getDataDir, updateSkpSessionStatus } from "../db/database";
import type { PeriodicFillItem, PeriodicItemResult, PeriodicQuarter, PeriodicRunResult, PeriodicStatus, PeriodicSubmitState } from "../types";
import { getActiveSkpContext, getActiveSkpPage, getBaseUrl, setSkpSessionStatusMemory } from "./skpSession";
import { checkSession } from "./skpAutomation";

// URL wajib per triwulan. Path selalu dipakai walau origin/domain di config berbeda.
const QUARTER_PATHS: Record<PeriodicQuarter, string> = {
  1: "/skp/pegawai/evalperiodik/tri_satu.jsp",
  2: "/skp/pegawai/evalperiodik/tri_dua.jsp",
  3: "/skp/pegawai/evalperiodik/tri_tiga.jsp",
  4: "/skp/pegawai/evalperiodik/tri_empat.jsp"
};

const PERIODIC_FEEDBACK_LINK = "https://drive.google.com/drive/folders/1ln6FSUk550YVlnToaoZ1EUalAVjuIBWB";

type PeriodicRunInput = {
  year: number;
  quarter: PeriodicQuarter;
  items: PeriodicFillItem[];
  submit?: boolean;
};

type SubmitInput = {
  year: number;
  quarter: PeriodicQuarter;
};

type FieldScope = Page | Locator;

type PeriodicErrorDetails = {
  baseUrl?: string;
  origin?: string;
  targetUrl?: string;
  expectedUrl?: string;
  currentUrl?: string;
  currentUrlBeforeClick?: string;
  currentUrlAfterClick?: string;
  usingActiveContext?: boolean;
  expectedPageTitle?: string;
  visiblePageTitle?: string;
  visibleHeading?: string;
  availableSidebarItems?: string[];
  availableButtons?: string[];
  visibleTextSample?: string;
  greenEditButtonCount?: number;
  currentSkpRow?: string;
  clickedMenuText?: string;
  screenshotPath?: string;
};

type PeriodicNavigationDebug = {
  currentUrlBeforeClick: string;
  currentUrlAfterClick: string;
  origin: string;
  targetUrl: string;
  sidebarTexts: string[];
  clickedMenuText: string;
  expectedQuarter: PeriodicQuarter;
  expectedHeading: string;
  visibleHeading: string;
  visiblePageTitle: string;
  visibleTextSample: string;
  greenEditButtonCount: number;
  screenshotPath?: string;
};

type PeriodicNavigationResult =
  | { ok: true; state: "navigation_success"; debug: PeriodicNavigationDebug }
  | { ok: false; state: "failed_navigation"; message: string; debug: PeriodicNavigationDebug };

type PeriodicModalFillDebug = {
  itemId: string;
  kode_skp: string;
  nama_skp: string;
  existingTextareaValue: string;
  existingLinkValue: string;
  shouldFill: boolean;
  realisasiText: string;
  textareaValue: string;
  linkValue: string;
  saveClicked: boolean;
  modalClosed: boolean;
  finalStatus: PeriodicItemResult["status"] | "pending";
  error?: string;
};

let periodicPage: Page | null = null;
let lastPeriodicNavigationDebug: PeriodicNavigationDebug | null = null;

const QUARTER_ROMANS: Record<PeriodicQuarter, string> = {
  1: "I",
  2: "II",
  3: "III",
  4: "IV"
};

export async function runPeriodicFill(input: PeriodicRunInput): Promise<PeriodicRunResult> {
  let step = "start";
  const items = input.items.filter((item) => item.shouldFill !== false);
  try {
    step = "check_session";
    await requireConnectedSession(step);

    const activePage = await getPeriodicPage();
    step = "open_periodic_page";
    await openPeriodicPageViaMenu(activePage, input.quarter);

    step = "select_period";
    await selectPeriod(activePage, input.year, input.quarter);
    await assertLoggedIn(activePage, step, buildQuarterUrl(input.quarter));

    // Step 3 — pastikan Hasil Kerja/Indikator tampil (klik "+ Semua" → "Check All" bila belum ada).
    step = "ensure_hasil_kerja";
    await assertLoggedIn(activePage, step, buildQuarterUrl(input.quarter));
    await ensureHasilKerjaTampil(activePage);
    await assertLoggedIn(activePage, step, buildQuarterUrl(input.quarter));

    const results: PeriodicItemResult[] = [];
    for (const item of items) {
      step = `fill_${item.kode_skp}`;
      await assertLoggedIn(activePage, step, buildQuarterUrl(input.quarter));
      results.push(await fillPeriodicItem(activePage, item));
    }

    const filledCount = results.filter((item) => item.status === "filled").length;
    const existingCount = results.filter((item) => item.status === "existing").length;
    const failedCount = results.filter((item) => item.status === "failed").length;
    const skippedCount = results.filter((item) => item.status === "skipped").length;
    // "berhasil" mencakup yang baru diisi maupun yang memang sudah ada isian di website.
    const successCount = filledCount + existingCount;

    let submitted = false;
    let submitStatus = "Belum diajukan";
    let submitState: PeriodicSubmitState = "not_requested";
    let availableButtons: string[] = [];
    if (input.submit) {
      step = "submit_periodic";
      const submitResult = await submitActivePeriodicPage(activePage);
      submitted = submitResult.ok;
      submitStatus = submitResult.message;
      submitState = submitResult.state;
      availableButtons = submitResult.availableButtons;
    } else {
      availableButtons = await collectAvailableButtons(activePage);
    }

    const status = resolveRunStatus({
      submit: Boolean(input.submit),
      submitted,
      submitState,
      totalItems: items.length,
      successCount,
      failedCount
    });
    const finalDiag = await collectPageDiagnostics(activePage).catch(() => undefined);
    const finalGreenEditButtonCount = Math.max(finalDiag?.greenEditButtonCount ?? 0, await countRealisasiEditButtons(activePage));

    return {
      ok: status !== "failed",
      year: input.year,
      quarter: input.quarter,
      status,
      mode: input.submit ? "fill_submit" : "fill",
      totalItems: items.length,
      successCount,
      failedCount,
      skippedCount,
      submitted,
      submitStatus,
      message: buildRunMessage({ filledCount, existingCount, skippedCount, failedCount, submitted, submitState }),
      currentUrl: activePage.url(),
      baseUrl: getActivePageOrigin(activePage),
      expectedUrl: buildQuarterUrlFromActivePage(activePage, input.quarter),
      step,
      submitState,
      expectedPageTitle: expectedQuarterPageTitle(input.quarter),
      visiblePageTitle: lastPeriodicNavigationDebug?.visiblePageTitle,
      visibleHeading: lastPeriodicNavigationDebug?.visibleHeading,
      visibleTextSample: finalDiag?.visibleTextSample ?? lastPeriodicNavigationDebug?.visibleTextSample,
      greenEditButtonCount: finalGreenEditButtonCount,
      availableSidebarItems: lastPeriodicNavigationDebug?.sidebarTexts,
      clickedMenuText: lastPeriodicNavigationDebug?.clickedMenuText,
      currentUrlBeforeClick: lastPeriodicNavigationDebug?.currentUrlBeforeClick,
      currentUrlAfterClick: lastPeriodicNavigationDebug?.currentUrlAfterClick,
      availableButtons,
      items: results
    };
  } catch (error) {
    const activePage = periodicPage && !periodicPage.isClosed() ? periodicPage : null;
    const automationError =
      error instanceof PeriodicAutomationError
        ? error
        : new PeriodicAutomationError("PERIODIC_UNKNOWN_ERROR", error instanceof Error ? error.message : String(error), activePage?.url(), step);
    const screenshotPath = await capturePeriodicScreenshot(`periodic-${input.year}-q${input.quarter}`).catch(() => undefined);
    const diag = activePage ? await collectPageDiagnostics(activePage).catch(() => undefined) : undefined;
    const sessionStop = isSessionStopError(automationError);
    const navigationStop = isNavigationStopError(automationError);
    return {
      ok: false,
      year: input.year,
      quarter: input.quarter,
      status: navigationStop ? "failed_navigation" : "failed",
      mode: input.submit ? "fill_submit" : "fill",
      totalItems: sessionStop || navigationStop ? 0 : items.length,
      successCount: 0,
      failedCount: sessionStop || navigationStop ? 0 : items.length,
      skippedCount: 0,
      submitted: false,
      submitStatus: "Gagal diajukan",
      message: tidyPeriodicMessage(automationError.message),
      screenshotPath: automationError.details.screenshotPath ?? screenshotPath,
      errorLast: tidyPeriodicMessage(automationError.message),
      currentUrl: automationError.currentUrl ?? automationError.details.currentUrlAfterClick ?? automationError.details.currentUrl,
      baseUrl: automationError.details.baseUrl ?? getPeriodicBaseUrl(),
      origin: automationError.details.origin ?? automationError.details.baseUrl ?? getPeriodicBaseUrl(),
      targetUrl: automationError.details.targetUrl ?? automationError.details.expectedUrl ?? buildQuarterUrl(input.quarter),
      expectedUrl: automationError.details.expectedUrl ?? buildQuarterUrl(input.quarter),
      step: automationError.step ?? step,
      expectedPageTitle: automationError.details.expectedPageTitle ?? expectedQuarterPageTitle(input.quarter),
      visiblePageTitle: automationError.details.visiblePageTitle ?? diag?.visiblePageTitle,
      visibleHeading: automationError.details.visibleHeading ?? diag?.visibleHeading,
      visibleTextSample: automationError.details.visibleTextSample ?? diag?.visibleTextSample,
      greenEditButtonCount: automationError.details.greenEditButtonCount ?? diag?.greenEditButtonCount,
      availableSidebarItems: automationError.details.availableSidebarItems ?? diag?.sidebarItems,
      availableButtons: automationError.details.availableButtons ?? diag?.buttons,
      clickedMenuText: automationError.details.clickedMenuText,
      currentUrlBeforeClick: automationError.details.currentUrlBeforeClick,
      currentUrlAfterClick: automationError.details.currentUrlAfterClick,
      items: []
    };
  }
}

export async function fillPeriodicQuarter(input: PeriodicRunInput): Promise<PeriodicRunResult> {
  return runPeriodicFill({ ...input, submit: false });
}

export async function submitPeriodicQuarter(input: SubmitInput): Promise<PeriodicRunResult> {
  let step = "start";
  try {
    step = "check_session";
    await requireConnectedSession(step);

    const activePage = await getPeriodicPage();
    step = "open_periodic_page";
    await openPeriodicPageViaMenu(activePage, input.quarter);
    step = "select_period";
    await selectPeriod(activePage, input.year, input.quarter);
    await assertLoggedIn(activePage, step, buildQuarterUrl(input.quarter));
    step = "submit_periodic";
    const submitResult = await submitActivePeriodicPage(activePage);
    const status = mapSubmitStateToStatus(submitResult.state, submitResult.ok);
    const finalDiag = await collectPageDiagnostics(activePage).catch(() => undefined);
    const finalGreenEditButtonCount = Math.max(finalDiag?.greenEditButtonCount ?? 0, await countRealisasiEditButtons(activePage));
    return {
      // Tombol Ajukan tidak ditemukan bukan kegagalan total — biarkan ok true agar tidak dianggap gagal.
      ok: status !== "failed",
      year: input.year,
      quarter: input.quarter,
      status,
      mode: "fill_submit",
      totalItems: 0,
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
      submitted: submitResult.ok,
      submitStatus: submitResult.message,
      message: submitResult.message,
      currentUrl: activePage.url(),
      baseUrl: getActivePageOrigin(activePage),
      origin: lastPeriodicNavigationDebug?.origin ?? getActivePageOrigin(activePage),
      targetUrl: lastPeriodicNavigationDebug?.targetUrl ?? buildQuarterUrlFromActivePage(activePage, input.quarter),
      expectedUrl: buildQuarterUrlFromActivePage(activePage, input.quarter),
      step,
      submitState: submitResult.state,
      expectedPageTitle: expectedQuarterPageTitle(input.quarter),
      visiblePageTitle: lastPeriodicNavigationDebug?.visiblePageTitle,
      visibleHeading: lastPeriodicNavigationDebug?.visibleHeading,
      visibleTextSample: finalDiag?.visibleTextSample ?? lastPeriodicNavigationDebug?.visibleTextSample,
      greenEditButtonCount: finalGreenEditButtonCount,
      availableSidebarItems: lastPeriodicNavigationDebug?.sidebarTexts,
      clickedMenuText: lastPeriodicNavigationDebug?.clickedMenuText,
      currentUrlBeforeClick: lastPeriodicNavigationDebug?.currentUrlBeforeClick,
      currentUrlAfterClick: lastPeriodicNavigationDebug?.currentUrlAfterClick,
      availableButtons: submitResult.availableButtons,
      items: []
    };
  } catch (error) {
    const activePage = periodicPage && !periodicPage.isClosed() ? periodicPage : null;
    const automationError =
      error instanceof PeriodicAutomationError
        ? error
        : new PeriodicAutomationError("PERIODIC_SUBMIT_FAILED", error instanceof Error ? error.message : String(error), activePage?.url(), step);
    const screenshotPath = await capturePeriodicScreenshot(`periodic-submit-${input.year}-q${input.quarter}`).catch(() => undefined);
    const diag = activePage ? await collectPageDiagnostics(activePage).catch(() => undefined) : undefined;
    const navigationStop = isNavigationStopError(automationError);
    return {
      ok: false,
      year: input.year,
      quarter: input.quarter,
      status: navigationStop ? "failed_navigation" : "failed",
      mode: "fill_submit",
      totalItems: 0,
      successCount: 0,
      failedCount: navigationStop ? 0 : 1,
      skippedCount: 0,
      submitted: false,
      submitStatus: "Gagal diajukan",
      message: tidyPeriodicMessage(automationError.message),
      screenshotPath: automationError.details.screenshotPath ?? screenshotPath,
      errorLast: tidyPeriodicMessage(automationError.message),
      currentUrl: automationError.currentUrl ?? automationError.details.currentUrlAfterClick ?? automationError.details.currentUrl,
      baseUrl: automationError.details.baseUrl ?? getPeriodicBaseUrl(),
      origin: automationError.details.origin ?? automationError.details.baseUrl ?? getPeriodicBaseUrl(),
      targetUrl: automationError.details.targetUrl ?? automationError.details.expectedUrl ?? buildQuarterUrl(input.quarter),
      expectedUrl: automationError.details.expectedUrl ?? buildQuarterUrl(input.quarter),
      step: automationError.step ?? step,
      expectedPageTitle: automationError.details.expectedPageTitle ?? expectedQuarterPageTitle(input.quarter),
      visiblePageTitle: automationError.details.visiblePageTitle ?? diag?.visiblePageTitle,
      visibleHeading: automationError.details.visibleHeading ?? diag?.visibleHeading,
      visibleTextSample: automationError.details.visibleTextSample ?? diag?.visibleTextSample,
      availableSidebarItems: automationError.details.availableSidebarItems ?? diag?.sidebarItems,
      availableButtons: automationError.details.availableButtons ?? diag?.buttons,
      clickedMenuText: automationError.details.clickedMenuText,
      currentUrlBeforeClick: automationError.details.currentUrlBeforeClick,
      currentUrlAfterClick: automationError.details.currentUrlAfterClick,
      items: []
    };
  }
}

export async function verifyPeriodicStatus(input: SubmitInput): Promise<{ ok: true; statusText: string; currentUrl: string }> {
  await requireConnectedSession("check_session");
  const activePage = await getPeriodicPage();
  await openPeriodicPageViaMenu(activePage, input.quarter);
  await selectPeriod(activePage, input.year, input.quarter);
  const statusText = await activePage
    .locator("body")
    .innerText({ timeout: 5000 })
    .then((text) => text.split(/\n+/).filter((line) => /periodik|triwulan|status|diajukan|realisasi/i.test(line)).slice(0, 12).join("\n"))
    .catch(() => "");
  return { ok: true, statusText, currentUrl: activePage.url() };
}

async function requireConnectedSession(step: string): Promise<void> {
  const activeContext = getActiveSkpContext();
  logContextUse("periodic_check_session", Boolean(activeContext), getActiveSkpPage()?.url());
  if (!activeContext) {
    updateSkpSessionStatus("not_logged_in", "Perlu login SKP.");
    setSkpSessionStatusMemory("not_logged_in");
    throw new PeriodicAutomationError("LOGIN_REQUIRED", "Perlu login SKP.", undefined, step, buildPeriodicDetails());
  }

  const status = await checkSession();
  logContextUse(`periodic_check_session_${status}`, Boolean(getActiveSkpContext()), getActiveSkpPage()?.url());
  if (status !== "connected") {
    const currentUrl = getActiveSkpPage()?.url();
    const code = status === "not_logged_in" ? "LOGIN_REQUIRED" : "SESSION_EXPIRED";
    const message = status === "not_logged_in" ? "Perlu login SKP." : "Perlu login SKP. Session SKP sudah kedaluwarsa.";
    throw new PeriodicAutomationError(code, message, currentUrl, step, buildPeriodicDetails(undefined, getActiveSkpPage() ?? undefined));
  }
}

async function getPeriodicPage(): Promise<Page> {
  const context = getActiveSkpContext();
  logContextUse("get_periodic_page", Boolean(context), getActiveSkpPage()?.url());
  if (!context) {
    updateSkpSessionStatus("not_logged_in", "Perlu login SKP.");
    setSkpSessionStatusMemory("not_logged_in");
    throw new PeriodicAutomationError("LOGIN_REQUIRED", "Perlu login SKP.", undefined, "get_periodic_page", buildPeriodicDetails());
  }
  const activePage = getActiveSkpPage();
  if (!activePage || activePage.isClosed() || activePage.context() !== context) {
    updateSkpSessionStatus("not_logged_in", "Perlu login SKP.");
    setSkpSessionStatusMemory("not_logged_in");
    throw new PeriodicAutomationError("LOGIN_REQUIRED", "Perlu login SKP.", undefined, "get_periodic_page", buildPeriodicDetails());
  }
  periodicPage = activePage;
  return periodicPage;
}

export function getPeriodicBaseUrl(): string {
  return getBaseUrl().replace(/\/+$/, "");
}

// Bangun URL triwulan dari active SKP base URL + path wajib.
export function buildQuarterUrl(quarter: PeriodicQuarter): string {
  const path = QUARTER_PATHS[quarter];
  return `${getPeriodicBaseUrl()}${path}`;
}

function buildQuarterUrlFromActivePage(activePage: Page, quarter: PeriodicQuarter): string {
  return `${getActivePageOrigin(activePage)}${QUARTER_PATHS[quarter]}`;
}

function getActivePageOrigin(activePage: Page): string {
  try {
    const parsed = new URL(activePage.url());
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.origin;
  } catch {
    // Fall through to configured base URL when the active tab has no HTTP origin yet.
  }
  return getPeriodicBaseUrl();
}

async function openPeriodicPage(activePage: Page, quarter: PeriodicQuarter): Promise<void> {
  const navigation = await navigateToSkpPeriodicQuarter(activePage, quarter);

  // Buka langsung URL triwulan sesuai mapping — jangan navigasi generik yang bisa salah periode.
  logContextUse("open_periodic_page", activePage.context() === getActiveSkpContext(), activePage.url());
  lastPeriodicNavigationDebug = navigation.debug;

  if (!navigation.ok) {
    throw buildFailedNavigationError(activePage, quarter, navigation.debug.targetUrl, navigation);
  }
}

async function openPeriodicPageViaMenu(activePage: Page, quarter: PeriodicQuarter): Promise<void> {
  const fallbackUrl = buildQuarterUrlFromActivePage(activePage, quarter);
  logContextUse("open_periodic_page", activePage.context() === getActiveSkpContext(), activePage.url());
  const navigation = await navigateToSkpPeriodicQuarter(activePage, quarter);
  lastPeriodicNavigationDebug = navigation.debug;
  if (!navigation.ok) {
    throw buildFailedNavigationError(activePage, quarter, fallbackUrl, navigation);
  }
  await assertQuarterPage(activePage, quarter, "open_periodic_page", fallbackUrl);
}

export async function navigateToSkpPeriodicQuarter(activePage: Page, quarter: PeriodicQuarter): Promise<PeriodicNavigationResult> {
  periodicPage = activePage;
  const currentUrlBeforeClick = activePage.url();
  const origin = new URL(currentUrlBeforeClick).origin;
  const targetUrl = `${origin}${QUARTER_PATHS[quarter]}`;
  const expectedHeading = expectedQuarterPageTitle(quarter);
  let sidebarTexts = await collectSidebarTexts(activePage);
  let clickedMenuText = "direct goto";
  let currentUrlAfterClick = currentUrlBeforeClick;
  let visibleHeading = "";
  let visiblePageTitle = "";
  let visibleTextSample = "";
  let greenEditButtonCount = 0;

  const finishDebug = async (code: string): Promise<PeriodicNavigationDebug> => {
    currentUrlAfterClick = activePage.url();
    const diag = await collectPageDiagnostics(activePage).catch(() => undefined);
    sidebarTexts = diag?.sidebarItems.length ? diag.sidebarItems : await collectSidebarTexts(activePage).catch(() => sidebarTexts);
    visibleHeading = diag?.visibleHeading ?? "";
    visiblePageTitle = diag?.visiblePageTitle ?? "";
    visibleTextSample = diag?.visibleTextSample ?? "";
    greenEditButtonCount = diag?.greenEditButtonCount ?? (await countRealisasiEditButtons(activePage).catch(() => 0));
    const screenshotPath = await capturePeriodicScreenshot(code).catch(() => undefined);
    return {
      currentUrlBeforeClick,
      currentUrlAfterClick,
      origin,
      targetUrl,
      sidebarTexts,
      clickedMenuText,
      expectedQuarter: quarter,
      expectedHeading,
      visibleHeading,
      visiblePageTitle,
      visibleTextSample,
      greenEditButtonCount,
      screenshotPath
    };
  };

  const fail = async (message: string, code = `failed-navigation-q${quarter}`): Promise<PeriodicNavigationResult> => ({
    ok: false,
    state: "failed_navigation",
    message,
    debug: await finishDebug(code)
  });

  await dismissBrowserPopups(activePage);
  await activePage.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await activePage.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await waitForPeriodicPageRender(activePage);
  await dismissBrowserPopups(activePage);

  if (isSkpTahunanUrl(activePage.url())) {
    return fail("Salah halaman: masuk SKP Tahunan/Rencana SKP, bukan SKP Periodik.", `wrong-tahunan-page-q${quarter}`);
  }

  if (isLoginJspUrl(activePage.url())) {
    updateSkpSessionStatus("expired", "Session SKP tidak aktif. Silakan login ulang.");
    setSkpSessionStatusMemory("expired");
    return fail("Session SKP tidak aktif. Silakan login ulang.", `login-page-q${quarter}`);
  }

  const currentUrl = activePage.url().toLowerCase();
  if (!currentUrl.includes(QUARTER_PATHS[quarter].toLowerCase())) {
    return fail(`Halaman SKP Periodik tidak sesuai dengan triwulan yang dipilih. Expected URL: ${targetUrl}.`, `quarter-url-mismatch-q${quarter}`);
  }

  const validation = await validateQuarterPage(activePage, quarter);
  if (!validation.ok) {
    return fail(`Halaman SKP Periodik tidak sesuai dengan triwulan yang dipilih. Expected title: ${expectedHeading}.`, `quarter-page-mismatch-q${quarter}`);
  }

  return { ok: true, state: "navigation_success", debug: await finishDebug(`periodic-navigation-q${quarter}`) };
}

async function clickPeriodicMenuQuarter(activePage: Page, quarter: PeriodicQuarter, fallbackUrl: string): Promise<void> {
  await clickBerandaIfSidebarMissing(activePage, fallbackUrl);

  const periodikMenu = await findSkpPeriodikMenu(activePage);
  if (!periodikMenu) {
    throw await buildPeriodicMenuError(activePage, quarter, fallbackUrl, "Menu SKP Periodik tidak ditemukan.");
  }

  const clickedMenuText = await safeLocatorText(periodikMenu);
  let quarterLink = await findVisibleQuarterMenuItem(activePage, quarter, periodikMenu);
  if (!quarterLink) {
    await periodikMenu.scrollIntoViewIfNeeded().catch(() => undefined);
    const expanded = await periodikMenu.click({ timeout: 5000 }).then(() => true).catch(() => false);
    if (!expanded) {
      throw await buildPeriodicMenuError(activePage, quarter, fallbackUrl, "Menu SKP Periodik tidak bisa diklik.", clickedMenuText);
    }
    await activePage.waitForTimeout(700).catch(() => undefined);
    quarterLink = await waitForVisibleQuarterMenuItem(activePage, quarter, periodikMenu, 5000);
  }

  if (!quarterLink) {
    throw await buildPeriodicMenuError(activePage, quarter, fallbackUrl, "Submenu Triwulan pada SKP Periodik tidak ditemukan.", clickedMenuText);
  }

  const quarterMenuText = await safeLocatorText(quarterLink);
  const clicked = await clickQuarterLink(activePage, quarterLink);
  if (!clicked) {
    throw await buildPeriodicMenuError(activePage, quarter, fallbackUrl, "Submenu Triwulan pada SKP Periodik tidak bisa diklik.", quarterMenuText || clickedMenuText);
  }

  if (await detectLoginPage(activePage)) {
    throw buildPeriodicSessionError(activePage, "open_periodic_page", fallbackUrl);
  }

  await assertNotSkpTahunanPage(activePage, quarter, "open_periodic_page", fallbackUrl, quarterMenuText || clickedMenuText);
  if (!(await matchesQuarterPage(activePage, quarter))) {
    throw await buildPeriodicMenuError(
      activePage,
      quarter,
      fallbackUrl,
      `Halaman SKP Periodik tidak sesuai dengan triwulan yang dipilih. Expected title: ${expectedQuarterPageTitle(quarter)}.`,
      quarterMenuText || clickedMenuText
    );
  }
}

async function selectPeriod(activePage: Page, year: number, quarter: PeriodicQuarter): Promise<void> {
  // Triwulan sudah dipilih dari dropdown SKP Periodik. Di sini cukup set tahun bila ada field-nya.
  await fillYear(activePage, year);
  await activePage.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await activePage.waitForTimeout(300).catch(() => undefined);

  await assertQuarterPage(activePage, quarter, "select_period", buildQuarterUrlFromActivePage(activePage, quarter));
}

async function clickBerandaIfSidebarMissing(activePage: Page, expectedUrl: string): Promise<void> {
  if (await hasSkpPeriodikMenu(activePage)) return;
  const beranda = await findActionButton(activePage.locator("body"), [/^beranda$/i, /^home$/i, /^dashboard$/i]);
  if (!beranda) return;
  await beranda.scrollIntoViewIfNeeded().catch(() => undefined);
  await beranda.click({ timeout: 5000 }).catch(() => undefined);
  await activePage.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
  await activePage.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await activePage.waitForTimeout(500).catch(() => undefined);
  await dismissBrowserPopups(activePage);
  await assertLoggedIn(activePage, "open_beranda_periodic", expectedUrl);
}

async function hasSkpPeriodikMenu(activePage: Page): Promise<boolean> {
  return Boolean(await findSkpPeriodikMenu(activePage));
}

async function findSkpPeriodikMenu(activePage: Page): Promise<Locator | null> {
  const scopes = await sidebarSearchScopes(activePage);
  for (const scope of scopes) {
    const candidates = scope
      .locator("a, button, [role='button'], [data-toggle='collapse'], [data-bs-toggle='collapse'], [href], [onclick]")
      .filter({ hasText: /SKP\s*Periodik/i });
    const total = await candidates.count().catch(() => 0);
    for (let index = 0; index < Math.min(total, 30); index += 1) {
      const candidate = candidates.nth(index);
      if (!(await candidate.isVisible({ timeout: 300 }).catch(() => false))) continue;
      const text = await candidate.innerText({ timeout: 300 }).catch(() => "");
      if (!hasExactVisibleLine(text, "SKP Periodik")) continue;
      if (isForbiddenSkpMenuText(text)) continue;
      return candidate;
    }
  }
  return null;
}

async function findVisibleQuarterMenuItem(activePage: Page, quarter: PeriodicQuarter, periodikMenu: Locator): Promise<Locator | null> {
  const pattern = new RegExp(`Triwulan\\s*(?:${quarter}|${QUARTER_ROMANS[quarter]})\\b`, "i");
  const scopes = await periodikSubmenuSearchScopes(periodikMenu);
  for (const scope of scopes) {
    const candidates = scope.locator("a, button, [role='menuitem'], [role='button'], [onclick], [href]").filter({ hasText: pattern });
    const total = await candidates.count().catch(() => 0);
    for (let index = 0; index < Math.min(total, 40); index += 1) {
      const candidate = candidates.nth(index);
      if (!(await candidate.isVisible({ timeout: 300 }).catch(() => false))) continue;
      const text = await candidate.innerText({ timeout: 300 }).catch(() => "");
      if (!pattern.test(text)) continue;
      if (isForbiddenSkpMenuText(text)) continue;
      if (hasExactVisibleLine(text, "SKP Periodik")) continue;
      return candidate;
    }
  }
  return null;
}

async function waitForVisibleQuarterMenuItem(activePage: Page, quarter: PeriodicQuarter, periodikMenu: Locator, timeout: number): Promise<Locator | null> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const item = await findVisibleQuarterMenuItem(activePage, quarter, periodikMenu);
    if (item) return item;
    await activePage.waitForTimeout(250).catch(() => undefined);
  }
  return null;
}

async function periodikSubmenuSearchScopes(periodikMenu: Locator): Promise<Locator[]> {
  return [
    periodikMenu.locator("xpath=ancestor::li[1]"),
    periodikMenu.locator("xpath=ancestor::li[1]/ul[1]"),
    periodikMenu.locator("xpath=ancestor::li[1]//*[contains(concat(' ', normalize-space(@class), ' '), ' treeview-menu ')][1]"),
    periodikMenu.locator("xpath=ancestor::li[1]//*[contains(concat(' ', normalize-space(@class), ' '), ' collapse ')][1]"),
    periodikMenu.locator("xpath=ancestor::li[1]/following-sibling::*[self::ul or contains(concat(' ', normalize-space(@class), ' '), ' treeview-menu ') or contains(concat(' ', normalize-space(@class), ' '), ' collapse ')][1]"),
    periodikMenu.locator("xpath=../following-sibling::*[self::ul or contains(concat(' ', normalize-space(@class), ' '), ' treeview-menu ') or contains(concat(' ', normalize-space(@class), ' '), ' collapse ')][1]"),
    periodikMenu.locator("xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' treeview ')][1]"),
    periodikMenu.locator("xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' nav-item ')][1]"),
    periodikMenu.locator("xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' menu-item ')][1]")
  ];
}

function normalizeQuarterMenuText(value: string, quarter: PeriodicQuarter): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (/Triwulan/i.test(text)) return text;
  return `Triwulan ${quarter}`;
}

async function safeLocatorText(locator: Locator): Promise<string> {
  return (await locator.innerText({ timeout: 500 }).catch(() => "")).replace(/\s+/g, " ").trim();
}

function hasExactVisibleLine(value: string, expected: string): boolean {
  const expectedNormalized = normalizeText(expected);
  return value
    .split(/\r?\n/)
    .map((line) => normalizeText(line))
    .some((line) => line === expectedNormalized);
}

function isForbiddenSkpMenuText(value: string): boolean {
  return /\b(SKP\s*Tahunan|Rencana\s*SKP|Evaluasi\s*SKP|Arsip\s*SKP|Log\s*Harian)\b/i.test(value);
}

async function sidebarSearchScopes(activePage: Page): Promise<Locator[]> {
  const sidebarSelector = [
    "aside",
    "nav",
    "#sidebar",
    ".sidebar",
    ".main-sidebar",
    ".left-side",
    ".side-menu",
    ".sidebar-menu",
    ".main-menu",
    ".navbar-nav"
  ].join(", ");
  const scopes: Locator[] = [];
  const sidebars = activePage.locator(sidebarSelector);
  const total = await sidebars.count().catch(() => 0);
  for (let index = 0; index < Math.min(total, 12); index += 1) {
    const sidebar = sidebars.nth(index);
    if (!(await sidebar.isVisible({ timeout: 200 }).catch(() => false))) continue;
    const text = await sidebar.innerText({ timeout: 300 }).catch(() => "");
    if (/SKP|Triwulan|Beranda|Log\s*Harian/i.test(text)) scopes.push(sidebar);
  }
  scopes.push(activePage.locator("body"));
  return scopes;
}

async function clickQuarterLink(activePage: Page, quarterLink: Locator): Promise<boolean> {
  await quarterLink.scrollIntoViewIfNeeded().catch(() => undefined);
  const clicked = await quarterLink.click({ timeout: 5000 }).then(() => true).catch(() => false);
  await activePage.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => undefined);
  await activePage.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await activePage.waitForTimeout(700).catch(() => undefined);
  await dismissBrowserPopups(activePage);
  return clicked;
}

async function assertNotSkpTahunanPage(activePage: Page, quarter: PeriodicQuarter, step: string, expectedUrl: string, clickedMenuText?: string): Promise<void> {
  if (!isSkpTahunanUrl(activePage.url())) return;
  const diag = await collectPageDiagnostics(activePage);
  throw new PeriodicAutomationError(
    "PERIODIC_WRONG_TAHUNAN_PAGE",
    "Salah halaman: fitur SKP Periodik masuk ke SKP Tahunan/Rencana SKP.",
    activePage.url(),
    step,
    buildPeriodicDetails(expectedUrl, activePage, {
      expectedPageTitle: expectedQuarterPageTitle(quarter),
      visiblePageTitle: diag.visiblePageTitle,
      visibleHeading: diag.visibleHeading,
      availableSidebarItems: diag.sidebarItems,
      availableButtons: diag.buttons,
      visibleTextSample: diag.visibleTextSample,
      clickedMenuText
    })
  );
}

async function assertQuarterPage(activePage: Page, quarter: PeriodicQuarter, step: string, expectedUrl: string): Promise<void> {
  if (await detectLoginPage(activePage)) {
    throw buildPeriodicSessionError(activePage, step, expectedUrl);
  }
  await assertNotSkpTahunanPage(activePage, quarter, step, expectedUrl);
  const validation = await validateQuarterPage(activePage, quarter);
  if (validation.ok) {
    updateSkpSessionStatus("connected", "Terhubung ke SKP");
    setSkpSessionStatusMemory("connected");
    if (lastPeriodicNavigationDebug) {
      lastPeriodicNavigationDebug.visibleHeading = validation.visibleHeading;
      lastPeriodicNavigationDebug.visiblePageTitle = validation.visiblePageTitle;
      lastPeriodicNavigationDebug.visibleTextSample = validation.visibleTextSample;
      lastPeriodicNavigationDebug.greenEditButtonCount = validation.greenEditButtonCount;
    }
    return;
  }

  const diag = await collectPageDiagnostics(activePage);
  throw new PeriodicAutomationError(
    "PERIODIC_PAGE_TITLE_MISMATCH",
    `Halaman SKP Periodik tidak sesuai dengan triwulan yang dipilih. Expected title: ${expectedQuarterPageTitle(quarter)}. Visible title: ${diag.visiblePageTitle || "-"}. URL aktual: ${activePage.url()}.`,
    activePage.url(),
    step,
    buildPeriodicDetails(expectedUrl, activePage, {
      expectedPageTitle: expectedQuarterPageTitle(quarter),
      visiblePageTitle: diag.visiblePageTitle,
      visibleHeading: diag.visibleHeading,
      availableSidebarItems: diag.sidebarItems,
      availableButtons: diag.buttons,
      visibleTextSample: diag.visibleTextSample,
      greenEditButtonCount: diag.greenEditButtonCount
    })
  );
}

async function matchesQuarterPage(activePage: Page, quarter: PeriodicQuarter): Promise<boolean> {
  return (await validateQuarterPage(activePage, quarter)).ok;
}

type QuarterPageValidation = {
  ok: boolean;
  visibleHeading: string;
  visiblePageTitle: string;
  visibleTextSample: string;
  greenEditButtonCount: number;
};

async function validateQuarterPage(activePage: Page, quarter: PeriodicQuarter): Promise<QuarterPageValidation> {
  const empty = { ok: false, visibleHeading: "", visiblePageTitle: "", visibleTextSample: "", greenEditButtonCount: 0 };
  if (await detectLoginPage(activePage)) return empty;
  if (isSkpTahunanUrl(activePage.url())) return empty;
  const currentUrl = activePage.url().toLowerCase();
  if (!currentUrl.includes(QUARTER_PATHS[quarter].toLowerCase())) return empty;
  if (currentUrl.includes("skpkualitatif") || currentUrl.includes("login.jsp")) return empty;

  const diag = await collectPageDiagnostics(activePage);
  const text = normalizeText(`${diag.visibleHeading} ${diag.visiblePageTitle} ${diag.visibleTextSample} ${diag.fullTextSample} ${diag.buttons.join(" ")}`);
  const roman = QUARTER_ROMANS[quarter].toLowerCase();
  const hasExpectedTitle =
    new RegExp(`evaluasi\\s+triwulan\\s+${quarter}\\b`, "i").test(text) ||
    new RegExp(`evaluasi\\s+triwulan\\s+${roman}\\b`, "i").test(text) ||
    new RegExp(`evaluasi.*triwulan\\s+${quarter}\\b`, "i").test(text) ||
    new RegExp(`evaluasi.*triwulan\\s+${roman}\\b`, "i").test(text);
  const hasCorePeriodicText = ["hasil kerja", "realisasi", "umpan balik"].every((part) => text.includes(part));
  const hasPeriodicActionText = /ajukan\s+realisasi/.test(text) && (/\bsemua\b/.test(text) || /hapus/.test(text));
  const ok = hasExpectedTitle || hasCorePeriodicText || hasPeriodicActionText;
  return {
    ok,
    visibleHeading: ok ? expectedQuarterPageTitle(quarter) : diag.visibleHeading,
    visiblePageTitle: diag.visiblePageTitle,
    visibleTextSample: diag.visibleTextSample,
    greenEditButtonCount: diag.greenEditButtonCount
  };
}

async function waitForPeriodicPageRender(activePage: Page): Promise<void> {
  await activePage.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
  await activePage.locator("body").waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
  const patterns = [/Evaluasi\s+Triwulan\s+2/i, /Evaluasi\s+Triwulan/i, /HASIL\s+KERJA/i, /Realisasi/i, /Umpan\s+Balik/i];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const text = await readPageText(activePage, 4000).catch(() => "");
    if (patterns.some((pattern) => pattern.test(text))) return;
    await activePage.waitForTimeout(500).catch(() => undefined);
  }
}

async function readPageText(activePage: Page, limit = 2000): Promise<string> {
  return activePage
    .evaluate((maxLength) => {
      const body = document.body?.innerText || document.body?.textContent || "";
      const documentText = document.documentElement?.innerText || document.documentElement?.textContent || "";
      const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4"))
        .map((node) => node.textContent || "")
        .join(" ");
      const relevant = Array.from(document.querySelectorAll("body *"))
        .map((node) => node.textContent || "")
        .filter((text) => /Evaluasi|Triwulan|HASIL\s*KERJA|Realisasi|Umpan\s*Balik/i.test(text))
        .join(" ");
      return [body, documentText, headings, relevant]
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLength);
    }, limit)
    .catch(() => "");
}

function expectedQuarterPageTitle(quarter: PeriodicQuarter): string {
  return `Evaluasi Triwulan ${quarter}`;
}

async function buildPeriodicMenuError(activePage: Page, quarter: PeriodicQuarter, expectedUrl: string, message: string, clickedMenuText?: string): Promise<PeriodicAutomationError> {
  const diag = await collectPageDiagnostics(activePage);
  return new PeriodicAutomationError(
    "PERIODIC_SUBMENU_NOT_FOUND",
    message,
    activePage.url(),
    "open_periodic_page",
    buildPeriodicDetails(expectedUrl, activePage, {
      expectedPageTitle: expectedQuarterPageTitle(quarter),
      visiblePageTitle: diag.visiblePageTitle,
      visibleHeading: diag.visibleHeading,
      availableSidebarItems: diag.sidebarItems,
      availableButtons: diag.buttons,
      visibleTextSample: diag.visibleTextSample,
      clickedMenuText
    })
  );
}

function buildFailedNavigationError(
  activePage: Page,
  quarter: PeriodicQuarter,
  expectedUrl: string,
  navigation: Extract<PeriodicNavigationResult, { ok: false }>
): PeriodicAutomationError {
  return new PeriodicAutomationError(
    "PERIODIC_FAILED_NAVIGATION",
    navigation.message,
    navigation.debug.currentUrlAfterClick,
    "open_periodic_page",
    buildPeriodicDetails(expectedUrl, activePage, {
      currentUrlBeforeClick: navigation.debug.currentUrlBeforeClick,
      currentUrlAfterClick: navigation.debug.currentUrlAfterClick,
      origin: navigation.debug.origin,
      targetUrl: navigation.debug.targetUrl,
      expectedPageTitle: navigation.debug.expectedHeading,
      visiblePageTitle: navigation.debug.visibleHeading,
      visibleHeading: navigation.debug.visibleHeading,
      visibleTextSample: navigation.debug.visibleTextSample,
      greenEditButtonCount: navigation.debug.greenEditButtonCount,
      availableSidebarItems: navigation.debug.sidebarTexts,
      clickedMenuText: navigation.debug.clickedMenuText,
      screenshotPath: navigation.debug.screenshotPath
    })
  );
}

// Alias kolom realisasi & link/tautan dibuat luas agar selector fleksibel di berbagai layout modal.
const REALIZATION_ALIASES = ["realisasi", "realisasi kerja", "realisasi skp", "realisasi periodik", "capaian", "capaian kinerja", "uraian realisasi"];
const FEEDBACK_ALIASES = ["link / tautan", "link tautan", "tautan", "link", "umpan balik", "umpanbalik", "feedback", "link umpan", "tautan umpan", "eviden", "bukti dukung", "bukti", "link bukti"];

// Pola tombol/heading sesuai flow website SKP Periodik.
const ADD_ALL_PATTERNS = [/\+\s*semua/i, /tambah\s+semua/i, /^\s*semua\s*$/i, /tambah\s+hasil\s+kerja/i];
const CHECK_ALL_PATTERNS = [/check\s*all/i, /pilih\s+semua/i, /centang\s+semua/i, /select\s*all/i, /tandai\s+semua/i, /^\s*semua\s*$/i];
const ADD_CONFIRM_PATTERNS = [/tambah/i, /simpan/i, /^\s*ok\s*$/i, /^\s*pilih\s*$/i, /lanjut/i];
const EDIT_REALISASI_PATTERNS = [/isi\s*realisasi/i];
const REALISASI_MODAL_HEADING = /isi\s+realisasi\s+periodik/i;
const ADD_MODAL_HEADING = /tambah\s+hasil\s+kerja|tambah.*indikator/i;

// Step 3 — Pastikan Hasil Kerja/Indikator sudah tampil. Jika belum, klik "+ Semua" lalu "Check All".
// Best-effort: tidak melempar error agar kegagalan tetap dilaporkan per-item, bukan menggagalkan semua.
async function ensureHasilKerjaTampil(activePage: Page): Promise<{ added: boolean; itemCount: number }> {
  // Sudah ada item + tombol edit hijau → langsung ke pengisian realisasi.
  const existingCount = await countRealisasiEditButtons(activePage);
  if (existingCount > 0) return { added: false, itemCount: existingCount };

  const pageText = normalizeText(await readPageText(activePage, 3000));
  const hasilKerjaVisible = ["hasil kerja", "realisasi", "umpan balik"].every((part) => pageText.includes(part));
  if (hasilKerjaVisible) return { added: false, itemCount: 0 };

  // Belum ada item — coba tambahkan lewat "+ Semua".
  const addAllButton = await findActionButton(activePage.locator("body"), ADD_ALL_PATTERNS);
  if (!addAllButton) return { added: false, itemCount: 0 };

  await addAllButton.scrollIntoViewIfNeeded().catch(() => undefined);
  await addAllButton.click({ timeout: 5000 }).catch(() => undefined);

  // Tunggu modal "Tambah Hasil Kerja / Indikator".
  const modal = (await waitForModal(activePage, ADD_MODAL_HEADING, 8000)) ?? activePage.locator("body");
  await activePage.waitForTimeout(400).catch(() => undefined);

  // Klik "Check All" / centang semua checkbox pada modal.
  await clickCheckAll(activePage, modal);

  // Klik tombol tambah/simpan di modal, lalu tunggu modal tertutup + item muncul.
  const confirmAdd = await findActionButton(modal, ADD_CONFIRM_PATTERNS);
  if (confirmAdd) await confirmAdd.click({ timeout: 5000 }).catch(() => undefined);
  await activePage.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await activePage.waitForTimeout(800).catch(() => undefined);

  const itemCount = await countRealisasiEditButtons(activePage);
  return { added: itemCount > 0, itemCount };
}

// Step 4 — Isi realisasi lewat modal. Kolom Realisasi HANYA dicari di modal setelah tombol edit hijau diklik.
async function fillPeriodicItem(activePage: Page, item: PeriodicFillItem): Promise<PeriodicItemResult> {
  const step = `fill_${item.kode_skp}`;
  const debug: PeriodicModalFillDebug = {
    itemId: item.kode_skp,
    kode_skp: item.kode_skp,
    nama_skp: item.nama_skp,
    existingTextareaValue: "",
    existingLinkValue: "",
    shouldFill: false,
    realisasiText: "",
    textareaValue: "",
    linkValue: "",
    saveClicked: false,
    modalClosed: false,
    finalStatus: "pending"
  };
  try {
    const container = await findItemContainer(activePage, item);

    // Klik tombol edit hijau "Isi Realisasi" — jangan cari kolom Realisasi sebelum ini.
    const editButton =
      (await findEditRealisasiButton(container)) ?? (await findEditRealisasiButton(activePage.locator("body")));
    if (!editButton) {
      return itemFailure(
        activePage,
        item,
        step,
        "Tombol edit hijau “Isi Realisasi” tidak ditemukan untuk SKP ini. Pastikan Hasil Kerja/Indikator sudah muncul di halaman triwulan (coba mode Isi ulang agar + Semua dijalankan)."
      );
    }
    await editButton.scrollIntoViewIfNeeded().catch(() => undefined);
    await editButton.click({ timeout: 5000 }).catch(() => undefined);

    // Tunggu modal "Isi Realisasi Periodik".
    const modal = await waitForRealisasiModal(activePage);
    if (!modal) {
      return itemFailure(
        activePage,
        item,
        step,
        "Modal “Isi Realisasi Periodik” tidak terbuka setelah tombol edit diklik. Lihat detail tombol/heading di bawah."
      );
    }

    // Kolom Realisasi dicari khusus di dalam modal.
    const realizationField = await findVisibleTextarea(modal);
    if (!realizationField) {
      return itemFailure(
        activePage,
        item,
        step,
        "Kolom Realisasi tidak ditemukan di dalam modal “Isi Realisasi Periodik”. Lihat detail input/tombol/heading di bawah."
      );
    }

    const feedbackField = await findLinkFieldInRealisasiModal(modal);

    debug.existingTextareaValue = await getControlValue(realizationField);
    debug.existingLinkValue = feedbackField ? await getControlValue(feedbackField) : "";
    debug.realisasiText = resolveRealizationText(item);
    debug.shouldFill = item.overwrite === true || (!debug.existingTextareaValue.trim() && !debug.existingLinkValue.trim());

    if (!debug.shouldFill && !item.overwrite) {
      await robustCloseModal(activePage, modal);
      debug.modalClosed = !(await modal.isVisible({ timeout: 500 }).catch(() => false));
      debug.finalStatus = "existing";
      debugPeriodicModalFill(debug);
      const result: PeriodicItemResult = {
        kode_skp: item.kode_skp,
        nama_skp: item.nama_skp,
        ok: true,
        status: "existing",
        message: "Sudah ada isian di website SKP. Data tidak ditimpa karena overwrite tidak aktif.",
        currentUrl: activePage.url()
      };
      return result;
    }

    debug.textareaValue = await fillRealisasiTextarea(activePage, realizationField, debug.realisasiText);
    if (!debug.textareaValue || debug.textareaValue.trim().length <= 20) {
      debug.error = "Field Realisasi/Link belum berhasil terisi.";
      debug.finalStatus = "failed";
      debugPeriodicModalFill(debug);
      return itemFailure(activePage, item, step, "Field Realisasi/Link belum berhasil terisi.");
    }

    if (!feedbackField) {
      debug.error = "Field Realisasi/Link belum berhasil terisi.";
      debug.finalStatus = "failed";
      debugPeriodicModalFill(debug);
      return itemFailure(activePage, item, step, "Field Realisasi/Link belum berhasil terisi.");
    }
    const linkText = item.feedbackLink?.trim() || PERIODIC_FEEDBACK_LINK;
    debug.linkValue = await fillLinkField(activePage, feedbackField, linkText);
    if (!debug.linkValue || debug.linkValue.trim().length <= 10) {
      debug.error = "Field Realisasi/Link belum berhasil terisi.";
      debug.finalStatus = "failed";
      debugPeriodicModalFill(debug);
      return itemFailure(activePage, item, step, "Field Realisasi/Link belum berhasil terisi.");
    }

    debug.saveClicked = await clickSaveForItem(modal);
    if (!debug.saveClicked) {
      debug.finalStatus = "failed";
      debug.error = "Tombol Simpan tidak ditemukan di modal Isi Realisasi Periodik.";
      debugPeriodicModalFill(debug);
      return itemFailure(activePage, item, step, "Tombol Simpan tidak ditemukan di modal Isi Realisasi Periodik.");
    }
    await activePage.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
    await activePage.waitForTimeout(600).catch(() => undefined);
    const saved = await verifyPeriodicItemSaved(activePage, modal, item);
    debug.modalClosed = !(await modal.isVisible({ timeout: 500 }).catch(() => false));
    if (!saved) {
      debug.finalStatus = "failed";
      debug.error = "Data realisasi belum terverifikasi tersimpan setelah klik Simpan. Modal masih terbuka atau validasi required muncul.";
      debugPeriodicModalFill(debug);
      return itemFailure(activePage, item, step, "Data realisasi belum terverifikasi tersimpan setelah klik Simpan. Modal masih terbuka atau validasi required muncul.");
    }

    debug.finalStatus = "filled";
    debugPeriodicModalFill(debug);
    return {
      kode_skp: item.kode_skp,
      nama_skp: item.nama_skp,
      ok: true,
      status: "filled",
      message: "Realisasi berhasil diisi dan tersimpan.",
      currentUrl: activePage.url()
    };
  } catch (error) {
    const message = error instanceof Error ? tidyPeriodicMessage(error.message) : "Gagal mengisi SKP Periodik.";
    debug.error = message;
    debug.finalStatus = "failed";
    debugPeriodicModalFill(debug);
    return itemFailure(activePage, item, step, message);
  }
}

// Status hanya untuk item ini yang gagal — sertakan diagnostik agar mudah dilacak.
async function itemFailure(activePage: Page, item: PeriodicFillItem, step: string, message: string): Promise<PeriodicItemResult> {
  const cleanMessage = tidyPeriodicMessage(message);
  const diag = await collectPageDiagnostics(activePage).catch(() => ({
    inputs: [],
    buttons: [],
    headings: [],
    sidebarItems: [],
    visiblePageTitle: "",
    visibleHeading: "",
    visibleTextSample: "",
    fullTextSample: "",
    greenEditButtonCount: 0
  }));
  const screenshotPath = await capturePeriodicScreenshot(`fail-${item.kode_skp}`).catch(() => undefined);
  return {
    kode_skp: item.kode_skp,
    nama_skp: item.nama_skp,
    ok: false,
    status: "failed",
    message: cleanMessage,
    screenshotPath,
    currentUrl: activePage.url(),
    step,
    availableInputs: diag.inputs,
    availableButtons: diag.buttons,
    headings: diag.headings,
    greenEditButtonCount: diag.greenEditButtonCount,
    currentSkpRow: await describeCurrentSkpRow(activePage, item).catch(() => undefined)
  };
}

// Hitung tombol edit hijau "Isi Realisasi" yang tampil — indikator bahwa Hasil Kerja sudah muncul.
async function countRealisasiEditButtons(activePage: Page): Promise<number> {
  const domCount = await activePage
    .evaluate(() => {
      const isRealisasiEdit = (node: Element): boolean => {
        const el = node as HTMLElement;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (style.display === "none" || style.visibility === "hidden" || rect.width === 0 || rect.height === 0) return false;
        const meta = [el.getAttribute("title"), el.getAttribute("aria-label"), el.getAttribute("data-original-title"), el.innerText || el.textContent]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (/isi\s*realisasi/.test(meta)) return true;
        const cls = typeof el.className === "string" ? el.className.toLowerCase() : "";
        const isGreen = /(btn-success|success|green|hijau)/.test(cls);
        const hasPencil = Boolean(el.querySelector("i[class*='pencil' i], i[class*='edit' i], i.fa-pencil, i.fa-edit, i.fa-pencil-alt, svg"));
        return isGreen && hasPencil;
      };
      return Array.from(document.querySelectorAll("a, button, [role='button']")).filter(isRealisasiEdit).length;
    })
    .catch(() => 0);
  const locatorCount = await countGreenEditButtonsByLocator(activePage);
  return Math.max(domCount, locatorCount);
}

async function countGreenEditButtonsByLocator(activePage: Page): Promise<number> {
  const selectors = [
    "a.btn-success:has(i), button.btn-success:has(i)",
    "a[class*='success' i]:has(i), button[class*='success' i]:has(i)",
    "a[class*='green' i]:has(i), button[class*='green' i]:has(i)",
    "a[title*='realisasi' i], button[title*='realisasi' i], a[aria-label*='realisasi' i], button[aria-label*='realisasi' i], [data-original-title*='realisasi' i]"
  ];
  const handles = new Set<string>();
  let count = 0;
  for (const selector of selectors) {
    const candidates = activePage.locator(selector);
    const total = await candidates.count().catch(() => 0);
    for (let index = 0; index < Math.min(total, 100); index += 1) {
      const candidate = candidates.nth(index);
      if (!(await candidate.isVisible({ timeout: 150 }).catch(() => false))) continue;
      const key = await candidate.evaluate((node) => {
        const el = node as HTMLElement;
        const rect = el.getBoundingClientRect();
        return `${Math.round(rect.x)}:${Math.round(rect.y)}:${Math.round(rect.width)}:${Math.round(rect.height)}:${el.className}`;
      }).catch(() => `${selector}:${index}`);
      if (handles.has(key)) continue;
      handles.add(key);
      count += 1;
    }
  }
  return count;
}

// Cari tombol edit hijau "Isi Realisasi" di dalam sebuah row/kartu SKP (atau body sebagai fallback).
async function findEditRealisasiButton(scope: FieldScope): Promise<Locator | null> {
  // 1. Berdasarkan title/aria-label/text "Isi Realisasi".
  const byAttribute = scope
    .locator(
      "a[title*='realisasi' i], button[title*='realisasi' i], a[aria-label*='realisasi' i], button[aria-label*='realisasi' i], [data-original-title*='realisasi' i]"
    )
    .first();
  if (await byAttribute.isVisible({ timeout: 600 }).catch(() => false)) return byAttribute;

  const byText = await findActionButton(scope, EDIT_REALISASI_PATTERNS);
  if (byText) return byText;

  // 2. Tombol hijau (btn-success/green) dengan ikon pensil/edit.
  const greenWithPencil = scope
    .locator(
      "a.btn-success:has(i[class*='pencil' i]), button.btn-success:has(i[class*='pencil' i]), a.btn-success:has(i[class*='edit' i]), button.btn-success:has(i[class*='edit' i]), a[class*='success' i]:has(i[class*='pencil' i]), button[class*='success' i]:has(i[class*='pencil' i]), a[class*='success' i]:has(i[class*='edit' i]), button[class*='success' i]:has(i[class*='edit' i]), a[class*='green' i]:has(i[class*='pencil' i]), button[class*='green' i]:has(i[class*='pencil' i]), a[class*='green' i]:has(i[class*='edit' i]), button[class*='green' i]:has(i[class*='edit' i])"
    )
    .first();
  if (await greenWithPencil.isVisible({ timeout: 600 }).catch(() => false)) return greenWithPencil;

  // 3. Fallback: tombol dengan ikon pensil/edit.
  const pencil = scope
    .locator("a:has(i[class*='pencil' i]), button:has(i[class*='pencil' i]), a:has(i[class*='edit' i]), button:has(i[class*='edit' i])")
    .first();
  if (await pencil.isVisible({ timeout: 600 }).catch(() => false)) return pencil;

  // 4. Fallback terakhir: tombol hijau yang terlihat di row.
  const green = scope
    .locator(
      "a.btn-success, button.btn-success, a[class*='success' i], button[class*='success' i], a[class*='green' i], button[class*='green' i]"
    )
    .first();
  if (await green.isVisible({ timeout: 600 }).catch(() => false)) return green;

  return null;
}

// Ambil modal/dialog yang sedang tampil (opsional difilter berdasarkan heading).
async function getVisibleModal(activePage: Page, heading?: RegExp): Promise<Locator | null> {
  const candidates = activePage.locator(
    "[role='dialog'], .modal, .modal-dialog, .modal-content, .ui-dialog, .swal2-popup, [class*='modal' i]"
  );
  const total = await candidates.count().catch(() => 0);
  for (let index = 0; index < Math.min(total, 20); index += 1) {
    const el = candidates.nth(index);
    if (!(await el.isVisible({ timeout: 200 }).catch(() => false))) continue;
    if (heading) {
      const text = await el.innerText({ timeout: 400 }).catch(() => "");
      if (!heading.test(text)) continue;
    }
    return el;
  }
  return null;
}

async function waitForModal(activePage: Page, heading: RegExp, timeout: number): Promise<Locator | null> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const modal = await getVisibleModal(activePage, heading);
    if (modal) return modal;
    await activePage.waitForTimeout(300).catch(() => undefined);
  }
  return null;
}

async function waitForRealisasiModal(activePage: Page, timeout = 8000): Promise<Locator | null> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const byHeading = await getVisibleModal(activePage, REALISASI_MODAL_HEADING);
    if (byHeading) return byHeading;
    await activePage.waitForTimeout(300).catch(() => undefined);
  }
  return null;
}

async function closeModal(activePage: Page, modal: Locator): Promise<void> {
  const closeButton = await findActionButton(modal, [/tutup/i, /batal/i, /close/i, /^\s*[x×]\s*$/i]);
  if (closeButton) {
    await closeButton.click({ timeout: 3000 }).catch(() => undefined);
  } else {
    await activePage.keyboard.press("Escape").catch(() => undefined);
  }
  await activePage.waitForTimeout(300).catch(() => undefined);
}

async function robustCloseModal(activePage: Page, modal: Locator): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await closeModal(activePage, modal);
    if (await waitForModalHidden(activePage, modal, 1500)) return;
    await activePage.keyboard.press("Escape").catch(() => undefined);
    if (await waitForModalHidden(activePage, modal, 1000)) return;
  }
}

async function waitForModalHidden(activePage: Page, modal: Locator, timeout = 3000): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const visible = await modal.isVisible({ timeout: 200 }).catch(() => false);
    if (!visible) return true;
    await activePage.waitForTimeout(200).catch(() => undefined);
  }
  return !(await modal.isVisible({ timeout: 200 }).catch(() => false));
}

async function waitForModalClosedOrSaved(activePage: Page, modal: Locator, timeout = 8000): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const stillVisible = await modal.isVisible({ timeout: 250 }).catch(() => false);
    if (!stillVisible) return true;
    const body = await activePage.locator("body").innerText({ timeout: 500 }).catch(() => "");
    if (/berhasil|sukses|tersimpan|disimpan|updated/i.test(body) && !/gagal|error/i.test(body)) return true;
    await activePage.waitForTimeout(400).catch(() => undefined);
  }
  return !(await modal.isVisible({ timeout: 250 }).catch(() => false));
}

async function verifyPeriodicItemSaved(activePage: Page, modal: Locator, item: PeriodicFillItem, timeout = 8000): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const stillVisible = await modal.isVisible({ timeout: 250 }).catch(() => false);
    if (!stillVisible) return true;

    if (await hasRequiredValidationInModal(modal)) return false;

    const body = await activePage.locator("body").innerText({ timeout: 500 }).catch(() => "");
    if (/berhasil|sukses|tersimpan|disimpan|updated/i.test(body) && !/gagal|error/i.test(body)) return true;

    const rowText = await describeCurrentSkpRow(activePage, item).catch(() => "");
    if (rowText && /realisasi|umpan\s*balik|tautan|link/i.test(rowText) && /terisi|tersimpan|disimpan|berhasil/i.test(rowText)) {
      return true;
    }

    await activePage.waitForTimeout(400).catch(() => undefined);
  }
  return !(await modal.isVisible({ timeout: 250 }).catch(() => false));
}

async function hasRequiredValidationInModal(modal: Locator): Promise<boolean> {
  return modal
    .locator("textarea:visible, input:visible")
    .evaluateAll((nodes) =>
      nodes.some((node) => {
        const control = node as HTMLInputElement | HTMLTextAreaElement;
        if (control.disabled || control.readOnly) return false;
        if (!control.required && control.value.trim()) return false;
        return !control.checkValidity() || Boolean(control.validationMessage);
      })
    )
    .catch(() => false);
}

async function findVisibleTextarea(scope: FieldScope): Promise<Locator | null> {
  const textarea = scope.locator("textarea:visible").first();
  if (await textarea.isVisible({ timeout: 800 }).catch(() => false)) return textarea;
  return null;
}

function resolveRealizationText(item: PeriodicFillItem): string {
  const generated = item.realization?.trim();
  if (generated) return generated;
  return "Pada Triwulan II Tahun 2026, telah dilaksanakan kegiatan sesuai rencana kinerja berdasarkan log harian periode April sampai Juni 2026.";
}

async function fillRealisasiTextarea(activePage: Page, textarea: Locator, realizationText: string): Promise<string> {
  await textarea.scrollIntoViewIfNeeded().catch(() => undefined);
  await textarea.click({ timeout: 5000 });
  await activePage.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => undefined);
  await textarea.fill(realizationText, { timeout: 5000 }).catch(async () => {
    await textarea.click({ timeout: 5000 }).catch(() => undefined);
    await activePage.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => undefined);
    await textarea.type(realizationText, { delay: 0, timeout: 10_000 }).catch(async () => {
      await activePage.keyboard.insertText(realizationText).catch(() => undefined);
    });
  });
  await dispatchControlEvents(textarea);

  let value = await textarea.inputValue({ timeout: 1000 }).catch(() => "");
  if (!value || value.trim().length < 20) {
    await textarea.evaluate((node, text) => {
      const control = node as HTMLTextAreaElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      if (setter) setter.call(control, text);
      else control.value = text;
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
      control.dispatchEvent(new Event("blur", { bubbles: true }));
    }, realizationText);
    value = await textarea.inputValue({ timeout: 1000 }).catch(() => "");
  }
  return value.trim();
}

async function findLinkFieldInRealisasiModal(modal: Locator): Promise<Locator | null> {
  const labelPattern = /link\s*(\/|\s)?\s*tautan|link|tautan/i;
  const labels = modal.locator("label, th, td, div, span").filter({ hasText: labelPattern });
  const labelCount = await labels.count().catch(() => 0);
  for (let index = 0; index < Math.min(labelCount, 30); index += 1) {
    const label = labels.nth(index);
    const labelText = await label.innerText({ timeout: 300 }).catch(() => "");
    if (/hasil\s*kerja/i.test(labelText) || !labelPattern.test(labelText)) continue;
    const forValue = await label.getAttribute("for").catch(() => null);
    if (forValue) {
      const byFor = modal.locator(`input[id="${escapeCssAttribute(forValue)}"]`).first();
      if (await isEditableLinkInput(byFor)) return byFor;
    }
    const nearby = label.locator("xpath=following::*[self::input and not(@type='hidden')][1]");
    if (await isEditableLinkInput(nearby)) return nearby;
  }

  for (const token of ["tautan", "link"]) {
    const byAttribute = modal.locator(buildAttributeSelector("input", token)).first();
    if (await isEditableLinkInput(byAttribute)) return byAttribute;
  }

  const controls = modal.locator("input:visible");
  const total = await controls.count().catch(() => 0);
  for (let index = total - 1; index >= 0; index -= 1) {
    const control = controls.nth(index);
    if (await isEditableLinkInput(control)) return control;
  }
  return null;
}

async function fillLinkField(activePage: Page, target: Locator, value: string): Promise<string> {
  await target.scrollIntoViewIfNeeded().catch(() => undefined);
  await target.click({ timeout: 5000 });
  await activePage.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => undefined);
  await target.fill(value, { timeout: 5000 }).catch(async () => {
    await activePage.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => undefined);
    await target.type(value, { delay: 0, timeout: 10_000 }).catch(async () => {
      await activePage.keyboard.insertText(value).catch(() => undefined);
    });
  });
  await dispatchControlEvents(target);
  let current = await getControlValue(target);
  if (!current || current.trim().length < 10) {
    await target
      .evaluate((node, text) => {
        const control = node as HTMLInputElement;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        if (setter) setter.call(control, text);
        else control.value = text;
        control.dispatchEvent(new Event("input", { bubbles: true }));
        control.dispatchEvent(new Event("change", { bubbles: true }));
        control.dispatchEvent(new Event("blur", { bubbles: true }));
      }, value)
      .catch(() => undefined);
    current = await getControlValue(target);
  }
  return current;
}

async function isEditableControl(target: Locator, options: { allowTextarea?: boolean } = {}): Promise<boolean> {
  const allowTextarea = options.allowTextarea ?? true;
  return target
    .evaluate((node, allow) => {
      const element = node as HTMLInputElement | HTMLTextAreaElement;
      const tag = element.tagName.toLowerCase();
      const type = (element.getAttribute("type") || "").toLowerCase();
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const visible = style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      if (!visible || element.disabled || element.readOnly) return false;
      if (tag === "textarea") return Boolean(allow);
      return tag === "input" && !["hidden", "button", "submit", "reset", "checkbox", "radio"].includes(type);
    }, allowTextarea)
    .catch(() => false);
}

async function isEditableLinkInput(target: Locator): Promise<boolean> {
  return target
    .evaluate((node) => {
      const element = node as HTMLInputElement;
      const tag = element.tagName.toLowerCase();
      const type = (element.getAttribute("type") || "text").toLowerCase();
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const visible = style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      if (!visible || element.disabled || element.readOnly) return false;
      if (tag !== "input" || ["hidden", "button", "submit", "reset", "checkbox", "radio", "file"].includes(type)) return false;
      const meta = [element.name, element.id, element.placeholder, element.getAttribute("aria-label"), element.getAttribute("title")]
        .filter(Boolean)
        .join(" ");
      return !/hasil\s*kerja/i.test(meta);
    })
    .catch(() => false);
}

async function dispatchControlEvents(target: Locator): Promise<void> {
  await target
    .evaluate((node) => {
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
      node.dispatchEvent(new Event("blur", { bubbles: true }));
    })
    .catch(() => undefined);
}

function debugPeriodicModalFill(debug: PeriodicModalFillDebug): void {
  console.info(
    JSON.stringify({
      automation_step: "periodic_modal_fill_debug",
      item_id: debug.itemId,
      kode_skp: debug.kode_skp,
      nama_skp: debug.nama_skp,
      existingTextareaValue: debug.existingTextareaValue,
      existingLinkValue: debug.existingLinkValue,
      shouldFill: debug.shouldFill,
      realisasiText: debug.realisasiText,
      textareaValueAfterFill: debug.textareaValue,
      linkValueAfterFill: debug.linkValue,
      saveClicked: debug.saveClicked,
      modalClosed: debug.modalClosed,
      finalStatus: debug.finalStatus,
      error: debug.error
    })
  );
}

// Klik "Check All" bila ada, lalu pastikan semua checkbox pada modal tercentang.
async function clickCheckAll(activePage: Page, modal: FieldScope): Promise<void> {
  const button = await findActionButton(modal, CHECK_ALL_PATTERNS);
  if (button) {
    await button.click({ timeout: 3000 }).catch(() => undefined);
    await activePage.waitForTimeout(200).catch(() => undefined);
  }

  const checkboxes = modal.locator("input[type='checkbox']");
  const total = await checkboxes.count().catch(() => 0);
  for (let index = 0; index < total; index += 1) {
    const checkbox = checkboxes.nth(index);
    if (!(await checkbox.isVisible({ timeout: 150 }).catch(() => false))) continue;
    if (await checkbox.isDisabled().catch(() => false)) continue;
    if (await checkbox.isChecked().catch(() => false)) continue;
    await checkbox.check({ timeout: 1500 }).catch(async () => {
      await checkbox.click({ timeout: 1500 }).catch(() => undefined);
    });
  }
}

type PageDiagnostics = {
  inputs: string[];
  buttons: string[];
  headings: string[];
  sidebarItems: string[];
  visiblePageTitle: string;
  visibleHeading: string;
  visibleTextSample: string;
  fullTextSample: string;
  greenEditButtonCount: number;
};

// Kumpulkan input/tombol/heading yang terdeteksi agar error kolom realisasi punya konteks jelas.
async function collectPageDiagnostics(activePage: Page): Promise<PageDiagnostics> {
  const buttons = await collectAvailableButtons(activePage);
  const sidebarItems = await collectSidebarTexts(activePage).catch(() => []);
  const data = await activePage
    .evaluate(() => {
      const isVisible = (element: HTMLElement): boolean => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const describe = (node: Element): string => {
        const el = node as HTMLElement;
        const tag = el.tagName.toLowerCase();
        const type = el.getAttribute("type");
        const parts = [
          type ? `${tag}[${type}]` : tag,
          el.getAttribute("name"),
          el.id ? `#${el.id}` : "",
          el.getAttribute("placeholder"),
          el.getAttribute("aria-label")
        ]
          .filter(Boolean)
          .join(" ");
        return parts.replace(/\s+/g, " ").trim();
      };
      const inputs = Array.from(document.querySelectorAll("input, textarea, select, [contenteditable='true']"))
        .map(describe)
        .filter((text) => text.length > 0)
        .slice(0, 40);
      const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, legend, th, label"))
        .map((node) => (node.textContent || "").replace(/\s+/g, " ").trim())
        .filter((text) => text.length > 0 && text.length < 90)
        .slice(0, 30);
      const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
      const bodyContentText = (document.body?.textContent || "").replace(/\s+/g, " ").trim();
      const documentText = (document.documentElement?.innerText || document.documentElement?.textContent || "").replace(/\s+/g, " ").trim();
      const relevantElementText = Array.from(document.querySelectorAll("body *"))
        .map((node) => (node.textContent || "").replace(/\s+/g, " ").trim())
        .filter((text) => /Evaluasi|Triwulan|HASIL\s*KERJA|Realisasi|Umpan\s*Balik/i.test(text))
        .filter((text) => text.length > 0 && text.length < 300)
        .slice(0, 80)
        .join(" ");
      const bodyLines = (document.body?.innerText || "")
        .split(/\n+/)
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter((line) => line.length > 0 && line.length < 160);
      const titleParts = [
        document.title,
        ...Array.from(document.querySelectorAll("h1, h2, h3, .page-title, .content-header h1, .panel-title"))
          .filter((node) => isVisible(node as HTMLElement))
          .map((node) => (node.textContent || "").replace(/\s+/g, " ").trim())
      ].filter((text) => text && text.length < 120);
      const visibleHeading =
        titleParts.find((text) => /evaluasi\s+triwulan/i.test(text)) ??
        bodyLines.find((text) => /evaluasi\s+triwulan/i.test(text)) ??
        headings.find((text) => /evaluasi\s+triwulan/i.test(text)) ??
        titleParts.find((text) => /triwulan|periodik/i.test(text)) ??
        bodyLines.find((text) => /triwulan|periodik/i.test(text)) ??
        titleParts[0] ??
        "";
      const isRealisasiEdit = (node: Element): boolean => {
        const el = node as HTMLElement;
        if (!isVisible(el)) return false;
        const meta = [el.getAttribute("title"), el.getAttribute("aria-label"), el.getAttribute("data-original-title"), el.innerText || el.textContent]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (/isi\s*realisasi/.test(meta)) return true;
        const cls = typeof el.className === "string" ? el.className.toLowerCase() : "";
        const isGreen = /(btn-success|success|green|hijau)/.test(cls);
        const hasPencil = Boolean(el.querySelector("i[class*='pencil' i], i[class*='edit' i], i.fa-pencil, i.fa-edit, i.fa-pencil-alt, svg"));
        return isGreen && hasPencil;
      };
      const visibleTextSample = [bodyText, bodyContentText, documentText, headings.join(" "), relevantElementText]
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 2000);
      return {
        inputs,
        headings: Array.from(new Set(headings)),
        visiblePageTitle: Array.from(new Set(titleParts)).slice(0, 8).join(" | "),
        visibleHeading,
        visibleTextSample,
        fullTextSample: [bodyText, bodyContentText, documentText, relevantElementText].filter(Boolean).join(" ").slice(0, 6000),
        greenEditButtonCount: Array.from(document.querySelectorAll("a, button, [role='button']")).filter(isRealisasiEdit).length
      };
    })
    .catch(() => ({
      inputs: [] as string[],
      headings: [] as string[],
      visiblePageTitle: "",
      visibleHeading: "",
      visibleTextSample: "",
      fullTextSample: "",
      greenEditButtonCount: 0
    }));
  return {
    inputs: data.inputs,
    buttons,
    headings: data.headings,
    sidebarItems,
    visiblePageTitle: data.visiblePageTitle,
    visibleHeading: data.visibleHeading,
    visibleTextSample: data.visibleTextSample || buttons.join(" | ").slice(0, 2000),
    fullTextSample: data.fullTextSample || buttons.join(" | "),
    greenEditButtonCount: data.greenEditButtonCount
  };
}

async function collectSidebarTexts(activePage: Page): Promise<string[]> {
  return activePage
    .evaluate(() => {
      const isVisible = (element: HTMLElement): boolean => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const clean = (value: string | null | undefined): string => (value || "").replace(/\s+/g, " ").trim();
      const sidebarSelector = [
        "aside",
        "nav",
        "#sidebar",
        ".sidebar",
        ".main-sidebar",
        ".left-side",
        ".side-menu",
        ".sidebar-menu",
        ".main-menu",
        ".navbar-nav",
        ".nav-sidebar",
        "[class*='sidebar' i]",
        "[class*='side-menu' i]"
      ].join(", ");
      const roots = Array.from(document.querySelectorAll(sidebarSelector))
        .map((node) => node as HTMLElement)
        .filter((node) => isVisible(node) && /SKP|Triwulan|Beranda|Log\s*Harian/i.test(node.innerText || node.textContent || ""));
      const nodes = roots.flatMap((root) =>
        Array.from(root.querySelectorAll("a, button, [role='button'], [role='menuitem'], [data-toggle='collapse'], [data-bs-toggle='collapse']"))
      );
      const menuTexts = nodes
        .map((node) => node as HTMLElement)
        .filter((node) => isVisible(node))
        .flatMap((node) => {
          const text = clean(node.innerText || node.textContent || node.getAttribute("aria-label") || node.getAttribute("title"));
          return text.split(/\s{2,}|\r?\n/).map(clean);
        })
        .filter((text) => text.length > 0 && text.length < 80);
      return Array.from(new Set(menuTexts)).slice(0, 80);
    })
    .catch(() => []);
}

async function findItemContainer(activePage: Page, item: PeriodicFillItem): Promise<Locator> {
  const kodePattern = new RegExp(escapeRegExp(item.kode_skp), "i");
  const selectors = "tr, .card, .panel, li, [class*='item' i], [class*='skp' i]";
  const byCode = activePage.locator(selectors).filter({ hasText: kodePattern });
  const byCodeCount = await byCode.count().catch(() => 0);
  for (let index = 0; index < Math.min(byCodeCount, 20); index += 1) {
    const candidate = byCode.nth(index);
    if (!(await candidate.isVisible({ timeout: 500 }).catch(() => false))) continue;
    if (await findEditRealisasiButton(candidate)) return candidate;
  }

  const tokens = distinctiveSkpTokens(item.nama_skp);
  const candidates = activePage.locator(selectors);
  const total = await candidates.count().catch(() => 0);
  let best: { locator: Locator; score: number; textLength: number } | null = null;
  for (let index = 0; index < Math.min(total, 250); index += 1) {
    const candidate = candidates.nth(index);
    if (!(await candidate.isVisible({ timeout: 150 }).catch(() => false))) continue;
    if (!(await findEditRealisasiButton(candidate))) continue;
    const text = normalizeText(await candidate.innerText({ timeout: 300 }).catch(() => ""));
    if (!text) continue;
    const score = tokens.filter((token) => text.includes(token)).length;
    const minScore = Math.min(2, tokens.length);
    if (score < minScore) continue;
    const textLength = text.length;
    if (!best || score > best.score || (score === best.score && textLength < best.textLength)) {
      best = { locator: candidate, score, textLength };
    }
  }
  if (best) return best.locator;

  return activePage.locator("body");
}

function distinctiveSkpTokens(name: string): string[] {
  const stopWords = new Set([
    "yang",
    "dan",
    "atau",
    "untuk",
    "kepada",
    "dari",
    "ketua",
    "tim",
    "kemitraan",
    "tata",
    "kelola",
    "program",
    "penugasan",
    "tersalurkannya",
    "dana",
    "bantuan",
    "sosial",
    "pip",
    "paket",
    "siswa",
    "tahun"
  ]);
  const tokens = normalizeText(name)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !stopWords.has(token));
  const unique = Array.from(new Set(tokens)).slice(0, 8);
  if (unique.length > 0) return unique;
  return Array.from(new Set(normalizeText(name).split(" ").filter((token) => token.length >= 3))).slice(0, 5);
}

async function describeCurrentSkpRow(activePage: Page, item: PeriodicFillItem): Promise<string | undefined> {
  const container = await findItemContainer(activePage, item);
  const text = await container.innerText({ timeout: 800 }).catch(() => "");
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean || clean.length > 2500) return `${item.kode_skp} ${item.nama_skp}`.replace(/\s+/g, " ").trim();
  return clean.slice(0, 1000);
}

async function fillYear(scope: FieldScope, year: number): Promise<void> {
  const yearField = await findField(scope, ["tahun", "year"], "input, select");
  if (!yearField) return;
  if (await isSelectElement(yearField)) {
    await yearField.selectOption({ label: String(year) }).catch(async () => {
      await yearField.selectOption({ value: String(year) }).catch(() => undefined);
    });
  } else {
    await fillControl(scopeToPage(scope), yearField, String(year));
  }
}

async function clickSaveForItem(scope: FieldScope): Promise<boolean> {
  const button = await findActionButton(scope, [/simpan/i, /save/i, /update/i, /ok/i]);
  if (!button) return false;
  await button.click({ timeout: 5000 });
  return true;
}

type SubmitOutcome = { ok: boolean; state: PeriodicSubmitState; message: string; availableButtons: string[] };

const SUBMIT_BUTTON_PATTERNS = [
  /ajukan\s*skp\s*periodik/i,
  /simpan\s*dan\s*ajukan/i,
  /\bajukan\b/i,
  /\bkirim\b/i,
  /\bsubmit\b/i
];

async function submitActivePeriodicPage(activePage: Page): Promise<SubmitOutcome> {
  const availableButtons = await collectAvailableButtons(activePage);

  if (await detectAlreadySubmitted(activePage)) {
    return { ok: false, state: "already_submitted", message: "SKP Periodik sudah diajukan.", availableButtons };
  }

  const submitButton = await findSubmitButton(activePage.locator("body"), SUBMIT_BUTTON_PATTERNS);
  if (!submitButton) {
    return {
      ok: false,
      state: "button_not_found",
      message: "Data berhasil diisi/terdeteksi, tetapi tombol Ajukan belum tersedia atau SKP sudah diajukan.",
      availableButtons
    };
  }
  if (submitButton.disabled) {
    return {
      ok: false,
      state: "button_disabled",
      message: "Tombol Ajukan belum aktif. Pastikan seluruh item SKP Periodik sudah lengkap.",
      availableButtons
    };
  }

  await submitButton.locator.click({ timeout: 5000 }).catch(() => undefined);
  await activePage.waitForTimeout(500).catch(() => undefined);
  const confirmButton = await findActionButton(activePage.locator("body"), [/ya/i, /lanjut/i, /setuju/i, /ok/i, /konfirmasi/i]);
  if (confirmButton) await confirmButton.click({ timeout: 5000 }).catch(() => undefined);
  await activePage.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await activePage.waitForTimeout(800).catch(() => undefined);
  const body = await activePage.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (/gagal|error|tidak berhasil/i.test(body) && !/berhasil|sukses|diajukan/i.test(body)) {
    return {
      ok: false,
      state: "not_ready",
      message: "Pengajuan perlu dicek. Website menampilkan pesan gagal atau error.",
      availableButtons: await collectAvailableButtons(activePage)
    };
  }
  return { ok: true, state: "submitted", message: "SKP Periodik berhasil diajukan.", availableButtons };
}

async function findSubmitButton(scope: FieldScope, patterns: RegExp[]): Promise<{ locator: Locator; disabled: boolean } | null> {
  for (const pattern of patterns) {
    for (const locator of [
      scope.getByRole("button", { name: pattern }).first(),
      scope.getByRole("link", { name: pattern }).first(),
      scope.locator("button, a, [role='button'], [onclick]").filter({ hasText: pattern }).first()
    ]) {
      if ((await locator.count().catch(() => 0)) === 0) continue;
      if (!(await locator.isVisible({ timeout: 600 }).catch(() => false))) continue;
      return { locator, disabled: await isControlDisabled(locator) };
    }
  }

  // input[type=submit|button] dicocokkan lewat atribut value (tidak terbaca oleh hasText).
  const inputs = scope.locator("input[type='submit'], input[type='button']");
  const total = await inputs.count().catch(() => 0);
  for (let index = 0; index < total; index += 1) {
    const input = inputs.nth(index);
    const value = (await input.getAttribute("value").catch(() => "")) ?? "";
    if (!patterns.some((pattern) => pattern.test(value))) continue;
    if (!(await input.isVisible({ timeout: 600 }).catch(() => false))) continue;
    return { locator: input, disabled: await isControlDisabled(input) };
  }
  return null;
}

async function isControlDisabled(locator: Locator): Promise<boolean> {
  return locator
    .evaluate((node) => {
      const element = node as HTMLButtonElement;
      return (
        element.disabled === true ||
        element.getAttribute("aria-disabled") === "true" ||
        element.classList.contains("disabled") ||
        element.classList.contains("is-disabled")
      );
    })
    .catch(() => false);
}

async function collectAvailableButtons(activePage: Page): Promise<string[]> {
  return activePage
    .evaluate(() => {
      const nodes = Array.from(document.querySelectorAll("button, a, input[type='submit'], input[type='button'], [role='button']"));
      const texts = nodes
        .map((node) => {
          const element = node as HTMLElement;
          const raw = element.innerText || element.textContent || (element as HTMLInputElement).value || element.getAttribute("aria-label") || element.getAttribute("title") || "";
          return raw.replace(/\s+/g, " ").trim();
        })
        .filter((text) => text.length > 0 && text.length < 60);
      return Array.from(new Set(texts)).slice(0, 40);
    })
    .catch(() => []);
}

async function detectAlreadySubmitted(activePage: Page): Promise<boolean> {
  const body = await activePage.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  return /(sudah|telah)\s+diajukan|status\s*:?\s*diajukan|menunggu\s+persetujuan|sudah\s+dinilai|telah\s+dinilai/i.test(body);
}

function resolveRunStatus(input: {
  submit: boolean;
  submitted: boolean;
  submitState: PeriodicSubmitState;
  totalItems: number;
  successCount: number;
  failedCount: number;
}): PeriodicStatus {
  if (input.submitted || input.submitState === "already_submitted") return "submitted";
  if (input.failedCount > 0 && input.successCount === 0) return "failed";
  if (input.failedCount > 0) return "partially_filled";
  if (input.submit && ["button_not_found", "button_disabled", "not_ready"].includes(input.submitState)) {
    return "ready_to_submit_manual";
  }
  if (input.totalItems > 0 && input.successCount === input.totalItems) return "filled_all";
  return "needs_check";
}

function mapSubmitStateToStatus(state: PeriodicSubmitState, ok: boolean): PeriodicStatus {
  if (ok || state === "submitted" || state === "already_submitted") return "submitted";
  if (state === "button_not_found" || state === "button_disabled") return "ready_to_submit_manual";
  return "needs_check";
}

async function findField(scope: FieldScope, aliases: string[], selector = "input, textarea, [contenteditable='true']"): Promise<Locator | null> {
  for (const alias of aliases) {
    const direct = scope.getByLabel(new RegExp(escapeRegExp(alias), "i")).first();
    if (await direct.isVisible({ timeout: 800 }).catch(() => false)) return direct;
  }

  const tokens = aliases.flatMap((alias) => alias.toLowerCase().split(/[^a-z0-9]+/)).filter((token) => token.length >= 3);
  for (const token of tokens) {
    const byAttribute = scope.locator(buildAttributeSelector(selector, token)).first();
    if (await byAttribute.isVisible({ timeout: 800 }).catch(() => false)) return byAttribute;
  }

  for (const alias of aliases) {
    const label = scope.locator("label").filter({ hasText: new RegExp(escapeRegExp(alias), "i") }).first();
    if (!(await label.isVisible({ timeout: 800 }).catch(() => false))) continue;
    const forValue = await label.getAttribute("for").catch(() => null);
    if (forValue) {
      const byFor = scope.locator(`${selector}[id="${escapeCssAttribute(forValue)}"]`).first();
      if (await byFor.isVisible({ timeout: 800 }).catch(() => false)) return byFor;
    }
    const nearby = label.locator(`xpath=following::*[self::input or self::textarea or @contenteditable='true' or self::select][1]`);
    if (await nearby.isVisible({ timeout: 800 }).catch(() => false)) return nearby;
  }

  return null;
}

async function findActionButton(scope: FieldScope, patterns: RegExp[]): Promise<Locator | null> {
  for (const pattern of patterns) {
    for (const locator of [
      scope.getByRole("button", { name: pattern }).first(),
      scope.getByRole("link", { name: pattern }).first(),
      scope.locator("button, a, input[type='button'], input[type='submit']").filter({ hasText: pattern }).first()
    ]) {
      if (await locator.isVisible({ timeout: 800 }).catch(() => false)) return locator;
    }
  }
  return null;
}

async function fillControl(activePage: Page, target: Locator, value: string): Promise<void> {
  await target.scrollIntoViewIfNeeded().catch(() => undefined);
  const tagName = await target.evaluate((node) => node.tagName.toLowerCase()).catch(() => "");
  const isContentEditable = await target.evaluate((node) => (node as HTMLElement).isContentEditable).catch(() => false);
  if (tagName === "select") {
    await target.selectOption({ label: value }).catch(async () => target.selectOption({ value }).catch(() => undefined));
    return;
  }
  if (isContentEditable) {
    await target.evaluate((node, text) => {
      const element = node as HTMLElement;
      element.innerText = text;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
    return;
  }
  await target.click({ timeout: 5000 });
  await activePage.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => undefined);
  await activePage.keyboard.insertText(value);
  await target.evaluate((node) => {
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    node.dispatchEvent(new Event("blur", { bubbles: true }));
  });
}

async function getControlValue(target: Locator): Promise<string> {
  return target
    .evaluate((node) => {
      const element = node as HTMLInputElement | HTMLTextAreaElement | HTMLElement;
      if ("value" in element) return String(element.value ?? "").trim();
      return (element.innerText || element.textContent || "").trim();
    })
    .catch(() => "");
}

async function assertLoggedIn(activePage: Page, step: string, expectedUrl?: string): Promise<void> {
  if (await detectLoginPage(activePage)) {
    throw buildPeriodicSessionError(activePage, step, expectedUrl);
  }
  updateSkpSessionStatus("connected", "Terhubung ke SKP");
  setSkpSessionStatusMemory("connected");
}

async function detectLoginPage(activePage: Page): Promise<boolean> {
  const url = activePage.url().toLowerCase();
  if (isLoginJspUrl(url) || /login|signin/.test(url)) return true;
  const body = await activePage.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  return /login non portal|masuk|username|password|kata sandi/i.test(body) && !/realisasi|umpan balik|log harian/i.test(body);
}

async function dismissBrowserPopups(activePage: Page): Promise<void> {
  await activePage.keyboard.press("Escape").catch(() => undefined);
  for (const pattern of [/tutup/i, /close/i, /ok/i, /mengerti/i]) {
    const button = activePage.getByRole("button", { name: pattern }).first();
    if (await button.isVisible({ timeout: 500 }).catch(() => false)) {
      await button.click({ timeout: 2000 }).catch(() => undefined);
      break;
    }
  }
}

async function isSelectElement(locator: Locator): Promise<boolean> {
  return (await locator.evaluate((node) => node.tagName.toLowerCase() === "select").catch(() => false)) === true;
}

function scopeToPage(scope: FieldScope): Page {
  return "keyboard" in scope ? scope : scope.page();
}

function buildPeriodicDetails(expectedUrl?: string, activePage?: Page, extra: Partial<PeriodicErrorDetails> = {}): PeriodicErrorDetails {
  const activeContext = getActiveSkpContext();
  const origin = activePage ? getActivePageOrigin(activePage) : getPeriodicBaseUrl();
  return {
    baseUrl: origin,
    origin,
    targetUrl: expectedUrl,
    expectedUrl,
    currentUrl: activePage?.url(),
    usingActiveContext: Boolean(activeContext && activePage && activePage.context() === activeContext),
    ...extra
  };
}

function buildPeriodicSessionError(activePage: Page, step: string, expectedUrl?: string): PeriodicAutomationError {
  updateSkpSessionStatus("expired", "Session SKP belum aktif di halaman periodik.");
  setSkpSessionStatusMemory("expired");
  return new PeriodicAutomationError(
    "PERIODIC_SESSION_NOT_CARRIED",
    "Session SKP tidak aktif. Silakan login ulang.",
    activePage.url(),
    step,
    buildPeriodicDetails(expectedUrl, activePage)
  );
}

function isSessionStopError(error: PeriodicAutomationError): boolean {
  return ["LOGIN_REQUIRED", "SESSION_EXPIRED", "PERIODIC_SESSION_NOT_CARRIED"].includes(error.code);
}

function isNavigationStopError(error: PeriodicAutomationError): boolean {
  return [
    "PERIODIC_FAILED_NAVIGATION",
    "PERIODIC_SUBMENU_NOT_FOUND",
    "PERIODIC_URL_MISMATCH",
    "PERIODIC_WRONG_TAHUNAN_PAGE",
    "PERIODIC_PAGE_TITLE_MISMATCH"
  ].includes(error.code);
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

function isSkpTahunanUrl(value: string): boolean {
  const lower = value.toLowerCase();
  try {
    return new URL(value).pathname.toLowerCase().includes("/skp/pegawai/skpkualitatif");
  } catch {
    return lower.includes("/skp/pegawai/skpkualitatif");
  }
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

async function capturePeriodicScreenshot(code: string): Promise<string | undefined> {
  if (!periodicPage || periodicPage.isClosed()) return undefined;
  const safeCode = code.replace(/[^a-z0-9-]/gi, "_");
  const dir = join(getDataDir(), "screenshots", "periodic");
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}_${safeCode}.png`);
  await periodicPage.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

function buildRunMessage(input: {
  filledCount: number;
  existingCount: number;
  skippedCount: number;
  failedCount: number;
  submitted: boolean;
  submitState: PeriodicSubmitState;
}): string {
  const parts: string[] = [];
  const done = input.filledCount + input.existingCount;
  if (done > 0) {
    if (input.existingCount > 0 && input.filledCount > 0) {
      parts.push(`${done} SKP terisi (${input.filledCount} baru diisi, ${input.existingCount} sudah ada isian)`);
    } else if (input.existingCount > 0) {
      parts.push(`${input.existingCount} SKP sudah terisi`);
    } else {
      parts.push(`${input.filledCount} SKP berhasil diisi`);
    }
  }
  if (input.skippedCount > 0) parts.push(`${input.skippedCount} dilewati`);
  if (input.failedCount > 0) parts.push(`${input.failedCount} gagal`);

  const base = parts.length > 0 ? `${parts.join(", ")}.` : "Tidak ada SKP yang diproses.";

  switch (input.submitState) {
    case "submitted":
      return `${base} SKP Periodik berhasil diajukan.`;
    case "already_submitted":
      return `${base} SKP Periodik sudah diajukan sebelumnya.`;
    case "button_not_found":
      return `${base} Tombol Ajukan tidak ditemukan/belum tersedia — silakan ajukan manual bila perlu.`;
    case "button_disabled":
      return `${base} Tombol Ajukan belum aktif, pastikan seluruh item lengkap.`;
    case "not_ready":
      return `${base} Pengajuan perlu dicek di website.`;
    default:
      return base;
  }
}

function tidyPeriodicMessage(message: string): string {
  if (/Salah halaman|SKP Tahunan|Rencana SKP|skpkualitatif/i.test(message)) {
    return "Salah halaman: masuk SKP Tahunan/Rencana SKP, bukan SKP Periodik.";
  }
  if (/Submenu Triwulan pada SKP Periodik tidak ditemukan/i.test(message)) {
    return "Submenu Triwulan pada SKP Periodik tidak ditemukan.";
  }
  if (/Modal.+Isi Realisasi Periodik.+tidak terbuka|tidak terbuka setelah tombol edit/i.test(message)) {
    return "Modal Isi Realisasi Periodik tidak terbuka setelah klik tombol edit.";
  }
  if (/Kolom Realisasi.+modal/i.test(message)) {
    return "Kolom Realisasi tidak ditemukan di dalam modal Isi Realisasi Periodik.";
  }
  if (/Tombol edit hijau|Isi Realisasi.+tidak ditemukan untuk SKP/i.test(message)) {
    return "Tombol edit hijau Isi Realisasi tidak ditemukan untuk SKP ini. Pastikan Hasil Kerja/Indikator sudah muncul di halaman triwulan.";
  }
  if (/PERIODIC_SESSION_NOT_CARRIED|tidak terbawa ke halaman periodik|halaman periodik|Session SKP tidak aktif/i.test(message)) {
    return "Session SKP tidak aktif. Silakan login ulang.";
  }
  if (/LOGIN_REQUIRED|Perlu login SKP/i.test(message)) return "Perlu login SKP.";
  if (/form.+periodik.+tidak.+ditemukan|PERIODIC_FORM_NOT_FOUND/i.test(message)) {
    return "Form SKP Periodik tidak ditemukan. Silakan buka website SKP dan cek apakah menu/format berubah.";
  }
  if (/session|login|required/i.test(message)) return "Perlu login SKP. Session SKP sudah kedaluwarsa atau belum aktif.";
  return message || "Proses SKP Periodik belum berhasil.";
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeCssAttribute(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildAttributeSelector(selector: string, token: string): string {
  const safeToken = escapeCssAttribute(token);
  const controls = selector.split(",").map((item) => item.trim()).filter(Boolean);
  const attributes = ["name", "id", "placeholder", "aria-label"];
  return controls
    .flatMap((control) => attributes.map((attribute) => `${control}[${attribute}*="${safeToken}" i]`))
    .join(", ");
}

class PeriodicAutomationError extends Error {
  constructor(
    public code: string,
    message: string,
    public currentUrl?: string,
    public step?: string,
    public details: PeriodicErrorDetails = {}
  ) {
    super(message);
  }
}
