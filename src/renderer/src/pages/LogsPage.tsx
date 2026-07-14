import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, FileUp, ListFilter, Loader2, Play, RotateCcw, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePickerField } from "@/components/ui/date-picker";
import { Input, Label, Select, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, Notice } from "@/components/ui/state";
import { DataTable, TableCard } from "@/components/ui/table";
import { TabButton, Tabs } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { cn, formatDateID, parseDateID, todayDateKeyWIB, toDateInputValue } from "@/lib/utils";
import { DataLogsPage } from "@/pages/DataLogsPage";

type Skp = { kode_skp: string; nama_skp: string };
type TabKey = "daftar-log" | "input-manual" | "import-excel";
type Preview = {
  id: string;
  fileName: string;
  sheetName: string;
  totalRows: number;
  validRows: number;
  reviewRows: number;
  newRows: number;
  changedRows: number;
  unchangedRows: number;
  invalidRows: number;
  duplicateRows: number;
  periodStart: string | null;
  periodEnd: string | null;
  rows: Array<{ rowNumber: number; status: string; errors: string[]; notes?: string[]; data: Record<string, string> }>;
};

const emptyManual = {
  tanggal: todayDateKeyWIB(),
  nama_aktivitas: "",
  deskripsi: "",
  kode_skp: "",
  indikator_kinerja_individu: "",
  kuantitas_output: "",
  satuan: "",
  link_tautan: ""
};

export function LogsPage(): JSX.Element {
  const [params] = useSearchParams();
  const initialTab = normalizeTab(params.get("tab"));
  const [tab, setTab] = useState<TabKey>(initialTab);

  return (
    <div className="page-shell">
      <Tabs>
        <TabButton active={tab === "daftar-log"} onClick={() => setTab("daftar-log")}><ListFilter size={16} />Daftar Log</TabButton>
        <TabButton active={tab === "input-manual"} onClick={() => setTab("input-manual")}><Save size={16} />Input Manual</TabButton>
        <TabButton active={tab === "import-excel"} onClick={() => setTab("import-excel")}><FileUp size={16} />Import Excel</TabButton>
      </Tabs>

      {tab === "daftar-log" && <DataLogsPage embedded />}
      {tab === "input-manual" && <ManualInputTab />}
      {tab === "import-excel" && <ImportExcelTab />}
    </div>
  );
}

function normalizeTab(value: string | null): TabKey {
  if (value === "daftar-log" || value === "data" || value === "list") return "daftar-log";
  if (value === "import-excel" || value === "import") return "import-excel";
  if (value === "input-manual" || value === "input") return "input-manual";
  return "daftar-log";
}

function ManualInputTab(): JSX.Element {
  const [params] = useSearchParams();
  const initialDate = toDateInputValue(params.get("tanggal") ?? params.get("date") ?? todayDateKeyWIB()) || todayDateKeyWIB();
  const [skp, setSkp] = useState<Skp[]>([]);
  const [form, setForm] = useState<Record<string, string>>({ ...emptyManual, tanggal: initialDate });
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listSkp().then(setSkp);
  }, []);

  function set(key: string, value: string): void {
    setForm({ ...form, [key]: value });
    setNotice(null);
  }

  async function save(runAfter = false): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      const payload = { ...form, tanggal: parseDateID(form.tanggal) || form.tanggal };
      const saved = await api.saveLog(payload) as Record<string, string>;
      if (runAfter) await api.runRange({ dateFrom: saved.tanggal, dateTo: saved.tanggal });
      setNotice(runAfter ? "Log tersimpan dan antrean SKP dijalankan." : "Log tersimpan ke database lokal.");
      setForm(emptyManual);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Input Manual</CardTitle>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Tambah satu data Log Harian ke database lokal.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <DatePickerField id="manual-date" label="Tanggal" value={form.tanggal} onChange={(value) => set("tanggal", value)} />
          <div><Label>Nama Aktivitas</Label><Input value={form.nama_aktivitas} onChange={(e) => set("nama_aktivitas", e.target.value)} /></div>
          <div className="xl:col-span-2"><Label>Deskripsi</Label><Textarea value={form.deskripsi} onChange={(e) => set("deskripsi", e.target.value)} /></div>
          <div>
            <Label>SKP</Label>
            <Select value={form.kode_skp} onChange={(e) => set("kode_skp", e.target.value)}>
              <option value="">Pilih SKP</option>
              {skp.map((item) => <option key={item.kode_skp} value={item.kode_skp}>{item.kode_skp} - {item.nama_skp}</option>)}
            </Select>
          </div>
          <div><Label>Indikator Kinerja Individu</Label><Input value={form.indikator_kinerja_individu} onChange={(e) => set("indikator_kinerja_individu", e.target.value)} /></div>
          <div><Label>Kuantitas Output</Label><Input value={form.kuantitas_output} onChange={(e) => set("kuantitas_output", e.target.value)} /></div>
          <div><Label>Satuan</Label><Input value={form.satuan} onChange={(e) => set("satuan", e.target.value)} /></div>
          <div className="xl:col-span-2"><Label>Link/Tautan</Label><Input value={form.link_tautan} onChange={(e) => set("link_tautan", e.target.value)} /></div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm leading-6 text-slate-500 dark:text-slate-400">
            {!form.kode_skp ? "Jika SKP belum dipilih, data akan masuk status Perlu Dicek." : "Data siap disimpan ke lokal."}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => { setForm(emptyManual); setNotice(null); }} disabled={busy}><RotateCcw size={16} />Reset</Button>
            <Button variant="secondary" onClick={() => save(false)} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save size={16} />}Simpan Data Lokal</Button>
            <Button onClick={() => save(true)} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play size={16} />}Simpan & Kirim ke SKP</Button>
          </div>
        </div>
        {notice && <Notice tone="success"><CheckCircle2 size={16} />{notice}</Notice>}
      </CardContent>
    </Card>
  );
}

