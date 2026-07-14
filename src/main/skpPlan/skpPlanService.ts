import ExcelJS from "exceljs";
import pdfParse from "pdf-parse";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { getActivePeriod, getDataDir, listSkpItems, saveSkpPlanAsMaster } from "../db/database";
import type { ParsedSkpItem, ParsedSkpProfile, SkpPlanParseResult, SkpPlanSummary } from "../types";

const MONTHS: Record<string, string> = {
  januari: "01",
  februari: "02",
  maret: "03",
  april: "04",
  mei: "05",
  juni: "06",
  juli: "07",
  agustus: "08",
  september: "09",
  oktober: "10",
  november: "11",
  desember: "12"
};

export async function parseSkpPlanPdf(filePath: string, originalName?: string): Promise<SkpPlanParseResult> {
  const data = await pdfParse(readFileSync(filePath));
  const text = normalizePdfText(data.text);
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (!/sasaran kinerja pegawai/i.test(text)) {
    throw new Error("Format Rencana SKP belum terbaca. Silakan cek file PDF atau input manual master SKP.");
  }

  const profile = parseProfile(text, lines);
  const skpItems = parseSkpItems(text, lines, profile.tahun);
  const warnings: string[] = [];
  if (!profile.nama) warnings.push("Nama pegawai belum terbaca.");
  if (!profile.nip) warnings.push("NIP belum terbaca.");
  if (!profile.periodeMulai || !profile.periodeAkhir) warnings.push("Periode SKP belum terbaca lengkap.");
  if (skpItems.length === 0) {
    throw new Error("Format Rencana SKP belum terbaca. Silakan cek file PDF atau input manual master SKP.");
  }

  return {
    ok: true,
    fileName: originalName ?? basename(filePath),
    profile,
    skpItems,
    warnings
  };
}

export function saveParsedSkpPlan(plan: SkpPlanParseResult): SkpPlanSummary {
  return saveSkpPlanAsMaster(plan);
}

export async function exportActiveMasterSkpExcel(): Promise<{ ok: true; filePath: string; totalRows: number }> {
  const period = getActivePeriod();
  const rows = listSkpItems();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "KaemSKP";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(`Master_SKP_${period.year}`);
  sheet.columns = [
    { header: "kode_skp", key: "kode_skp", width: 16 },
    { header: "nomor_skp", key: "nomor_skp", width: 12 },
    { header: "nama_skp", key: "nama_skp", width: 70 },
    { header: "indikator_kinerja_individu", key: "indikator_kinerja_individu", width: 70 },
    { header: "tahun", key: "tahun", width: 10 },
    { header: "periode_mulai", key: "periode_mulai", width: 16 },
    { header: "periode_akhir", key: "periode_akhir", width: 16 },
    { header: "status_mapping", key: "status_mapping", width: 16 }
  ];
  sheet.getRow(1).font = { bold: true };

  for (const item of rows) {
    const indikator = parseIndicatorJson(item.indikator_json);
    sheet.addRow({
      kode_skp: item.kode_skp,
      nomor_skp: Number(item.kode_skp.match(/(\d+)$/)?.[1] ?? 0),
      nama_skp: item.nama_skp,
      indikator_kinerja_individu: indikator.join("\n"),
      tahun: period.year,
      periode_mulai: period.start_date,
      periode_akhir: period.end_date,
      status_mapping: "needs_review"
    });
  }

  const filePath = join(getDataDir(), "exports", `Master_SKP_${period.year}.xlsx`);
  await workbook.xlsx.writeFile(filePath);
  return { ok: true, filePath, totalRows: rows.length };
}

function parseProfile(text: string, lines: string[]): ParsedSkpProfile {
  const period = parsePeriod(text);
  const tahun = Number(period.start?.slice(0, 4) || period.end?.slice(0, 4) || new Date().getFullYear());
  return {
    nama: findLabeledValue(lines, ["Nama", "Nama Pegawai"]) || "",
    nip: findLabeledValue(lines, ["NIP", "NIP/NRK", "NIP / Username"]) || "",
    jabatan: findLabeledValue(lines, ["Jabatan"]) || "",
    unitKerja: findLabeledValue(lines, ["Unit Kerja", "Unit Organisasi"]) || "",
    periodeMulai: period.start || `${tahun}-01-01`,
    periodeAkhir: period.end || `${tahun}-12-31`,
    tahun
  };
}

