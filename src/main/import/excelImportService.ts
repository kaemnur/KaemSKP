import ExcelJS from "exceljs";
import { basename } from "node:path";
import { randomUUID } from "node:crypto";
import type * as ExcelJSTypes from "exceljs";
import { getActivePeriod, getDb, listSkpItems } from "../db/database";
import type { DailyLog, ImportPreview, ImportPreviewRow, SkpItem } from "../types";
import { toDateKey } from "../utils/date";

const REQUIRED_HEADERS = [
  "tanggal",
  "nama aktivitas",
  "deskripsi",
  "sasaran kinerja pegawai (skp)",
  "indikator kinerja individu",
  "kuantitas output",
  "satuan",
  "link / tautan"
];

const HEADER_ALIASES: Record<string, string> = {
  tanggal: "tanggal",
  "nama aktivitas": "nama_aktivitas",
  deskripsi: "deskripsi",
  "sasaran kinerja pegawai (skp)": "nama_skp",
  skp: "nama_skp",
  kode_skp: "kode_skp",
  "indikator kinerja individu": "indikator_kinerja_individu",
  indikator: "indikator_kinerja_individu",
  "kuantitas output": "kuantitas_output",
  satuan: "satuan",
  "link / tautan": "link_tautan",
  link: "link_tautan",
  tautan: "link_tautan",
  kode_log: "kode_log"
};

export async function previewExcelImport(filePath: string, originalFileName?: string): Promise<ImportPreview> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const period = getActivePeriod();
  const sheet = pickWorksheet(workbook, period.year);
  if (!sheet) {
    throw new Error("Sheet import tidak ditemukan. Gunakan Log_Harian_Import, Log_Harian_2026, atau workbook satu sheet.");
  }

  const headerMap = readHeaderMap(sheet.getRow(1));
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !headerMap.has(HEADER_ALIASES[header]));
  if (missingHeaders.length > 0) {
    throw new Error(`Kolom wajib tidak ditemukan: ${missingHeaders.join(", ")}.`);
  }

  const skpItems = listSkpItems();
  const sequenceByDate = new Map<string, number>();
  const seenCodes = new Set<string>();
  const rows: ImportPreviewRow[] = [];

  sheet.eachRow((worksheetRow, rowNumber) => {
    if (rowNumber === 1) return;
    const raw = readRow(worksheetRow, headerMap);
    if (!raw.tanggal && !raw.nama_aktivitas && !raw.deskripsi && !raw.nama_skp) return;

    const validation = validateImportRow(raw, skpItems, period.start_date, period.end_date);
    if (validation.data.tanggal && !validation.data.kode_log) {
      const sequence = (sequenceByDate.get(validation.data.tanggal) ?? 0) + 1;
      sequenceByDate.set(validation.data.tanggal, sequence);
      validation.data.kode_log = `LOG-${validation.data.tanggal}-${String(sequence).padStart(2, "0")}`;
    }

    const duplicateInFile = Boolean(validation.data.kode_log && seenCodes.has(validation.data.kode_log));
    if (validation.data.kode_log) seenCodes.add(validation.data.kode_log);

    const existing = validation.data.kode_log
      ? (getDb()
          .prepare("SELECT * FROM daily_logs WHERE period_id = ? AND kode_log = ?")
          .get(period.id, validation.data.kode_log) as DailyLog | undefined)
      : undefined;

    let status: ImportPreviewRow["status"] = "Baru";
    if (duplicateInFile) {
      status = "Duplikat";
      validation.errors.push("Kode log duplikat dalam file.");
    } else if (validation.errors.length > 0) {
      status = "Tidak Valid";
    } else if (validation.reviewNotes.length > 0) {
      status = "Perlu Review";
    } else if (existing) {
      status = isSameLog(existing, validation.data) ? "Sama" : "Berubah";
    }

    rows.push({
      rowNumber,
      status,
      errors: validation.errors,
      notes: validation.reviewNotes,
      data: validation.data
    });
  });

  const dates = rows.map((row) => row.data.tanggal).filter(Boolean).sort() as string[];
  return {
    id: randomUUID(),
    filePath,
    fileName: originalFileName ?? basename(filePath),
    sheetName: sheet.name,
    totalRows: rows.length,
    validRows: rows.filter((row) => !["Tidak Valid", "Perlu Review", "Duplikat"].includes(row.status)).length,
    reviewRows: rows.filter((row) => row.status === "Perlu Review").length,
    newRows: rows.filter((row) => row.status === "Baru" || row.status === "Perlu Review").length,
    changedRows: rows.filter((row) => row.status === "Berubah").length,
    unchangedRows: rows.filter((row) => row.status === "Sama").length,
    invalidRows: rows.filter((row) => row.status === "Tidak Valid").length,
    duplicateRows: rows.filter((row) => row.status === "Duplikat").length,
    periodStart: dates[0] ?? null,
    periodEnd: dates[dates.length - 1] ?? null,
    rows
  };
}

