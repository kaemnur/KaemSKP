export type AutoPostSettingsInput = {
  enabled?: boolean;
  postTime?: string;
  timezone?: string;
  activeWeekdays?: number[];
};

export type HolidayInput = {
  date: string;
  isActive?: boolean;
};

export type NextAutoPostResult = {
  nextAutoPostAt: string | null;
  targetDate: string | null;
  dayName: string | null;
  timeLabel: string;
  timezone: string;
  enabled: boolean;
};

const DEFAULT_TIME = "08:00";
const DEFAULT_TIMEZONE = "Asia/Jakarta";
const DEFAULT_WEEKDAYS = [1, 2, 3, 4, 5];
const WIB_OFFSET_HOURS = 7;

export function getNextAutoPostAt(now: Date, settings: AutoPostSettingsInput = {}, holidays: HolidayInput[] = []): NextAutoPostResult {
  const enabled = settings.enabled ?? true;
  const timezone = settings.timezone || DEFAULT_TIMEZONE;
  const postTime = normalizePostTime(settings.postTime);
  const activeWeekdays = new Set(settings.activeWeekdays?.length ? settings.activeWeekdays : DEFAULT_WEEKDAYS);

  if (!enabled) {
    return {
      nextAutoPostAt: null,
      targetDate: null,
      dayName: null,
      timeLabel: `${postTime} WIB`,
      timezone,
      enabled
    };
  }

  const holidayDates = new Set(
    holidays
      .filter((holiday) => holiday.isActive !== false)
      .map((holiday) => holiday.date.slice(0, 10))
      .filter(Boolean)
  );
  const nowParts = toWibParts(now);
  let candidate = nowParts.dateKey;
  const todayTarget = dateKeyTimeToUtcDate(candidate, postTime);

  if (now.getTime() >= todayTarget.getTime()) {
    candidate = addDays(candidate, 1);
  }

  for (let guard = 0; guard < 370; guard += 1) {
    if (isActiveWorkday(candidate, activeWeekdays) && !holidayDates.has(candidate)) {
      const target = dateKeyTimeToUtcDate(candidate, postTime);
      return {
        nextAutoPostAt: target.toISOString(),
        targetDate: candidate,
        dayName: formatDayName(candidate),
        timeLabel: `${postTime} WIB`,
        timezone,
        enabled
      };
    }
    candidate = addDays(candidate, 1);
  }

  throw new Error("Tidak dapat menghitung jadwal Auto Post berikutnya dalam 370 hari.");
}

function normalizePostTime(value?: string): string {
  const match = (value || DEFAULT_TIME).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return DEFAULT_TIME;
  const hour = Math.min(23, Math.max(0, Number(match[1]) || 0));
  const minute = Math.min(59, Math.max(0, Number(match[2]) || 0));
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function isActiveWorkday(dateKey: string, activeWeekdays: Set<number>): boolean {
  const day = dateKeyToUtcDate(dateKey).getUTCDay();
  return activeWeekdays.has(day);
}

function toWibParts(date: Date): { dateKey: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DEFAULT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  return {
    dateKey: `${part(parts, "year")}-${part(parts, "month")}-${part(parts, "day")}`
  };
}

function dateKeyTimeToUtcDate(dateKey: string, time: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour - WIB_OFFSET_HOURS, minute, 0, 0));
}

function addDays(dateKey: string, days: number): string {
  const date = dateKeyToUtcDate(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateKeyToUtcDate(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1));
}

function formatDayName(dateKey: string): string {
  return new Intl.DateTimeFormat("id-ID", { weekday: "long", timeZone: "UTC" }).format(dateKeyToUtcDate(dateKey));
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((item) => item.type === type)?.value ?? "";
}
