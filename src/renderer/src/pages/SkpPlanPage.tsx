import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Database, FileText, Inbox, Link2, RefreshCw, Save, UploadCloud, Wand2 } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyState, ErrorState, LoadingState, Notice } from "@/components/ui/state";
import { DataTable, TableCard } from "@/components/ui/table";
import { TabButton, Tabs } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { formatDateID, formatDateTimeWIB, friendlyErrorMessage } from "@/lib/utils";

type TabKey = "active" | "master" | "mapping" | "import";

type ParsedSkpPlan = {
  ok: true;
  fileName: string;
  profile: {
    nama: string;
    nip: string;
    jabatan: string;
    unitKerja: string;
    periodeMulai: string;
    periodeAkhir: string;
    tahun: number;
  };
  skpItems: Array<{
    kode_skp: string;
    nomor: number;
    nama_skp: string;
    indikator: string[];
  }>;
  warnings: string[];
};

type PlanSummary = {
  hasActivePlan: boolean;
  year: number | null;
  label: string | null;
  startDate: string | null;
  endDate: string | null;
  totalItems: number;
  sourceFile: string | null;
  importedAt: string | null;
};

type Profile = {
  namaPegawai?: string;
  nipUsername?: string;
  jabatan?: string;
  unitKerja?: string;
  tahunSkpAktif?: string;
  periodeSkp?: string;
};

type SkpItem = {
  kode_skp: string;
  nama_skp: string;
  indikator_json?: string | null;
  is_active?: number;
};

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

