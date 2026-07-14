import { useState } from "react";
import { CheckCircle2, FileUp, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { api } from "@/lib/api";

type Preview = {
  fileName: string;
  sheetName: string;
  totalRows: number;
  newRows: number;
  changedRows: number;
  unchangedRows: number;
  invalidRows: number;
  rows: Array<{ rowNumber: number; status: string; errors: string[]; data: Record<string, string> }>;
};

export function ImportPage(): JSX.Element {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mode, setMode] = useState("update_changed");
  const [saved, setSaved] = useState(false);

  async function choose(file: File | null): Promise<void> {
    if (!file) return;
    setSaved(false);
    setPreview(await api.previewExcel(file));
  }

  async function commit(): Promise<void> {
    await api.commitExcelImport(mode);
    setSaved(true);
  }

  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Import Data</h1>
        <p className="mt-1 text-sm text-slate-500">Upload Excel rencana Log Harian sesuai template `Log_Harian_2026`.</p>
      </div>

      <Card>
        <CardContent className="grid grid-cols-5 gap-3 p-4">
          {["Upload File", "Validasi Kolom", "Preview Data", "Pilih Mode Update", "Simpan"].map((step, index) => (
            <div key={step} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-700 text-xs text-white">{index + 1}</span>
              {step}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-blue-700 bg-blue-700 px-4 text-sm font-medium text-white transition hover:bg-blue-800">
          <FileUp size={16} />Upload Excel
          <input className="hidden" type="file" accept=".xlsx" onChange={(event) => choose(event.target.files?.[0] ?? null)} />
        </label>
        <Select className="max-w-xs" value={mode} onChange={(event) => setMode(event.target.value)}>
          <option value="append_new">Tambah data baru saja</option>
          <option value="update_changed">Perbarui data yang berubah</option>
          <option value="replace_period">Ganti data periode ini</option>
          <option value="preview_only">Preview saja</option>
        </Select>
        <Button variant="secondary" disabled={!preview} onClick={commit}><Save size={16} />Simpan Import</Button>
        {saved && <Badge status="submitted"><CheckCircle2 size={14} />Import tersimpan</Badge>}
      </div>

      {preview && (
        <>
          <section className="grid grid-cols-5 gap-4">
            {[
              ["Total", preview.totalRows],
              ["Baru", preview.newRows],
              ["Berubah", preview.changedRows],
              ["Sama", preview.unchangedRows],
              ["Tidak Valid", preview.invalidRows]
            ].map(([label, value]) => (
              <Card key={label}><CardContent className="p-4"><div className="text-xs uppercase text-slate-500">{label}</div><div className="mt-2 text-2xl font-semibold">{value}</div></CardContent></Card>
            ))}
          </section>
          <Card>
            <CardHeader><CardTitle>{preview.fileName} · {preview.sheetName}</CardTitle></CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-100 text-xs uppercase text-slate-500">
                  <tr><th className="px-4 py-3">Baris</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Kode Log</th><th className="px-4 py-3">Tanggal</th><th className="px-4 py-3">Aktivitas</th><th className="px-4 py-3">Catatan Validasi</th></tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 200).map((row) => (
                    <tr key={row.rowNumber} className="border-t border-slate-100">
                      <td className="px-4 py-3">{row.rowNumber}</td>
                      <td className="px-4 py-3"><Badge status={row.status === "Tidak Valid" ? "invalid" : row.status === "Berubah" ? "needs_review" : row.status === "Baru" ? "ready" : "submitted"}>{row.status}</Badge></td>
                      <td className="px-4 py-3">{row.data.kode_log}</td>
                      <td className="px-4 py-3">{row.data.tanggal}</td>
                      <td className="px-4 py-3">{row.data.nama_aktivitas}</td>
                      <td className="px-4 py-3 text-slate-500">{row.errors.join(" ") || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
