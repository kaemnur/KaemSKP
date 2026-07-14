const APP_TIME_ZONE = "Asia/Jakarta";

export function nowIso(): string {
  const now = new Date();
  return `${formatDatePart(now)}T${formatTimePart(now)}+07:00`;
}

export function toDateKey(date = new Date()): string {
  return formatDatePart(date);
}

export function getDayName(dateKey: string): string {
  return new Intl.DateTimeFormat("id-ID", { weekday: "long", timeZone: "UTC" }).format(dateKeyToUtcDate(dateKey));
}

export function formatLongDate(dateKey: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(dateKeyToUtcDate(dateKey));
}

export function eachDate(start: string, end: string): string[] {
  const dates: string[] = [];
  const cursor = dateKeyToUtcDate(start);
  const endDate = dateKeyToUtcDate(end);

  while (cursor <= endDate) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

export function isWeekend(dateKey: string): boolean {
  const day = dateKeyToUtcDate(dateKey).getUTCDay();
  return day === 0 || day === 6;
}

export function clampEndToToday(dateKey: string): string {
  const today = toDateKey();
  return dateKey > today ? today : dateKey;
}

export function formatDateTimeWIB(value?: string | Date | null): string {
  if (!value) return "-";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "-";
  return `${new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: APP_TIME_ZONE
  }).format(date).replace(/:/g, ".")} WIB`;
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

export function toDateInputValue(dateKey?: string | Date | null): string {
  if (!dateKey) return "";
  if (dateKey instanceof Date) {
    return formatDatePart(dateKey);
  }
  const value = dateKey.trim();
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
  return Number.isNaN(parsed.getTime()) ? "" : formatDatePart(parsed);
}

export function formatDateID(dateKey?: string | Date | null): string {
  if (!dateKey) return "";
  if (dateKey instanceof Date) {
    return formatDatePart(dateKey).split("-").reverse().join("/");
  }
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function formatDateWIB(dateKey?: string | null): string {
  if (!dateKey) return "-";
  return formatLongDate(dateKey);
}

function formatDatePart(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: APP_TIME_ZONE
  }).formatToParts(date);
  return `${part(parts, "year")}-${part(parts, "month")}-${part(parts, "day")}`;
}

function formatTimePart(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: APP_TIME_ZONE
  }).formatToParts(date);
  return `${part(parts, "hour")}:${part(parts, "minute")}:${part(parts, "second")}`;
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((item) => item.type === type)?.value ?? "";
}

function dateKeyToUtcDate(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1));
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day;
}
