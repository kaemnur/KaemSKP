import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api";
import { formatDateTimeWIB } from "@/lib/utils";

type HistoryItem = Record<string, string>;

export function HistoryPage(): JSX.Element {
  const [items, setItems] = useState<HistoryItem[]>([]);

  useEffect(() => {
    api.listHistory(200).then(setItems);
  }, []);

  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Riwayat</h1>
        <p className="mt-1 text-sm text-slate-500">Semua proses automation, import, perubahan pengaturan, dan error lokal.</p>
      </div>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100 text-xs uppercase text-slate-500">
              <tr><th className="px-4 py-3">Waktu</th><th className="px-4 py-3">Aksi</th><th className="px-4 py-3">Hasil</th><th className="px-4 py-3">Pesan Error / Detail</th></tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">{formatDateTimeWIB(item.created_at)}</td>
                  <td className="px-4 py-3 font-medium">{item.title}</td>
                  <td className="px-4 py-3"><Badge status={item.severity}>{item.severity}</Badge></td>
                  <td className="px-4 py-3 text-slate-600">{item.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
