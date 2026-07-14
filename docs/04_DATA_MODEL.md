# Data Model — KaemSKP MVP Log Harian

## 1. Prinsip

Database harus multi-year ready.

Fokus awal adalah tahun 2026, tetapi tabel tidak boleh hardcoded hanya untuk 2026.

Gunakan SQLite lokal.

## 2. Tabel `settings`

Menyimpan pengaturan aplikasi.

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT
);
```

Contoh key:

```text
active_year
skp_base_url
auto_run_enabled
auto_run_start_time
retry_interval_minutes
retry_until_time
submit_mode
weekend_is_holiday
```

## 3. Tabel `skp_periods`

```sql
CREATE TABLE skp_periods (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  label TEXT NOT NULL,
  is_active INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);
```

Contoh:

```text
id: period-2026
year: 2026
start_date: 2026-01-01
end_date: 2026-12-31
label: SKP Tahun 2026
is_active: 1
```

## 4. Tabel `skp_items`

```sql
CREATE TABLE skp_items (
  id TEXT PRIMARY KEY,
  period_id TEXT NOT NULL,
  kode_skp TEXT NOT NULL,
  nama_skp TEXT NOT NULL,
  penugasan_dari TEXT,
  indikator_json TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT,
  updated_at TEXT,
  UNIQUE(period_id, kode_skp)
);
```

Seed data 2026:

```text
SKP-2026-01
SKP-2026-02
SKP-2026-03
SKP-2026-04
SKP-2026-05
SKP-2026-06
SKP-2026-07
SKP-2026-08
```

## 5. Tabel `skp_site_mappings`

Menyimpan mapping antara master SKP lokal dan pilihan dropdown situs.

```sql
CREATE TABLE skp_site_mappings (
  id TEXT PRIMARY KEY,
  period_id TEXT NOT NULL,
  kode_skp TEXT NOT NULL,
  local_skp_name TEXT NOT NULL,
  site_option_text TEXT,
  site_option_value TEXT,
  match_status TEXT NOT NULL,
  last_checked_at TEXT,
  created_at TEXT,
  updated_at TEXT,
  UNIQUE(period_id, kode_skp)
);
```

Nilai `match_status`:

```text
matched
partial
manual
not_found
needs_review
```

## 6. Tabel `daily_logs`

```sql
CREATE TABLE daily_logs (
  id TEXT PRIMARY KEY,
  period_id TEXT NOT NULL,
  kode_log TEXT NOT NULL,
  tanggal TEXT NOT NULL,
  kode_skp TEXT,
  nama_aktivitas TEXT,
  deskripsi TEXT,
  kuantitas_output TEXT,
  satuan TEXT,
  link_tautan TEXT,
  status_local TEXT NOT NULL,
  status_skp TEXT NOT NULL,
  reason_type TEXT,
  reason_note TEXT,
  source_file TEXT,
  source_hash TEXT,
  last_sync_at TEXT,
  last_error TEXT,
  created_at TEXT,
  updated_at TEXT,
  UNIQUE(period_id, kode_log)
);
```

## 7. Status `daily_logs`

### `status_local`

```text
draft
valid
invalid
needs_review
skipped
holiday
leave
no_plan
```

### `status_skp`

```text
not_submitted
waiting_date
ready
submitted
failed
not_allowed_by_site
duplicate_detected
manual_marked_submitted
```

### `reason_type`

Digunakan untuk tanggal yang tidak dibuatkan log.

```text
weekend
public_holiday
leave
sick_leave
no_work_plan
manual_skip
site_not_allowed
other
```

## 8. Tabel `calendar_days`

Tabel ini menyimpan status tanggal, termasuk alasan tanggal tidak perlu log.

```sql
CREATE TABLE calendar_days (
  id TEXT PRIMARY KEY,
  period_id TEXT NOT NULL,
  date TEXT NOT NULL,
  day_name TEXT,
  is_weekend INTEGER DEFAULT 0,
  is_public_holiday INTEGER DEFAULT 0,
  is_leave INTEGER DEFAULT 0,
  holiday_name TEXT,
  status TEXT NOT NULL,
  reason_type TEXT,
  reason_note TEXT,
  created_at TEXT,
  updated_at TEXT,
  UNIQUE(period_id, date)
);
```

Status:

```text
working_day
weekend
public_holiday
leave
sick_leave
no_plan
has_log
submitted
missing
future
needs_review
failed
```

## 9. Tabel `import_batches`

```sql
CREATE TABLE import_batches (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_path TEXT,
  file_hash TEXT,
  import_type TEXT NOT NULL,
  period_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  total_rows INTEGER DEFAULT 0,
  new_rows INTEGER DEFAULT 0,
  updated_rows INTEGER DEFAULT 0,
  unchanged_rows INTEGER DEFAULT 0,
  invalid_rows INTEGER DEFAULT 0,
  created_at TEXT
);
```

`mode`:

```text
append_new
update_changed
replace_period
preview_only
```

## 10. Tabel `sync_jobs`

```sql
CREATE TABLE sync_jobs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  period_id TEXT NOT NULL,
  date_from TEXT,
  date_to TEXT,
  status TEXT NOT NULL,
  total_items INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  skipped_count INTEGER DEFAULT 0,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT
);
```

`job_type`:

```text
run_today
run_missed
run_range
retry_failed
auto_run
```

## 11. Tabel `sync_job_items`

```sql
CREATE TABLE sync_job_items (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  daily_log_id TEXT NOT NULL,
  tanggal TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER DEFAULT 0,
  error_message TEXT,
  screenshot_path TEXT,
  started_at TEXT,
  finished_at TEXT
);
```

Status:

```text
queued
running
success
failed
skipped
needs_review
```

## 12. Tabel `activity_history`

```sql
CREATE TABLE activity_history (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  entity_type TEXT,
  entity_id TEXT,
  severity TEXT,
  created_at TEXT
);
```

Severity:

```text
info
success
warning
error
```

## 13. Seed Master SKP 2026

```json
[
  {
    "kode_skp": "SKP-2026-01",
    "nama_skp": "Tersalurkannya Dana Bantuan Sosial PIP kepada Siswa SMP/Paket B"
  },
  {
    "kode_skp": "SKP-2026-02",
    "nama_skp": "Tersalurkannya Dana Bantuan Sosial PIP kepada Siswa SD/Paket A"
  },
  {
    "kode_skp": "SKP-2026-03",
    "nama_skp": "Tersalurkannya Dana Bantuan Sosial PIP kepada Siswa SMA/Paket C"
  },
  {
    "kode_skp": "SKP-2026-04",
    "nama_skp": "Tersalurkannya Dana Bantuan Sosial PIP kepada Siswa SMK/Paket C"
  },
  {
    "kode_skp": "SKP-2026-05",
    "nama_skp": "Terlaksananya Kegiatan Penunjang Pelaksanaan PIP TA 2026"
  },
  {
    "kode_skp": "SKP-2026-06",
    "nama_skp": "Teradministrasikannya Data Usulan Calon Penerima PIP"
  },
  {
    "kode_skp": "SKP-2026-07",
    "nama_skp": "Teradministrasikannya Data Siswa Penerima PIP"
  },
  {
    "kode_skp": "SKP-2026-08",
    "nama_skp": "Terkelolanya Media Sosial Sobat PIP"
  }
]
```
