import { useEffect, useState } from "react";
import { Inbox, RefreshCw, Save, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { EmptyState, Notice } from "@/components/ui/state";
import { DataTable, TableCard } from "@/components/ui/table";
import { api } from "@/lib/api";

type Mapping = {
  kode_skp: string;
  nama_skp?: string | null;
  local_skp_name?: string | null;
  site_option_text?: string | null;
  site_option_value?: string | null;
  match_status?: string | null;
};

type SiteOption = {
  text: string;
  value: string;
};

type PlanSummary = {
  hasActivePlan: boolean;
  year: number | null;
  totalItems: number;
};

export function MappingPage(): JSX.Element {
  const [rows, setRows] = useState<Mapping[]>([]);
  const [siteOptions, setSiteOptions] = useState<SiteOption[]>([]);
  const [summary, setSummary] = useState<PlanSummary | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load(): Promise<void> {
    const [mappingRows, planSummary] = await Promise.all([api.listMappings(), api.getSkpPlanSummary()]);
    setRows(mappingRows as Mapping[]);
    setSummary(planSummary as PlanSummary);
  }

  useEffect(() => {
    void load();
  }, []);

  async function refreshFromSite(): Promise<void> {
    if (!summary?.hasActivePlan) {
      setMessage("Belum ada Rencana SKP aktif. Silakan import PDF Rencana SKP terlebih dahulu.");
      return;
    }
    setLoadingOptions(true);
    setMessage(null);
    try {
      const options = await api.fetchSkpOptions() as SiteOption[];
      setSiteOptions(options);
      setMessage(`${options.length} opsi SKP terbaca dari website.`);
    } finally {
      setLoadingOptions(false);
    }
  }

  function autoMatch(): void {
    if (!summary?.hasActivePlan) {
      setMessage("Belum ada Rencana SKP aktif. Silakan import PDF Rencana SKP terlebih dahulu.");
      return;
    }
    if (siteOptions.length === 0) {
      setMessage("Refresh opsi SKP dari website dulu.");
      return;
    }
    let matched = 0;
    const updated = rows.map((row) => {
      const match = findBestOption(row, siteOptions);
      if (!match) return row;
      matched += 1;
      return { ...row, site_option_text: match.text, site_option_value: match.value, match_status: "matched" };
    });
    setRows(updated);
    setMessage(`${matched} mapping terisi otomatis. Klik Simpan pada baris yang ingin disimpan.`);
  }

  async function save(row: Mapping): Promise<void> {
    await api.updateMapping({
      kode_skp: row.kode_skp,
      site_option_text: row.site_option_text ?? "",
      site_option_value: row.site_option_value ?? "",
      match_status: row.match_status ?? "needs_review"
    });
    await load();
  }

  function chooseOption(index: number, key: string): void {
    const option = siteOptions.find((item) => optionKey(item) === key);
    setRows(rows.map((item, rowIndex) => rowIndex === index ? {
      ...item,
      site_option_text: option?.text ?? "",
      site_option_value: option?.value ?? "",
      match_status: option ? "manual" : item.match_status ?? "needs_review"
    } : item));
  }

  return (
    <div className="page-shell">
      <div className="section-heading">
        <div>
          <h2 className="section-title">Daftar SKP Aktif{summary?.year ? ` ${summary.year}` : ""}</h2>
          <p className="section-description">Cek kecocokan master lokal dari Rencana SKP dengan opsi dari website SKP.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={refreshFromSite} disabled={loadingOptions || !summary?.hasActivePlan}>
            <RefreshCw className={loadingOptions ? "animate-spin" : ""} size={16} />Refresh Opsi SKP
          </Button>
          <Button variant="secondary" onClick={autoMatch} disabled={!summary?.hasActivePlan}><Wand2 size={16} />Auto Match</Button>
        </div>
      </div>
      {message && <Notice tone="info">{message}</Notice>}
      {!summary?.hasActivePlan && (
        <EmptyState
          title="Belum ada Rencana SKP aktif."
          description="Silakan import PDF Rencana SKP terlebih dahulu."
          icon={<Inbox size={18} />}
        />
      )}
      {siteOptions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Opsi SKP Website</CardTitle>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Pilihan yang berhasil terbaca dari halaman SKP.</p>
          </CardHeader>
          <CardContent className="p-4">
            <div className="grid max-h-52 grid-cols-2 gap-2 overflow-y-auto text-sm">
              {siteOptions.map((option) => (
                <div key={optionKey(option)} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
                  <div>{option.text}</div>
                  {option.value && <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{option.value}</div>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      {summary?.hasActivePlan && (
      <TableCard>
          <DataTable className="min-w-[1040px]">
            <thead>
              <tr><th className="px-4 py-3">Kode SKP</th><th className="px-4 py-3">Master SKP 2026</th><th className="px-4 py-3">Opsi Website SKP</th><th className="px-4 py-3">Status Kecocokan</th><th className="px-4 py-3">Aksi</th></tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.kode_skp}>
                  <td className="px-4 py-3 font-medium">{row.kode_skp}</td>
                  <td className="max-w-md px-4 py-3">{row.local_skp_name ?? row.nama_skp}</td>
                  <td className="space-y-2 px-4 py-3">
                    {siteOptions.length > 0 && (
                      <Select value={selectedOptionKey(row, siteOptions)} onChange={(e) => chooseOption(index, e.target.value)}>
                        <option value="">Pilih opsi website</option>
                        {siteOptions.map((option) => <option key={optionKey(option)} value={optionKey(option)}>{option.text}</option>)}
                      </Select>
                    )}
                    <Input value={row.site_option_text ?? ""} onChange={(e) => setRows(rows.map((item, i) => i === index ? { ...item, site_option_text: e.target.value, match_status: item.match_status ?? "manual" } : item))} />
                  </td>
                  <td className="px-4 py-3">
                    <Select value={row.match_status ?? "needs_review"} onChange={(e) => setRows(rows.map((item, i) => i === index ? { ...item, match_status: e.target.value } : item))}>
                      <option value="matched">Cocok</option>
                      <option value="needs_review">Perlu Dicek</option>
                      <option value="not_found">Belum Dipetakan</option>
                      <option value="manual">Cocok</option>
                    </Select>
                    <div className="mt-2"><Badge status={mappingBadgeStatus(row.match_status)}>{mappingLabel(row.match_status)}</Badge></div>
                    {["needs_review", "not_found"].includes(row.match_status ?? "") && (
                      <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">Pilih opsi website yang sesuai, lalu simpan mapping.</div>
                    )}
                  </td>
                  <td className="px-4 py-3"><Button size="sm" variant="secondary" onClick={() => save(row)}><Save size={14} />Simpan</Button></td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className="px-4 py-8" colSpan={5}>
                    <EmptyState title="Belum ada referensi SKP" description="Data referensi SKP lokal akan muncul setelah Rencana SKP disimpan." icon={<Inbox size={18} />} />
                  </td>
                </tr>
              )}
            </tbody>
          </DataTable>
      </TableCard>
      )}
    </div>
  );
}

function optionKey(option: SiteOption): string {
  return `${option.value}\u0000${option.text}`;
}

function selectedOptionKey(row: Mapping, options: SiteOption[]): string {
  const selected = options.find((option) => option.value === (row.site_option_value ?? "") && option.text === (row.site_option_text ?? ""));
  return selected ? optionKey(selected) : "";
}

function findBestOption(row: Mapping, options: SiteOption[]): SiteOption | null {
  const selectable = options.filter((option) => option.text && !/^[-\s]*(pilih|select|--)/i.test(option.text));
  const mappedText = row.site_option_text?.trim();
  const mappedValue = row.site_option_value?.trim();
  if (mappedValue) {
    const byValue = selectable.find((option) => option.value === mappedValue);
    if (byValue) return byValue;
  }
  if (mappedText) {
    const byMappedText = findByText(selectable, mappedText);
    if (byMappedText) return byMappedText;
  }

  const code = normalizeText(row.kode_skp);
  const byCode = selectable.find((option) => normalizeText(option.text).includes(code) || normalizeText(option.value).includes(code));
  if (byCode) return byCode;

  const name = row.nama_skp ?? row.local_skp_name ?? "";
  const byName = findByText(selectable, name);
  if (byName) return byName;

  const fuzzy = selectable
    .map((option) => ({ option, score: fuzzyScore(name, option.text) }))
    .sort((left, right) => right.score - left.score)[0];
  if (fuzzy && fuzzy.score >= 0.62) return fuzzy.option;
  return null;
}

function findByText(options: SiteOption[], text: string): SiteOption | null {
  const normalized = normalizeText(text);
  if (!normalized) return null;
  return (
    options.find((option) => normalizeText(option.text) === normalized) ??
    options.find((option) => normalizeText(option.text).includes(normalized) || normalized.includes(normalizeText(option.text))) ??
    null
  );
}

function fuzzyScore(left: string, right: string): number {
  const leftTokens = significantTokens(left);
  const rightTokens = significantTokens(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;
  const matched = leftTokens.filter((token) => rightTokens.includes(token)).length;
  return matched / Math.max(leftTokens.length, rightTokens.length);
}

function significantTokens(value: string): string[] {
  const ignored = new Set(["nya", "dan", "atau", "yang", "data"]);
  return normalizeText(value).split(" ").filter((token) => token.length > 2 && !ignored.has(token));
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mappingLabel(status?: string | null): string {
  if (status === "matched" || status === "manual" || status === "partial") return "Cocok";
  if (status === "not_found") return "Belum Dipetakan";
  return "Perlu Dicek";
}

function mappingBadgeStatus(status?: string | null): string {
  if (status === "matched" || status === "manual" || status === "partial") return "matched";
  if (status === "not_found") return "not_found";
  return "needs_review";
}
