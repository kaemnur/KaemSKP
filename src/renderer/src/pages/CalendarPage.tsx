import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/field";
import { api } from "@/lib/api";
import { cn, formatDate, statusLabel } from "@/lib/utils";

type Day = Record<string, string | number>;
type Detail = { day?: Day; logs: Array<Record<string, string>> };

export function CalendarPage(): JSX.Element {
  const [month, setMonth] = useState("2026-07");
  const [days, setDays] = useState<Day[]>([]);
  const [selected, setSelected] = useState<Detail | null>(null);

  async function load(): Promise<void> {
    setDays(await api.listCalendar(month));
  }

  useEffect(() => {
    void load();
  }, [month]);

  const blanks = useMemo(() => {
    if (days.length === 0) return 0;
    const first = new Date(`${days[0].date}T00:00:00`).getDay();
    return first === 0 ? 6 : first - 1;
  }, [days]);

  async function select(date: string): Promise<void> {
    setSelected(await api.calendarDetail(date));
  }

  async function mark(status: string, reasonType: string, reasonNote: string): Promise<void> {
    if (!selected?.day?.date) return;
    await api.markCalendar({ date: String(selected.day.date), status, reasonType, reasonNote });
    await load();
    await select(String(selected.day.date));
  }

  return (
    <div className="page-shell grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="section-title">Kalender Libur</h2>
            <p className="section-description">Pantau tanggal merah, cuti, weekend, dan status log dalam periode aktif.</p>
          </div>
          <Input className="max-w-48" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-7 gap-2 text-center text-xs font-semibold uppercase text-slate-500">
              {["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"].map((day) => <div key={day}>{day}</div>)}
            </div>
            <div className="mt-3 grid grid-cols-7 gap-2">
              {Array.from({ length: blanks }).map((_, index) => <div key={`blank-${index}`} className="aspect-square" />)}
              {days.map((day) => (
                <button
                  key={String(day.date)}
                  onClick={() => select(String(day.date))}
                  className={cn(
                    "flex aspect-square flex-col items-start justify-between rounded-lg border p-2 text-left transition hover:ring-2 hover:ring-blue-200",
                    day.status === "submitted" && "border-emerald-200 bg-emerald-50",
                    day.status === "has_log" && "border-blue-200 bg-blue-50",
                    day.status === "missing" && "border-amber-200 bg-amber-50",
                    day.status === "failed" && "border-red-200 bg-red-50",
                    ["weekend", "public_holiday", "leave", "no_plan"].includes(String(day.status)) && "border-gray-200 bg-gray-100",
                    day.status === "future" && "border-slate-200 bg-slate-50"
                  )}
                >
                  <span className="text-sm font-semibold">{String(day.date).slice(-2)}</span>
                  <span className="text-[11px] leading-tight text-slate-600">{statusLabel(String(day.status))}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <aside>
        <Card className="sticky top-6">
          <CardHeader><CardTitle>Detail Tanggal</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {!selected?.day && <div className="text-sm text-slate-500">Klik tanggal untuk melihat detail.</div>}
            {selected?.day && (
              <>
                <div>
                  <div className="text-lg font-semibold">{formatDate(String(selected.day.date))}</div>
                  <div className="text-sm text-slate-500">{selected.day.day_name}</div>
                </div>
                <Badge status={String(selected.day.status)} />
                <div className="text-sm text-slate-600">{selected.day.reason_note || selected.day.holiday_name || "Data log tersedia."}</div>
                <div className="space-y-2">
                  {selected.logs.map((log) => (
                    <div key={log.id} className="rounded-md border border-slate-100 p-3 text-sm">
                      <div className="font-medium">{log.nama_aktivitas}</div>
                      <div className="text-xs text-slate-500">{log.kode_log} - {log.kode_skp}</div>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" variant="secondary" onClick={() => api.runRange({ dateFrom: String(selected.day?.date), dateTo: String(selected.day?.date), mode: "range" })}>Jalankan Tanggal Ini</Button>
                  <Button size="sm" variant="secondary">Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => mark("public_holiday", "public_holiday", "Tanggal merah")}>Tandai Libur</Button>
                  <Button size="sm" variant="ghost" onClick={() => mark("leave", "leave", "Cuti")}>Tandai Cuti</Button>
                  <Button size="sm" variant="ghost" onClick={() => mark("no_plan", "no_work_plan", "Tidak ada rencana kerja")}>Tidak Ada Rencana</Button>
                  <Button size="sm" variant="ghost" onClick={() => mark("no_plan", "manual_skip", "Dilewati manual")}>Lewati</Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