function parsePeriod(text: string): { start: string | null; end: string | null } {
  const match = text.match(/(\d{1,2})\s+(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+(\d{4})\s+s\/d\s+(\d{1,2})\s+(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+(\d{4})/i);
  if (!match) return { start: null, end: null };
  return {
    start: toIsoDate(match[1], match[2], match[3]),
    end: toIsoDate(match[4], match[5], match[6])
  };
}

function findLabeledValue(lines: string[], labels: string[]): string | null {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const inline = lines.find((line) => new RegExp(`^${escaped}\\s*[:：]?\\s+(.+)$`, "i").test(line));
    const inlineMatch = inline?.match(new RegExp(`^${escaped}\\s*[:：]?\\s+(.+)$`, "i"));
    if (inlineMatch?.[1]) return cleanIdentityValue(inlineMatch[1]);

    const index = lines.findIndex((line) => new RegExp(`^${escaped}\\s*[:：]?$`, "i").test(line));
    if (index >= 0) {
      const value = lines[index + 1];
      if (value && !looksLikeLabel(value)) return cleanIdentityValue(value);
    }
  }
  return null;
}

function parseSkpItems(text: string, lines: string[], year: number): ParsedSkpItem[] {
  const startIndex = Math.max(
    lines.findIndex((line) => /^A\.\s*Utama/i.test(line)),
    lines.findIndex((line) => /HASIL KERJA/i.test(line))
  );
  const sectionLines = startIndex >= 0 ? lines.slice(startIndex + 1) : lines;
  const result = parseSkpItemsFromLines(sectionLines, year);
  if (result.length > 0) return result;
  return parseSkpItemsFromText(text, year);
}

function parseSkpItemsFromLines(lines: string[], year: number): ParsedSkpItem[] {
  const items: Array<{ nomor: number; nameParts: string[]; indicators: string[]; inIndicators: boolean }> = [];
  let current: Array<{ nomor: number; nameParts: string[]; indicators: string[]; inIndicators: boolean }>[number] | null = null;

  for (const rawLine of lines) {
    const line = cleanSkpLine(rawLine);
    if (!line) continue;
    if (/^(B\.\s*Tambahan|PERILAKU KERJA|LAMPIRAN|PEJABAT PENILAI)/i.test(line)) break;

    const numberMatch = line.match(/^(\d{1,2})[\).]\s*(.+)?$/);
    if (numberMatch && !/^\d{1,2}\s+(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)/i.test(line)) {
      current = { nomor: Number(numberMatch[1]), nameParts: [], indicators: [], inIndicators: false };
      items.push(current);
      if (numberMatch[2]) current.nameParts.push(numberMatch[2]);
      continue;
    }

    if (!current) continue;
    if (/ukuran keberhasilan|indikator kinerja|target/i.test(line)) {
      current.inIndicators = true;
      const afterColon = line.split(/[:：]/).slice(1).join(":").trim();
      if (afterColon && !/target$/i.test(afterColon)) current.indicators.push(afterColon);
      continue;
    }

    if (current.inIndicators) {
      if (looksLikeIndicator(line)) current.indicators.push(stripBullet(line));
      else if (current.indicators.length > 0) current.indicators[current.indicators.length - 1] += ` ${line}`;
      continue;
    }

    current.nameParts.push(line);
  }

  return items
    .map((item, index) => toParsedSkpItem(item.nomor || index + 1, item.nameParts.join(" "), item.indicators, year))
    .filter((item) => item.nama_skp.length > 0);
}

function parseSkpItemsFromText(text: string, year: number): ParsedSkpItem[] {
  const section = text.split(/A\.\s*Utama/i)[1] ?? text.split(/HASIL KERJA/i)[1] ?? "";
  const result: ParsedSkpItem[] = [];
  const pattern = /(?:^|\n)\s*(\d{1,2})[\).]\s+([\s\S]*?)(?=\n\s*\d{1,2}[\).]\s+|\n\s*B\.\s*Tambahan|\n\s*PERILAKU KERJA|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(section)) !== null) {
    const nomor = Number(match[1]);
    const block = match[2].replace(/\s+/g, " ").trim();
    const [namePart, indicatorPart = ""] = block.split(/Ukuran keberhasilan|Indikator Kinerja Individu|Target/i);
    const indicators = indicatorPart
      .split(/(?:\s[-•*]\s|\s[a-z]\.\s|\s\d+\)\s)/i)
      .map((item) => cleanSkpLine(item))
      .filter((item) => item.length > 8);
    result.push(toParsedSkpItem(nomor, namePart, indicators, year));
  }
  return result.filter((item) => item.nama_skp.length > 0);
}

function toParsedSkpItem(nomor: number, namaSkp: string, indikator: string[], year: number): ParsedSkpItem {
  const cleanedIndicators = Array.from(new Set(indikator.map((item) => cleanSkpLine(stripBullet(item))).filter((item) => item.length > 4)));
  return {
    kode_skp: `SKP-${year}-${String(nomor).padStart(2, "0")}`,
    nomor,
    nama_skp: cleanSkpLine(namaSkp),
    indikator: cleanedIndicators
  };
}

function normalizePdfText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
}

function toIsoDate(day: string, month: string, year: string): string {
  return `${year}-${MONTHS[month.toLowerCase()] ?? "01"}-${day.padStart(2, "0")}`;
}

function cleanIdentityValue(value: string): string {
  return value.replace(/^[:：\-\s]+/, "").replace(/\s{2,}/g, " ").trim();
}

function cleanSkpLine(value: string): string {
  return value.replace(/^[:：\-\s]+/, "").replace(/\s{2,}/g, " ").trim();
}

function stripBullet(value: string): string {
  return value.replace(/^[-•*]\s*/, "").replace(/^[a-z]\.\s*/i, "").replace(/^\d+\)\s*/, "").trim();
}

function looksLikeIndicator(value: string): boolean {
  return /^[-•*]\s+/.test(value) || /^[a-z]\.\s+/i.test(value) || /^\d+\)\s+/.test(value) || value.length > 14;
}

function looksLikeLabel(value: string): boolean {
  return /^(nama|nip|jabatan|unit kerja|pangkat|golongan|hasil kerja|indikator)\b/i.test(value);
}

function parseIndicatorJson(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}
