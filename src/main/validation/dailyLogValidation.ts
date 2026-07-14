import { fetchSkpDropdownOptions } from "../automation/skpAutomation";
import { findBestSkpOption, type SkpOptionCandidate } from "../automation/skpMatching";
import {
  getActivePeriod,
  getDailyLog,
  getDb,
  updateDailyLogValidationStatus
} from "../db/database";
import type { DailyLog } from "../types";

export type DailyLogRevalidationResult = {
  ok: boolean;
  log: DailyLog | null;
  status_local: "valid" | "needs_review";
  reason_type: string | null;
  reason_note: string | null;
  available_skp_options?: string[];
};

export async function revalidateDailyLog(
  logOrId: DailyLog | string,
  options: { checkSiteMapping?: boolean } = {}
): Promise<DailyLogRevalidationResult> {
  const log = typeof logOrId === "string" ? getDailyLog(logOrId) : logOrId;
  if (!log) {
    return { ok: false, log: null, status_local: "needs_review", reason_type: "not_found", reason_note: "Log tidak ditemukan." };
  }

  const localIssue = validateRequiredFields(log);
  if (localIssue) {
    const updated = updateDailyLogValidationStatus(log.id, "needs_review", localIssue.type, localIssue.note) ?? log;
    return { ok: false, log: updated, status_local: "needs_review", reason_type: localIssue.type, reason_note: localIssue.note };
  }

  if (options.checkSiteMapping) {
    const siteMapping = getSiteMapping(log);
    const siteOptions = await fetchSkpDropdownOptions();
    const match = findBestSkpOption(log, siteOptions, siteMapping);
    if (!match) {
      const availableOptions = siteOptions.filter((item) => item.text).map((item) => item.text);
      const updated =
        updateDailyLogValidationStatus(log.id, "needs_review", "mapping_skp", "SKP tidak bisa dimapping ke dropdown website.") ?? log;
      return {
        ok: false,
        log: updated,
        status_local: "needs_review",
        reason_type: "mapping_skp",
        reason_note: "SKP tidak bisa dimapping ke dropdown website.",
        available_skp_options: availableOptions
      };
    }
  }

  const updated = updateDailyLogValidationStatus(log.id, "valid", null, null) ?? log;
  return { ok: true, log: updated, status_local: "valid", reason_type: null, reason_note: null };
}

function validateRequiredFields(log: DailyLog): { type: string; note: string } | null {
  if (!isValidDateKey(log.tanggal)) return { type: "tanggal", note: "Tanggal kosong atau tidak valid." };
  if (!log.nama_aktivitas?.trim()) return { type: "nama_aktivitas", note: "Nama aktivitas wajib diisi." };
  if ((log.deskripsi ?? "").trim().length < 10) return { type: "deskripsi", note: "Deskripsi minimal 10 karakter." };
  if (!log.kode_skp?.trim() && !log.nama_skp?.trim()) return { type: "mapping_skp", note: "SKP wajib diisi." };

  if (log.kode_skp) {
    const skp = getDb()
      .prepare("SELECT 1 FROM skp_items WHERE period_id = ? AND kode_skp = ?")
      .get(log.period_id || getActivePeriod().id, log.kode_skp);
    if (!skp && !log.nama_skp?.trim()) return { type: "mapping_skp", note: "SKP tidak ditemukan di master lokal." };
  }

  return null;
}

function getSiteMapping(log: DailyLog): SkpOptionCandidate | null {
  if (!log.kode_skp) return null;
  const mapping = getDb()
    .prepare("SELECT site_option_text, site_option_value, match_status FROM skp_site_mappings WHERE period_id = ? AND kode_skp = ?")
    .get(log.period_id || getActivePeriod().id, log.kode_skp) as
    | { site_option_text?: string | null; site_option_value?: string | null; match_status?: string | null }
    | undefined;
  if (mapping?.match_status && ["matched", "partial", "manual"].includes(mapping.match_status) && (mapping.site_option_text || mapping.site_option_value)) {
    return { text: mapping.site_option_text ?? null, value: mapping.site_option_value ?? null };
  }
  return null;
}

function isValidDateKey(value?: string | null): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
