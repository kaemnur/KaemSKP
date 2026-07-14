export type SessionStatus = "connected" | "not_logged_in" | "expired" | "checking" | "error";

export type StatusLocal =
  | "draft"
  | "valid"
  | "invalid"
  | "needs_review"
  | "skipped"
  | "holiday"
  | "leave"
  | "no_plan";

export type StatusSkp =
  | "not_submitted"
  | "waiting_date"
  | "ready"
  | "submitted"
  | "failed"
  | "not_allowed_by_site"
  | "duplicate_detected"
  | "manual_marked_submitted";

export type DailyLog = {
  id: string;
  period_id: string;
  kode_log: string;
  tanggal: string;
  kode_skp: string | null;
  nama_skp: string | null;
  nama_aktivitas: string | null;
  deskripsi: string | null;
  indikator_kinerja_individu: string | null;
  kuantitas_output: string | null;
  satuan: string | null;
  link_tautan: string | null;
  status_local: StatusLocal;
  status_skp: StatusSkp;
  reason_type: string | null;
  reason_note: string | null;
  source_file: string | null;
  source_hash: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  last_error_code: string | null;
  current_url: string | null;
  automation_step: string | null;
  screenshot_path: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type SkpItem = {
  id: string;
  period_id: string;
  kode_skp: string;
  nama_skp: string;
  penugasan_dari: string | null;
  indikator_json: string | null;
  is_active: number;
  created_at: string | null;
  updated_at: string | null;
};

export type ParsedSkpProfile = {
  nama: string;
  nip: string;
  jabatan: string;
  unitKerja: string;
  periodeMulai: string;
  periodeAkhir: string;
  tahun: number;
};

export type ParsedSkpItem = {
  kode_skp: string;
  nomor: number;
  nama_skp: string;
  indikator: string[];
};

export type SkpPlanParseResult = {
  ok: true;
  fileName: string;
  profile: ParsedSkpProfile;
  skpItems: ParsedSkpItem[];
  warnings: string[];
};

export type SkpPlanSummary = {
  hasActivePlan: boolean;
  periodId: string | null;
  year: number | null;
  label: string | null;
  startDate: string | null;
  endDate: string | null;
  totalItems: number;
  sourceFile: string | null;
  importedAt: string | null;
};

export type CalendarDay = {
  id: string;
  period_id: string;
  date: string;
  day_name: string | null;
  is_weekend: number;
  is_public_holiday: number;
  is_leave: number;
  holiday_name: string | null;
  status: string;
  reason_type: string | null;
  reason_note: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type DashboardData = {
  sessionStatus: SessionStatus;
  activeYear: number;
  periodLabel: string;
  nextAutoRun: string;
  counts: Record<string, number>;
  today: {
    date: string;
    dayName: string;
    status: string;
    log?: DailyLog;
    reason?: string;
  };
  problems: Array<{
    tanggal: string;
    status: string;
    alasan: string;
    aksi: string;
  }>;
  autoRun: {
    enabled: boolean;
    startTime: string;
    retryInterval: number;
    retryUntil: string;
    lastStatus: string;
  };
  autoPost: {
    nextAutoPostAt: string | null;
    targetDate: string | null;
    dayName: string | null;
    timeLabel: string;
    timezone: string;
    enabled: boolean;
    workerStatus: string;
    sessionStatus: string;
    lastJobStatus: string;
    lastJobAt: string;
  };
  recentHistory: ActivityHistory[];
};

export type TodayLogState = "no_log" | "not_submitted" | "queued" | "running" | "submitted" | "failed" | "future" | "needs_review" | "error";

export type TodayLogStatus = {
  success: boolean;
  date: string;
  displayDate: string;
  hasLog: boolean;
  logCount: number;
  state: TodayLogState;
  sessionStatus: SessionStatus | string;
  requiresLogin: boolean;
  canSubmit: boolean;
  message: string;
  activeQueue: {
    id: string;
    jobId: string;
    status: string;
    startedAt: string | null;
    finishedAt: string | null;
  } | null;
  log: {
    id: string;
    tanggal: string;
    namaAktivitas: string | null;
    deskripsi: string | null;
    kodeSkp: string | null;
    namaSkp: string | null;
    statusLocal: StatusLocal;
    statusSkp: StatusSkp;
    lastSyncAt: string | null;
    lastError: string | null;
    lastErrorCode: string | null;
    currentUrl: string | null;
    automationStep: string | null;
    screenshotPath: string | null;
  } | null;
};

export type MonthlySuccessMonth = {
  month: number;
  label: string;
  successCount: number;
  totalCount: number;
  successRate: number;
};

export type MonthlySuccessData = {
  success: true;
  year: number;
  months: MonthlySuccessMonth[];
  summary: {
    totalSuccess: number;
    bestMonth: MonthlySuccessMonth | null;
    averagePerMonth: number;
  };
};

export type ActivityHistory = {
  id: string;
  event_type: string;
  title: string;
  message: string | null;
  entity_type: string | null;
  entity_id: string | null;
  severity: "info" | "success" | "warning" | "error" | null;
  created_at: string | null;
};

export type SubmitResult = {
  ok: boolean;
  status?: StatusSkp | "needs_user_action" | "unknown_needs_review";
  errorCode?: string;
  message?: string;
  screenshotPath?: string;
  currentUrl?: string;
  step?: string;
  validationText?: string;
  availableSkpOptions?: string[];
  foundOnSkp?: boolean;
};

export type SkpLogVerificationResult = {
  success: true;
  foundOnSkp: boolean;
  checkedAt: string;
  confidence: number;
  message: string;
  matchedText?: string;
  currentUrl?: string;
};

export type SkpSiteOption = {
  text: string;
  value: string;
};

export type ImportPreviewRow = {
  rowNumber: number;
  status: "Baru" | "Sama" | "Berubah" | "Perlu Review" | "Tidak Valid" | "Duplikat";
  errors: string[];
  notes?: string[];
  data: Partial<DailyLog> & {
    catatan_internal?: string;
    status_rencana?: string;
  };
};

export type ImportPreview = {
  id: string;
  filePath: string;
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
  rows: ImportPreviewRow[];
};

export type PeriodicQuarter = 1 | 2 | 3 | 4;

export type PeriodicStatus =
  | "not_created"
  | "preview_ready"
  | "partially_filled"
  | "filled_all"
  | "ready_to_submit_manual"
  | "submitted"
  | "failed_navigation"
  | "failed"
  | "needs_check";

export type PeriodicMode = "preview" | "fill" | "fill_submit";

export type PeriodicPreviewRow = {
  kode_skp: string;
  nama_skp: string;
  indikator: string[];
  logCount: number;
  realization: string;
  generatedRealization: string;
  feedbackLink: string;
  shouldFill: boolean;
  overwrite: boolean;
  status: "ready" | "no_logs" | "skip" | "needs_check" | "existing";
  statusLabel: string;
  notes: string[];
  logs: Array<{
    id: string;
    tanggal: string;
    nama_aktivitas: string | null;
    deskripsi: string | null;
    indikator_kinerja_individu: string | null;
    kuantitas_output: string | null;
    satuan: string | null;
    status_local: StatusLocal;
    status_skp: StatusSkp;
  }>;
};

export type PeriodicPreview = {
  ok: true;
  year: number;
  quarter: PeriodicQuarter;
  quarterLabel: string;
  dateFrom: string;
  dateTo: string;
  feedbackLink: string;
  baseUrl: string;
  targetUrl: string;
  status: PeriodicStatus;
  summary: {
    totalSkp: number;
    readyCount: number;
    noLogCount: number;
    selectedCount: number;
    totalLogs: number;
  };
  rows: PeriodicPreviewRow[];
};

export type PeriodicHistory = {
  id: string;
  period_id: string;
  year: number;
  quarter: number;
  total_skp: number;
  success_count: number;
  failed_count: number;
  submit_status: string | null;
  status: PeriodicStatus;
  mode: PeriodicMode;
  error_last: string | null;
  screenshot_path: string | null;
  created_at: string | null;
};

export type PeriodicFillItem = {
  kode_skp: string;
  nama_skp: string;
  realization: string;
  feedbackLink: string;
  shouldFill?: boolean;
  overwrite?: boolean;
};

export type PeriodicItemResult = {
  kode_skp: string;
  nama_skp: string;
  ok: boolean;
  status: "filled" | "skipped" | "failed" | "existing" | "submitted";
  message: string;
  screenshotPath?: string;
  currentUrl?: string;
  step?: string;
  availableInputs?: string[];
  availableButtons?: string[];
  headings?: string[];
  greenEditButtonCount?: number;
  currentSkpRow?: string;
};

export type PeriodicSubmitState =
  | "not_requested"
  | "submitted"
  | "already_submitted"
  | "button_not_found"
  | "button_disabled"
  | "not_ready"
  | "error";

export type PeriodicRunResult = {
  ok: boolean;
  year: number;
  quarter: PeriodicQuarter;
  status: PeriodicStatus;
  mode: PeriodicMode;
  totalItems: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  submitted: boolean;
  submitStatus: string;
  message: string;
  screenshotPath?: string;
  errorLast?: string;
  currentUrl?: string;
  baseUrl?: string;
  origin?: string;
  targetUrl?: string;
  expectedUrl?: string;
  step?: string;
  submitState?: PeriodicSubmitState;
  expectedPageTitle?: string;
  visiblePageTitle?: string;
  visibleHeading?: string;
  visibleTextSample?: string;
  greenEditButtonCount?: number;
  availableSidebarItems?: string[];
  availableButtons?: string[];
  clickedMenuText?: string;
  currentUrlBeforeClick?: string;
  currentUrlAfterClick?: string;
  items: PeriodicItemResult[];
};
