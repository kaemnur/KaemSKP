import type { SupabaseClient } from "@supabase/supabase-js";

export type HolidayInput = {
  holiday_date?: string;
  date?: string;
  name?: string;
  is_joint_leave?: boolean;
  isJointLeave?: boolean;
  source?: string | null;
  is_active?: boolean;
  isActive?: boolean;
};

export async function listHolidays(supabase: SupabaseClient, userId: string): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabase
    .from("holidays")
    .select("*")
    .eq("user_id", userId)
    .order("holiday_date", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createHoliday(supabase: SupabaseClient, userId: string, input: HolidayInput): Promise<Record<string, unknown>> {
  const row = normalizeHolidayInput(userId, input);
  const { data, error } = await supabase.from("holidays").insert(row).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateHoliday(supabase: SupabaseClient, userId: string, id: string, input: HolidayInput): Promise<Record<string, unknown>> {
  const row = normalizeHolidayInput(userId, input, true);
  const { data, error } = await supabase.from("holidays").update(row).eq("user_id", userId).eq("id", id).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteHoliday(supabase: SupabaseClient, userId: string, id: string): Promise<{ ok: true; id: string }> {
  const { error } = await supabase.from("holidays").delete().eq("user_id", userId).eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true, id };
}

export async function importHolidays(supabase: SupabaseClient, userId: string, raw: string, format?: string): Promise<{ ok: true; imported: number; rows: Record<string, unknown>[] }> {
  const items = parseHolidayImport(raw, format).map((item) => normalizeHolidayInput(userId, item));
  if (items.length === 0) return { ok: true, imported: 0, rows: [] };
  const { data, error } = await supabase.from("holidays").upsert(items, { onConflict: "user_id,holiday_date,name" }).select("*");
  if (error) throw new Error(error.message);
  return { ok: true, imported: data?.length ?? 0, rows: data ?? [] };
}

export function parseHolidayImport(raw: string, format?: string): HolidayInput[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (format === "json" || trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : Array.isArray(parsed.holidays) ? parsed.holidays : [parsed];
  }
  return parseCsv(trimmed);
}

function parseCsv(raw: string): HolidayInput[] {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]).map((item) => item.toLowerCase().trim());
  const hasHeader = headers.some((item) => ["date", "holiday_date", "name", "source"].includes(item));
  const dataLines = hasHeader ? lines.slice(1) : lines;
  return dataLines.map((line) => {
    const values = splitCsvLine(line);
    if (hasHeader) {
      const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
      return {
        holiday_date: row.holiday_date || row.date,
        name: row.name,
        source: row.source,
        is_joint_leave: toBoolean(row.is_joint_leave || row.isjointleave),
        is_active: row.is_active === "" ? true : toBoolean(row.is_active)
      };
    }
    return { holiday_date: values[0], name: values[1], source: values[2], is_joint_leave: toBoolean(values[3]), is_active: values[4] ? toBoolean(values[4]) : true };
  });
}

function splitCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

function normalizeHolidayInput(userId: string, input: HolidayInput, partial = false): Record<string, unknown> {
  const date = (input.holiday_date ?? input.date ?? "").slice(0, 10);
  const name = String(input.name ?? "").trim();
  if (!partial || date) assertDate(date);
  if (!partial && !name) throw new Error("Nama libur wajib diisi.");
  const row: Record<string, unknown> = {
    user_id: userId,
    updated_at: new Date().toISOString()
  };
  if (date) row.holiday_date = date;
  if (name) row.name = name;
  if (input.is_joint_leave !== undefined || input.isJointLeave !== undefined) row.is_joint_leave = Boolean(input.is_joint_leave ?? input.isJointLeave);
  if (input.source !== undefined) row.source = input.source || null;
  if (input.is_active !== undefined || input.isActive !== undefined) row.is_active = Boolean(input.is_active ?? input.isActive);
  if (!partial) {
    row.name = name || "Libur";
    row.is_joint_leave = Boolean(input.is_joint_leave ?? input.isJointLeave ?? false);
    row.source = input.source || "manual";
    row.is_active = input.is_active ?? input.isActive ?? true;
  }
  return row;
}

function assertDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Tanggal libur harus format YYYY-MM-DD.");
}

function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  return /^(1|true|yes|ya|cuti)$/i.test(String(value ?? "").trim());
}