export function SkpPlanPage(): JSX.Element {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<TabKey>(normalizeTab(params.get("tab")));
  const [summary, setSummary] = useState<PlanSummary | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [skpItems, setSkpItems] = useState<SkpItem[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [preview, setPreview] = useState<ParsedSkpPlan | null>(null);
  const [busy, setBusy] = useState<"load" | "parse" | "save" | null>("load");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);

  const loadingLabel = useMemo(() => {
    if (busy === "parse") return "Membaca PDF dan menyiapkan preview Rencana SKP...";
    if (busy === "save") return "Menyimpan master SKP lokal...";
    return "Memuat Rencana SKP...";
  }, [busy]);

  async function loadPage(): Promise<void> {
    setBusy("load");
    try {
      const [planSummary, rows, mappingRows, profileData] = await Promise.all([
        api.getSkpPlanSummary(),
        api.listSkp(),
        api.listMappings(),
        api.getProfile()
      ]);
      setSummary(planSummary as PlanSummary);
      setSkpItems(rows as SkpItem[]);
      setMappings(mappingRows as Mapping[]);
      setProfile(profileData as Profile);
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    void loadPage();
  }, []);

  useEffect(() => {
    setTab(normalizeTab(params.get("tab")));
  }, [params]);

  function chooseTab(next: TabKey): void {
    setTab(next);
    setParams(next === "active" ? {} : { tab: next }, { replace: true });
  }

  async function previewPdf(file: File | null): Promise<void> {
    if (!file) return;
    setBusy("parse");
    setError(null);
    setMessage(null);
    try {
      setPreview((await api.previewSkpPlanPdf(file)) as ParsedSkpPlan);
      setMessage("Preview Rencana SKP siap dicek.");
      chooseTab("import");
    } catch (err) {
      setPreview(null);
      setError(cleanErrorMessage(err, "Format Rencana SKP belum terbaca."));
      chooseTab("import");
    } finally {
      setBusy(null);
    }
  }

  function requestSaveMaster(): void {
    if (!preview) return;
    if (summary?.hasActivePlan) {
      setConfirmSaveOpen(true);
      return;
    }
    void saveMaster();
  }

  async function saveMaster(): Promise<void> {
    if (!preview) return;
    setConfirmSaveOpen(false);
    setBusy("save");
    setError(null);
    try {
      setSummary((await api.saveSkpPlan(preview as unknown as Record<string, unknown>)) as PlanSummary);
      setMessage("Rencana SKP disimpan sebagai master aktif.");
      setPreview(null);
      await loadPage();
      chooseTab("master");
    } catch (err) {
      setError(cleanErrorMessage(err, "Rencana SKP belum bisa disimpan."));
    } finally {
      setBusy(null);
    }
  }

  function resetPreview(): void {
    setPreview(null);
    setError(null);
    setMessage(null);
    setConfirmSaveOpen(false);
  }

  const mappingByCode = useMemo(() => {
    const map = new Map<string, Mapping>();
    mappings.forEach((item) => map.set(item.kode_skp, item));
    return map;
  }, [mappings]);

  return (
    <div className="page-shell">
      <div className="section-heading">
        <div>
          <h2 className="section-title">Rencana & Referensi SKP</h2>
          <p className="section-description">Pantau rencana aktif, master SKP, mapping website, lalu import PDF Rencana SKP baru bila master perlu diganti.</p>
        </div>
      </div>

      <Tabs>
        {[
          ["active", "Rencana Aktif", FileText],
          ["master", "Master SKP", Database],
          ["mapping", "Mapping Website", Link2],
          ["import", "Import Rencana", UploadCloud]
        ].map(([key, label, Icon]) => (
          <TabButton key={String(key)} active={tab === key} onClick={() => chooseTab(key as TabKey)}>
            <Icon size={16} />{String(label)}
          </TabButton>
        ))}
      </Tabs>

      {busy && <LoadingState label={loadingLabel} />}
      {message && <Notice tone="success">{message}</Notice>}
      {error && (
        <ErrorState
          title="Rencana SKP belum berhasil diproses"
          message={error}
          onRetry={resetPreview}
        />
      )}
      {confirmSaveOpen && (
        <Modal
          title="Ganti Master SKP Aktif?"
          description="Master SKP lama akan diganti dengan hasil import baru. Lanjutkan?"
          onClose={() => setConfirmSaveOpen(false)}
          className="max-w-lg"
        >
          <div className="space-y-4">
            <Notice tone="warning">Import PDF baru akan mengganti master SKP aktif yang sekarang.</Notice>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmSaveOpen(false)} disabled={busy !== null}>
                Batal
              </Button>
              <Button onClick={() => void saveMaster()} disabled={busy !== null}>
                <Save size={16} />Lanjutkan
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {tab === "active" && (
        <ActivePlanTab
          summary={summary}
          profile={profile}
          skpItems={skpItems}
          onGoMaster={() => chooseTab("master")}
          onGoImport={() => chooseTab("import")}
        />
      )}
      {tab === "master" && <MasterSkpTab summary={summary} skpItems={skpItems} mappingByCode={mappingByCode} onGoImport={() => chooseTab("import")} />}
      {tab === "mapping" && (
        <MappingWebsiteTab
          summary={summary}
          rows={mappings}
          setRows={setMappings}
          reload={loadPage}
        />
      )}
      {tab === "import" && (
        <ImportPlanTab
          summary={summary}
          preview={preview}
          busy={busy !== null}
          onFile={previewPdf}
          onSave={requestSaveMaster}
          onReset={resetPreview}
        />
      )}
    </div>
  );
}

function ActivePlanTab({
  summary,
  profile,
  skpItems,
  onGoMaster,
  onGoImport
}: {
  summary: PlanSummary | null;
  profile: Profile | null;
  skpItems: SkpItem[];
  onGoMaster: () => void;
  onGoImport: () => void;
}): JSX.Element {
  if (!summary?.hasActivePlan) {
    return (
      <EmptyState
        title="Belum ada Rencana SKP aktif."
        description="Buka tab Import Rencana untuk upload PDF, cek preview parsing, lalu simpan sebagai rencana aktif."
        icon={<FileText size={18} />}
        action={<Button onClick={onGoImport}><UploadCloud size={16} />Import PDF Baru</Button>}
      />
    );
  }

  return (
    <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(340px,0.6fr)] xl:items-start">
      <Card>
        <CardHeader className="dashboard-card-header">
          <div>
            <CardTitle>Rencana Aktif</CardTitle>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Informasi PDF Rencana SKP yang sedang dipakai sebagai master lokal.</p>
          </div>
          <Badge status="matched">{summary.totalItems} SKP aktif</Badge>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <InfoRow label="Status" value="Aktif" />
          <InfoRow label="Tahun" value={String(summary.year ?? "-")} />
          <InfoRow label="Periode" value={`${formatDateID(summary.startDate)} s/d ${formatDateID(summary.endDate)}`} />
          <InfoRow label="Nama file sumber" value={summary.sourceFile ?? "-"} />
          <InfoRow label="Waktu import" value={summary.importedAt ? formatDateTimeWIB(summary.importedAt) : "-"} />
          <InfoRow label="Jumlah SKP aktif" value={`${summary.totalItems} SKP`} />
          <InfoRow label="Nama pegawai" value={profile?.namaPegawai || "-"} />
          <InfoRow label="NIP / Username" value={profile?.nipUsername || "-"} />
          <InfoRow label="Jabatan" value={profile?.jabatan || "-"} />
          <InfoRow label="Unit kerja" value={profile?.unitKerja || "-"} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Kelola Rencana</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm leading-6 text-slate-600 dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-300">
            Rencana aktif dipakai oleh master SKP, mapping website, dan import log harian. Untuk mengganti master, upload PDF baru melalui alur Import Rencana.
          </div>
          <div className="flex flex-col gap-2">
            <Button variant="secondary" onClick={onGoMaster} disabled={skpItems.length === 0}>
              <Database size={16} />Lihat Master SKP
            </Button>
            <Button variant="secondary" onClick={onGoImport}>
              <UploadCloud size={16} />Import PDF Baru
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function MasterSkpTab({
  summary,
  skpItems,
  mappingByCode,
  onGoImport
}: {
  summary: PlanSummary | null;
  skpItems: SkpItem[];
  mappingByCode: Map<string, Mapping>;
  onGoImport: () => void;
}): JSX.Element {
  if (!summary?.hasActivePlan) {
    return (
      <EmptyState
        title="Belum ada Rencana SKP aktif."
        description="Upload PDF di tab Import Rencana, lalu simpan hasil parsing untuk mengisi Master SKP."
        icon={<Inbox size={18} />}
        action={<Button onClick={onGoImport}><UploadCloud size={16} />Buka Import Rencana</Button>}
      />
    );
  }

  return (
    <TableCard>
      <DataTable className="min-w-[1120px]">
        <thead>
          <tr>
            <th>Kode SKP</th>
            <th>Nomor</th>
            <th>Nama / Sasaran SKP</th>
            <th>Indikator Kinerja Individu</th>
            <th>Tahun</th>
            <th>Periode</th>
            <th>Status Mapping</th>
          </tr>
        </thead>
        <tbody>
          {skpItems.map((item) => {
            const indicators = parseIndicatorJson(item.indikator_json);
            const mapping = mappingByCode.get(item.kode_skp);
            return (
              <tr key={item.kode_skp}>
                <td className="font-semibold">{item.kode_skp}</td>
                <td>{item.kode_skp.match(/(\d+)$/)?.[1] ?? "-"}</td>
                <td className="max-w-md">{item.nama_skp}</td>
                <td className="max-w-xl">
                  <IndicatorList indicators={indicators} />
                </td>
                <td>{summary.year ?? "-"}</td>
                <td>{formatDateID(summary.startDate)} s/d {formatDateID(summary.endDate)}</td>
                <td><Badge status={mappingBadgeStatus(mapping?.match_status)}>{mappingLabel(mapping?.match_status)}</Badge></td>
              </tr>
            );
          })}
          {skpItems.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-8">
                <EmptyState
                  title="Master SKP belum berisi data"
                  description="Upload dan simpan PDF Rencana SKP dari tab Import Rencana untuk menampilkan isi SKP."
                  icon={<Database size={18} />}
                  action={<Button onClick={onGoImport}><UploadCloud size={16} />Buka Import Rencana</Button>}
                />
              </td>
            </tr>
          )}
        </tbody>
      </DataTable>
    </TableCard>
  );
}

function MappingWebsiteTab({
  summary,
  rows,
  setRows,
  reload
}: {
  summary: PlanSummary | null;
  rows: Mapping[];
  setRows: (rows: Mapping[]) => void;
  reload: () => Promise<void>;
}): JSX.Element {
  const [siteOptions, setSiteOptions] = useState<SiteOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refreshFromSite(): Promise<void> {
    if (!summary?.hasActivePlan) {
      setMessage("Belum ada Rencana SKP aktif. Silakan upload PDF Rencana SKP terlebih dahulu.");
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
      setMessage("Belum ada Rencana SKP aktif. Silakan upload PDF Rencana SKP terlebih dahulu.");
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
    await reload();
    setMessage("Mapping disimpan.");
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
    <div className="space-y-5">
      <div className="section-heading">
        <div>
          <h2 className="section-title">Mapping Website</h2>
          <p className="section-description">Cocokkan master SKP lokal dari Rencana SKP dengan pilihan di website SKP.</p>
        </div>
        <div className="flex flex-wrap gap-2">
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
          description="Silakan upload PDF Rencana SKP terlebih dahulu."
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
            <div className="grid max-h-52 grid-cols-1 gap-2 overflow-y-auto text-sm md:grid-cols-2">
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
              <tr>
                <th>Kode SKP</th>
                <th>Master SKP Lokal</th>
                <th>Opsi Website SKP</th>
                <th>Status Kecocokan</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.kode_skp}>
                  <td className="font-medium">{row.kode_skp}</td>
                  <td className="max-w-md">{row.local_skp_name ?? row.nama_skp}</td>
                  <td className="space-y-2">
                    {siteOptions.length > 0 && (
                      <Select value={selectedOptionKey(row, siteOptions)} onChange={(event) => chooseOption(index, event.target.value)}>
                        <option value="">Pilih opsi website</option>
                        {siteOptions.map((option) => <option key={optionKey(option)} value={optionKey(option)}>{option.text}</option>)}
                      </Select>
                    )}
                    <Input value={row.site_option_text ?? ""} onChange={(event) => setRows(rows.map((item, i) => i === index ? { ...item, site_option_text: event.target.value, match_status: item.match_status ?? "manual" } : item))} />
                  </td>
                  <td>
                    <Select value={row.match_status ?? "needs_review"} onChange={(event) => setRows(rows.map((item, i) => i === index ? { ...item, match_status: event.target.value } : item))}>
                      <option value="matched">Cocok</option>
                      <option value="needs_review">Perlu Dicek</option>
                      <option value="not_found">Belum Dipetakan</option>
                      <option value="manual">Manual</option>
                    </Select>
                    <div className="mt-2"><Badge status={mappingBadgeStatus(row.match_status)}>{mappingLabel(row.match_status)}</Badge></div>
                  </td>
                  <td><Button size="sm" variant="secondary" onClick={() => void save(row)}><Save size={14} />Simpan</Button></td>
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

function ImportPlanTab({
  summary,
  preview,
  busy,
  onFile,
  onSave,
  onReset
}: {
  summary: PlanSummary | null;
  preview: ParsedSkpPlan | null;
  busy: boolean;
  onFile: (file: File | null) => Promise<void>;
  onSave: () => void;
  onReset: () => void;
}): JSX.Element {
  const hasActivePlan = Boolean(summary?.hasActivePlan);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Import Rencana SKP</CardTitle>
            <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">Upload PDF Rencana SKP, periksa hasil parsing, lalu simpan sebagai master SKP aktif.</p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 p-4">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <PlanStep
              number={1}
              title="Upload PDF"
              description={hasActivePlan ? "Pilih PDF baru untuk mengganti master aktif." : "Pilih PDF Rencana SKP sebagai sumber master."}
              state={preview || hasActivePlan ? "done" : "active"}
            />
            <PlanStep
              number={2}
              title="Preview Parsing"
              description="Cek identitas dan daftar SKP sebelum disimpan."
              state={preview ? "active" : hasActivePlan ? "done" : "idle"}
            />
            <PlanStep
              number={3}
              title="Simpan Rencana"
              description="Jadikan hasil parsing sebagai rencana aktif lokal."
              state={preview ? "active" : hasActivePlan ? "done" : "idle"}
            />
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/70">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0 text-sm leading-6 text-slate-600 dark:text-slate-300">
                {hasActivePlan
                  ? "Upload PDF baru akan mengganti master SKP aktif yang sekarang."
                  : "Belum ada rencana aktif. Mulai dari upload PDF, lalu simpan setelah preview sesuai."}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <UploadPdfButton onFile={onFile} disabled={busy} label={hasActivePlan ? "Upload PDF Baru" : "Upload PDF Rencana SKP"} />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {!preview && (
        <EmptyState
          title={hasActivePlan ? "Master aktif siap digunakan" : "Preview parsing belum tersedia"}
          description={hasActivePlan ? "Upload PDF baru hanya jika ingin mengganti master SKP aktif." : "Upload PDF dari action bar di atas untuk menampilkan preview sebelum disimpan."}
          icon={<UploadCloud size={18} />}
        />
      )}

      {preview && (
        <>
          {preview.warnings.length > 0 && <Notice tone="warning">{preview.warnings.join(" ")}</Notice>}
          <Card>
            <CardHeader>
              <CardTitle>Preview Identitas</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <InfoRow label="Nama" value={preview.profile.nama || "-"} />
              <InfoRow label="NIP" value={preview.profile.nip || "-"} />
              <InfoRow label="Jabatan" value={preview.profile.jabatan || "-"} />
              <InfoRow label="Unit Kerja" value={preview.profile.unitKerja || "-"} />
              <InfoRow label="Periode" value={`${formatDateID(preview.profile.periodeMulai)} s/d ${formatDateID(preview.profile.periodeAkhir)}`} />
              <InfoRow label="File" value={preview.fileName} />
            </CardContent>
          </Card>

          <TableCard>
            <DataTable className="min-w-[960px]">
              <thead>
                <tr>
                  <th>Kode SKP</th>
                  <th>Nomor</th>
                  <th>Sasaran Kinerja</th>
                  <th>Indikator</th>
                </tr>
              </thead>
              <tbody>
                {preview.skpItems.map((item) => (
                  <tr key={item.kode_skp}>
                    <td className="font-semibold">{item.kode_skp}</td>
                    <td>{item.nomor}</td>
                    <td className="max-w-xl">{item.nama_skp}</td>
                    <td className="max-w-xl"><IndicatorList indicators={item.indikator} /></td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </TableCard>

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={onReset} disabled={busy}>
              <RefreshCw size={16} />Reset Preview
            </Button>
            <Button onClick={onSave} disabled={busy}>
              <Save size={16} />Simpan sebagai Rencana Aktif
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function PlanStep({
  number,
  title,
  description,
  state
}: {
  number: number;
  title: string;
  description: string;
  state: "done" | "active" | "idle";
}): JSX.Element {
  return (
    <div className={`rounded-lg border p-3 ${state === "active" ? "border-blue-200 bg-blue-50 dark:border-blue-500/30 dark:bg-blue-500/10" : state === "done" ? "border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10" : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"}`}>
      <div className="flex items-start gap-3">
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sm font-semibold ${state === "done" ? "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-slate-950" : state === "active" ? "bg-blue-700 text-white dark:bg-blue-500 dark:text-slate-950" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`}>
          {state === "done" ? <CheckCircle2 size={16} /> : number}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-950 dark:text-slate-100">{title}</div>
          <div className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</div>
        </div>
      </div>
    </div>
  );
}

function UploadPdfButton({
  onFile,
  disabled,
  label,
  className
}: {
  onFile: (file: File | null) => Promise<void>;
  disabled?: boolean;
  label: string;
  className?: string;
}): JSX.Element {
  return (
    <label className={`inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-blue-700 bg-blue-700 px-4 text-sm font-medium text-white shadow-sm shadow-blue-950/10 transition hover:bg-blue-800 dark:border-blue-500 dark:bg-blue-500 dark:text-slate-950 dark:hover:bg-blue-400 ${disabled ? "pointer-events-none opacity-50" : ""} ${className ?? ""}`}>
      <UploadCloud size={16} />{label}
      <input className="hidden" type="file" accept="application/pdf,.pdf" disabled={disabled} onChange={(event) => void onFile(event.target.files?.[0] ?? null)} />
    </label>
  );
}

function InfoRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="min-w-0">
      <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 break-words text-sm font-medium text-slate-900 dark:text-slate-100">{value || "-"}</div>
    </div>
  );
}

function IndicatorList({ indicators }: { indicators: string[] }): JSX.Element {
  if (indicators.length === 0) return <span className="text-amber-700 dark:text-amber-300">Indikator belum terbaca.</span>;
  const visible = indicators.slice(0, 3);
  const rest = indicators.slice(3);
  return (
    <div className="space-y-2">
      <ul className="list-disc space-y-1 pl-4">
        {visible.map((indikator, index) => <li key={index}>{indikator}</li>)}
      </ul>
      {rest.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold text-blue-700 dark:text-blue-300">Lihat {rest.length} indikator lagi</summary>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {rest.map((indikator, index) => <li key={index}>{indikator}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

function normalizeTab(value: string | null): TabKey {
  if (value === "master") return "master";
  if (value === "mapping" || value === "referensi") return "mapping";
  if (value === "import" || value === "export") return "import";
  return "active";
}

function parseIndicatorJson(value?: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function cleanErrorMessage(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : fallback;
  return friendlyErrorMessage(raw).message;
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
