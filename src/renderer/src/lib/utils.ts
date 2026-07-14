import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatDate(date?: string): string {
  return formatDateWIB(date);
}

export function parseDateID(input?: string | null): string {
  const value = (input ?? "").trim();
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return "";
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (!isValidDateParts(year, month, day)) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function toDateInputValue(date?: string | Date | null): string {
  if (!date) return "";
  if (date instanceof Date) {
    return formatDateKeyParts(date, "Asia/Jakarta");
  }
  const value = date.trim();
  const parsedId = parseDateID(value);
  if (parsedId) return parsedId;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    return isValidDateParts(year, month, day) ? `${match[1]}-${match[2]}-${match[3]}` : "";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : formatDateKeyParts(parsed, "Asia/Jakarta");
}

export function formatDateID(date?: string | Date | null): string {
  if (!date) return "";
  if (date instanceof Date) {
    return formatDateParts(date, "Asia/Jakarta");
  }
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function formatDateWIB(date?: string | null): string {
  if (!date) return "-";
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(value);
}

export function formatDateTimeWIB(date?: string | Date | null): string {
  if (!date) return "-";
  const value = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(value.getTime())) return "-";
  return `${new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Jakarta"
  }).format(value).replace(/:/g, ".")} WIB`;
}

export function formatRealtimeWIB(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Jakarta"
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((item) => item.type === type)?.value ?? "";
  const weekday = part("weekday");
  const day = part("day");
  const month = part("month");
  const year = part("year");
  const hour = part("hour");
  const minute = part("minute");
  const second = part("second");
  return `${capitalize(weekday)}, ${day} ${capitalize(month)} ${year} • ${hour}.${minute}.${second} WIB`;
}

export function todayDateKeyWIB(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Jakarta"
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function formatDateParts(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("day")}/${part("month")}/${part("year")}`;
}

function formatDateKeyParts(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day;
}

export function statusLabel(status?: string): string {
  const labels: Record<string, string> = {
    connected: "Terhubung ke SKP",
    not_logged_in: "Belum login",
    expired: "Perlu login ulang",
    checking: "Sedang mengecek",
    running: "Sedang Dikirim",
    error: "Gagal cek session",
    draft: "Draft",
    valid: "Valid",
    invalid: "Tidak Valid",
    needs_review: "Perlu Dicek",
    skipped: "Dilewati",
    holiday: "Libur",
    leave: "Cuti",
    no_plan: "Tidak Ada Rencana",
    not_submitted: "Belum Dikirim",
    waiting_date: "Menunggu Tanggal",
    ready: "Siap Dikirim",
    submitted: "Terkirim",
    failed_navigation: "Gagal Navigasi",
    failed: "Gagal",
    not_allowed_by_site: "Tidak Diizinkan Situs",
    duplicate_detected: "Duplikat",
    manual_marked_submitted: "Terkirim Manual",
    working_day: "Hari Kerja",
    weekend: "Weekend",
    public_holiday: "Tanggal Merah",
    sick_leave: "Sakit",
    has_log: "Siap Dikirim",
    missing: "Belum Ada Rencana Kerja",
    future: "Menunggu Tanggal",
    matched: "Cocok",
    partial: "Perlu Dicek",
    manual: "Manual",
    not_found: "Belum Dipetakan",
    queued: "Menunggu",
    no_log: "Belum Ada Log",
    login_required: "Perlu Login",
    success: "Berhasil",
    finished: "Selesai",
    finished_with_error: "Selesai dengan catatan",
    stopped: "Dihentikan",
    not_created: "Belum dibuat",
    preview_ready: "Preview siap",
    partially_filled: "Terisi sebagian",
    filled_all: "Terisi semua",
    ready_to_submit_manual: "Siap ajukan manual",
    submitted_periodic: "Diajukan",
    needs_check: "Perlu Dicek",
    no_logs: "Belum ada data log",
    existing: "Sudah ada isian",
    fill_submit: "Isi + Ajukan",
    fill: "Isi ke Website",
    preview: "Preview Saja"
  };
  return labels[status ?? ""] ?? status ?? "-";
}

export function statusClass(status?: string): string {
  if (["submitted", "submitted_periodic", "manual_marked_submitted", "connected", "matched", "success", "finished", "filled_all", "preview_ready"].includes(status ?? "")) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300";
  }
  if (["ready", "has_log", "running", "partial", "manual", "checking", "queued", "fill", "fill_submit", "ready_to_submit_manual"].includes(status ?? "")) {
    return "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300";
  }
  if (["failed", "not_allowed_by_site", "error", "expired"].includes(status ?? "")) {
    return "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300";
  }
  if (["invalid", "needs_review", "needs_check", "warning", "not_logged_in", "login_required", "not_found", "finished_with_error", "stopped", "partially_filled"].includes(status ?? "")) {
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300";
  }
  if (["weekend", "public_holiday", "holiday", "leave", "sick_leave", "no_plan", "skipped", "missing", "no_log", "no_logs", "not_created", "existing", "preview"].includes(status ?? "")) {
    return "border-gray-200 bg-gray-100 text-gray-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300";
  }
  return "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300";
}

export function friendlyErrorMessage(value?: string | null): { title: string; message: string; code?: string; detail?: string } {
  if (!value) return { title: "Tidak ada error", message: "Belum ada catatan error." };
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const message = String(parsed.error_message ?? parsed.message ?? "Proses belum berhasil.");
    const code = parsed.error_code ? String(parsed.error_code) : undefined;
    return {
      title: "Proses belum berhasil",
      message,
      code,
      detail: JSON.stringify(parsed, null, 2)
    };
  } catch {
    return { title: "Proses belum berhasil", message: value };
  }
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}