function pickWorksheet(workbook: ExcelJS.Workbook, year: number): ExcelJSTypes.Worksheet | undefined {
  return (
    workbook.getWorksheet("Log_Harian_Import") ??
    workbook.getWorksheet(`Log_Harian_${year}`) ??
    (workbook.worksheets.length === 1 ? workbook.worksheets[0] : undefined)
  );
}

function readHeaderMap(row: ExcelJSTypes.Row): Map<string, number> {
  const headerMap = new Map<string, number>();
  row.eachCell((cell, colNumber) => {
    const key = normalizeHeader(String(cell.value ?? ""));
    const mapped = HEADER_ALIASES[key];
    if (mapped) headerMap.set(mapped, colNumber);
  });
  return headerMap;
}

function readRow(row: ExcelJSTypes.Row, headerMap: Map<string, number>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of Object.values(HEADER_ALIASES)) {
    const col = headerMap.get(key);
    if (!col) continue;
    result[key] = normalizeCellValue(row.getCell(col));
  }
  return result;
}

function validateImportRow(
  raw: Record<string, string>,
  skpItems: SkpItem[],
  periodStart: string,
  periodEnd: string
): { errors: string[]; reviewNotes: string[]; data: ImportPreviewRow["data"] } {
  const errors: string[] = [];
  const reviewNotes: string[] = [];
  const tanggal = normalizeDate(raw.tanggal);
  const matchedSkp = matchSkp(raw.kode_skp || raw.nama_skp, skpItems);

  if (!tanggal) errors.push("Tanggal tidak valid.");
  if (tanggal && (tanggal < periodStart || tanggal > periodEnd)) errors.push("Tanggal berada di luar periode aktif.");
  if (!raw.nama_aktivitas?.trim()) errors.push("Nama aktivitas wajib diisi.");
  if (!raw.deskripsi?.trim() || raw.deskripsi.trim().length < 10) errors.push("Deskripsi minimal 10 karakter.");
  if (!raw.nama_skp?.trim() && !raw.kode_skp?.trim()) {
    errors.push("SKP wajib diisi.");
  } else if (!matchedSkp) {
    reviewNotes.push("SKP belum cocok dengan Rencana SKP aktif.");
  }

  const statusLocal = errors.length > 0 ? "invalid" : matchedSkp ? "valid" : "needs_review";
  const statusSkp = tanggal && tanggal > toDateKey() ? "waiting_date" : "not_submitted";

  return {
    errors,
    reviewNotes,
    data: {
      kode_log: raw.kode_log || undefined,
      tanggal: tanggal || "",
      kode_skp: matchedSkp?.kode_skp ?? null,
      nama_skp: matchedSkp?.nama_skp ?? raw.nama_skp ?? null,
      nama_aktivitas: raw.nama_aktivitas?.trim() || null,
      deskripsi: raw.deskripsi?.trim() || null,
      indikator_kinerja_individu: raw.indikator_kinerja_individu?.trim() || null,
      kuantitas_output: raw.kuantitas_output?.trim() || null,
      satuan: raw.satuan?.trim() || null,
      link_tautan: raw.link_tautan?.trim() || null,
      status_local: statusLocal,
      status_skp: statusSkp,
      reason_type: statusLocal === "needs_review" ? "mapping_skp" : null,
      reason_note: statusLocal === "needs_review" ? "SKP belum cocok dengan Rencana SKP aktif." : null,
      source_file: null,
      source_hash: null
    }
  };
}

