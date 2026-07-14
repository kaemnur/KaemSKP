import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function HelpPage(): JSX.Element {
  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Bantuan</h1>
        <p className="mt-1 text-sm text-slate-500">Panduan singkat penggunaan KaemSKP MVP Log Harian.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Alur Kerja</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm leading-6 text-slate-600">
          <div>
            <div className="font-semibold text-slate-900">1. Import data</div>
            Siapkan file Excel dengan sheet `Log_Harian_2026`, lalu preview dan simpan data valid.
          </div>
          <div>
            <div className="font-semibold text-slate-900">2. Review mapping SKP</div>
            Cocokkan master SKP lokal dengan dropdown situs. Data yang belum cocok tidak dikirim otomatis.
          </div>
          <div>
            <div className="font-semibold text-slate-900">3. Login SKP</div>
            Gunakan Login Ulang SKP. Session disimpan lokal dan bisa dihapus dari Pengaturan.
          </div>
          <div>
            <div className="font-semibold text-slate-900">4. Jalankan antrean</div>
            Gunakan Jalankan Hari Ini, Semua yang Terlewat, atau Periode Terpilih. Tanggal masa depan tidak diproses.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