function ImportExcelTab(): JSX.Element {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mode, setMode] = useState("append_new");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function choose(file: File | null): Promise<void> {
    if (!file) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setPreview(await api.previewExcel(file));
    } catch (err) {
      setPreview(null);
      setError(err instanceof Error ? err.message : "File Excel tidak valid.");
    } finally {
      setBusy(false);
    }
  }

  async function commit(): Promise<void> {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.commitExcelImport(mode) as Record<string, number>;
      setMessage(`${result.insertedRows ?? 0} data baru, ${result.updatedRows ?? 0} diperbarui, ${result.skippedRows ?? 0} dilewati.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import gagal disimpan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Import Excel</CardTitle>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Upload file, cek preview, lalu simpan data yang valid ke lokal.</p>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 p-4 md:grid-cols-3">
          {["Upload", "Preview", "Simpan"].map((step, index) => (
            <div key={step} className={cn("rounded-md border px-3 py-2 text-sm transition", stepperClass(index, preview, busy, message))}>
              <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-700 text-xs text-white dark:bg-blue-500 dark:text-slate-950">{index + 1}</span>
              {step}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="toolbar-panel flex flex-wrap items-center gap-3">
        <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-blue-700 bg-blue-700 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-blue-800 dark:border-blue-500 dark:bg-blue-500 dark:text-slate-950 dark:hover:bg-blue-400">
          <FileUp size={16} />Upload Excel
          <input className="hidden" type="file" accept=".xlsx" onChange={(event) => choose(event.target.files?.[0] ?? null)} />
        </label>
        <Select className="max-w-xs" value={mode} onChange={(event) => setMode(event.target.value)}>
          <option value="append_new">Tambah data baru saja</option>
          <option value="update_changed">Perbarui data yang berubah</option>
          <option value="replace_period">Ganti data periode ini</option>
          <option value="preview_only">Preview saja</option>
        </Select>
        <Button variant="secondary" disabled={!preview || busy} onClick={commit}><Save size={16} />Simpan Import</Button>
        {message && <Badge status="submitted"><CheckCircle2 size={14} />{message}</Badge>}
      </div>
      {busy && <Notice tone="info"><Loader2 className="h-4 w-4 animate-spin" />Membaca file, memvalidasi data, dan menyiapkan preview.</Notice>}
      {busy && <SkeletonPreview />}
      {error && <ErrorState message={error} />}

      {preview && (
        <>
          <section className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-8">
            {[
              ["Total", preview.totalRows],
              ["Valid", preview.validRows],
              ["Perlu Dicek", preview.reviewRows],
              ["Tidak Valid", preview.invalidRows],
              ["Baru", preview.newRows],
              ["Sama", preview.unchangedRows],
              ["Berubah", preview.changedRows],
              ["Duplikat", preview.duplicateRows]
            ].map(([label, value]) => (
              <Card key={label}><CardContent className="p-4"><div className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">{label}</div><div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div></CardContent></Card>
            ))}
          </section>
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            {preview.fileName} - {preview.sheetName} - Periode {formatDateID(preview.periodStart) || "-"} sampai {formatDateID(preview.periodEnd) || "-"}
          </div>
          <TableCard>
              <DataTable className="min-w-[1100px]">
                <thead>
                  <tr>
                    {["Tanggal", "Kode Log", "Nama Aktivitas", "SKP", "Indikator", "Kuantitas Output", "Satuan", "Status Validasi", "Catatan"].map((head) => (
                      <th key={head} className="px-4 py-3">{head}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 200).map((row) => (
                    <tr key={row.rowNumber}>
                      <td className="px-4 py-3">{formatDateID(row.data.tanggal) || row.data.tanggal}</td>
                      <td className="px-4 py-3 font-medium">{row.data.kode_log}</td>
                      <td className="max-w-xs px-4 py-3">{row.data.nama_aktivitas}</td>
                      <td className="max-w-sm px-4 py-3">{row.data.kode_skp ?? row.data.nama_skp}</td>
                      <td className="max-w-xs px-4 py-3">{row.data.indikator_kinerja_individu}</td>
                      <td className="px-4 py-3">{row.data.kuantitas_output}</td>
                      <td className="px-4 py-3">{row.data.satuan}</td>
                      <td className="px-4 py-3"><Badge status={badgeFor(row.status)}>{row.status === "Perlu Review" ? "Perlu Dicek" : row.status}</Badge></td>
                      <td className="max-w-xs px-4 py-3 text-slate-600 dark:text-slate-300">{[...(row.errors ?? []), ...(row.notes ?? [])].join(" ") || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
          </TableCard>
        </>
      )}
      {!preview && !busy && !error && (
        <EmptyState
          title="Belum ada file Excel"
          description="Upload file .xlsx untuk melihat preview validasi sebelum data disimpan ke database lokal."
          icon={<FileUp size={18} />}
        />
      )}
    </div>
  );
}

function badgeFor(status: string): string {
  if (status === "Tidak Valid" || status === "Duplikat") return "invalid";
  if (status === "Perlu Review" || status === "Berubah") return "needs_review";
  if (status === "Sama") return "submitted";
  return "ready";
}

function stepperClass(index: number, preview: Preview | null, busy: boolean, message: string | null): string {
  const active = (busy && index <= 1) || (!preview && index === 0) || (preview && index === 1) || (message && index === 2);
  if (active) return "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300";
  return "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400";
}

function SkeletonPreview(): JSX.Element {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="h-9 animate-pulse rounded-md bg-slate-100 dark:bg-slate-800" />
        ))}
      </CardContent>
    </Card>
  );
}
