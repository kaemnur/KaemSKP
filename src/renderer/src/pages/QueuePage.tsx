import { useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/field";
import { api } from "@/lib/api";
import { formatDateID, parseDateID, todayDateKeyWIB } from "@/lib/utils";

export function QueuePage(): JSX.Element {
  const [dateFrom, setDateFrom] = useState(formatDateID("2026-01-01"));
  const [dateTo, setDateTo] = useState(formatDateID(todayDateKeyWIB()));
  const [result, setResult] = useState<Record<string, number> | null>(null);

  async function run(action: string): Promise<void> {
    if (action === "today") setResult(await api.runToday());
    if (action === "missed") setResult(await api.runMissed());
    if (action === "range") setResult(await api.runRange({ dateFrom: parseDateID(dateFrom), dateTo: parseDateID(dateTo), mode: "range" }));
    if (action === "retry") setResult(await api.retryFailed());
    if (action === "pause") await api.pauseScheduler();
    if (action === "resume") await api.resumeScheduler();
  }

  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Antrean</h1>
        <p className="mt-1 text-sm text-slate-500">Jalankan log hari ini, tanggal terlewat, rentang tanggal, atau retry gagal.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Aksi Antrean</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <Button onClick={() => run("today")}><Play size={16} />Jalankan Hari Ini</Button>
          <Button variant="secondary" onClick={() => run("missed")}><RotateCcw size={16} />Jalankan Semua yang Terlewat</Button>
          <div><Label>Tanggal mulai</Label><Input inputMode="numeric" placeholder="dd/MM/yyyy" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></div>
          <div><Label>Tanggal akhir</Label><Input inputMode="numeric" placeholder="dd/MM/yyyy" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></div>
          <Button variant="secondary" onClick={() => run("range")}>Jalankan Periode Terpilih</Button>
          <Button variant="secondary" onClick={() => run("retry")}>Retry Gagal</Button>
          <Button variant="ghost" onClick={() => run("pause")}><Pause size={16} />Pause</Button>
          <Button variant="ghost" onClick={() => run("resume")}><Play size={16} />Resume</Button>
        </CardContent>
      </Card>
      {result && (
        <section className="grid grid-cols-4 gap-4">
          {Object.entries(result).map(([key, value]) => (
            <Card key={key}><CardContent className="p-4"><div className="text-xs uppercase text-slate-500">{key}</div><div className="mt-2 text-2xl font-semibold">{value}</div></CardContent></Card>
          ))}
        </section>
      )}
    </div>
  );
}