function matchSkp(value: string | undefined, skpItems: SkpItem[]): SkpItem | undefined {
  const normalized = normalizeText(value ?? "");
  if (!normalized) return undefined;
  const byCode = skpItems.find((item) => item.kode_skp.toLowerCase() === normalized);
  if (byCode) return byCode;
  const byExactName = skpItems.find((item) => normalizeText(item.nama_skp) === normalized);
  if (byExactName) return byExactName;
  const byContains = skpItems.find((item) => {
    const name = normalizeText(item.nama_skp);
    return name.includes(normalized) || normalized.includes(name);
  });
  if (byContains) return byContains;
  const fuzzy = skpItems
    .map((item) => ({ item, score: fuzzyScore(value ?? "", item.nama_skp) }))
    .sort((left, right) => right.score - left.score)[0];
  return fuzzy && fuzzy.score >= 0.62 ? fuzzy.item : undefined;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fuzzyScore(left: string, right: string): number {
  const leftTokens = significantTokens(left);
  const rightTokens = significantTokens(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;
  const matched = leftTokens.filter((token) => rightTokens.includes(token)).length;
  return matched / Math.max(leftTokens.length, rightTokens.length);
}

function significantTokens(value: string): string[] {
  const ignored = new Set(["dan", "atau", "yang", "dengan", "dalam", "pada", "untuk", "data"]);
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 2 && !ignored.has(token));
}

function normalizeCellValue(cell: ExcelJSTypes.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return toDateKey(value);
  if (typeof value === "number") {
    if (cell.numFmt?.toLowerCase().includes("d") || value > 30000) return excelSerialToDate(value) ?? String(value);
    return String(value);
  }
  if (typeof value === "object") {
    if ("text" in value && value.text) return String(value.text).trim();
    if ("result" in value && value.result !== undefined) return normalizePrimitive(value.result as ExcelJSTypes.CellValue);
    if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("").trim();
    if ("hyperlink" in value && value.hyperlink) return String(value.hyperlink).trim();
  }
  return String(value).trim();
}

function normalizePrimitive(value: ExcelJSTypes.CellValue): string {
  if (value instanceof Date) return toDateKey(value);
  if (typeof value === "number") return excelSerialToDate(value) ?? String(value);
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeDate(value: string | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return excelSerialToDate(Number(trimmed)) ?? "";
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return toDateKey(parsed);
  const parts = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (parts) return `${parts[3]}-${parts[2].padStart(2, "0")}-${parts[1].padStart(2, "0")}`;
  return "";
}

function excelSerialToDate(serial: number): string | null {
  if (!Number.isFinite(serial)) return null;
  const utcDays = Math.floor(serial - 25569);
  const date = new Date(utcDays * 86400 * 1000);
  return toDateKey(date);
}

function isSameLog(existing: DailyLog, incoming: ImportPreviewRow["data"]): boolean {
  const fields: Array<keyof DailyLog> = [
    "tanggal",
    "kode_skp",
    "nama_skp",
    "nama_aktivitas",
    "deskripsi",
    "indikator_kinerja_individu",
    "kuantitas_output",
    "satuan",
    "link_tautan",
    "status_local",
    "status_skp",
    "reason_type",
    "reason_note"
  ];
  return fields.every((field) => (existing[field] ?? "") === ((incoming[field] as string | null | undefined) ?? ""));
}
