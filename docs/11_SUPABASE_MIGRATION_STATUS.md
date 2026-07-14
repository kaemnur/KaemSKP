# KaemSKP Supabase Migration Status

Tanggal audit: 2026-07-13

## SQLite audit

Database lokal tetap dipertahankan sebagai backup:

`C:\Users\kaemn\AppData\Roaming\KaemSKP\kaemskp.db`

| Tabel | Record |
| --- | ---: |
| settings | 22 |
| skp_periods | 1 |
| skp_items | 8 |
| skp_site_mappings | 8 |
| skp_plans | 1 |
| daily_logs | 185 |
| calendar_days | 365 |
| import_batches | 6 |
| sync_jobs | 25 |
| sync_job_items | 79 |
| periodic_history | 25 |
| activity_history | 110 |

Audit mentah tersimpan di `sqlite-audit.json`.

## Supabase schema

Migration tersedia di:

`supabase/migrations/20260713080000_initial_kaemskp_online.sql`

Tabel yang dibuat:

- `profiles`
- `skp_credentials`
- `skp_sessions`
- `skp_plans`
- `skp_plan_items`
- `daily_logs`
- `daily_log_submissions`
- `periodic_jobs`
- `periodic_job_items`
- `auto_post_settings`
- `holidays`
- `scheduler_jobs`
- `audit_logs`

Semua tabel memakai UUID, `user_id`, timestamp, index, RLS aktif, dan policy per user. Constraint anti-duplikasi scheduler:

`unique (user_id, job_type, scheduled_date)`

## Migration script

Script:

`npm run migrate:supabase`

Output:

`migration-report.json`

Status terakhir: belum dijalankan ke production karena `SUPABASE_SECRET_KEY`, `SUPABASE_DATABASE_URL`, dan `KAEMSKP_MIGRATION_USER_ID` belum tersedia. Script berhenti dengan status gagal terkontrol dan tidak menandai migrasi berhasil.

## Auto Post

Fungsi backend:

`src/main/scheduler/nextAutoPost.ts`

Test:

`npm run test:next-auto-post`

Kasus yang sudah lulus:

- Senin 07:59 ke Senin 08:00
- Senin 08:01 ke Selasa 08:00
- Jumat 08:01 ke Senin 08:00
- Senin libur ke Selasa 08:00

Dashboard mengambil `nextAutoPostAt` dari backend. Frontend hanya menghitung countdown dari timestamp tersebut.

## Blocking deployment

Production migration dan worker privileged masih menunggu:

- `SUPABASE_SECRET_KEY`
- `SUPABASE_DATABASE_URL`
- `SKP_CREDENTIAL_ENCRYPTION_KEY`
- `KAEMSKP_MIGRATION_USER_ID`

Jangan memakai anon atau publishable key untuk menggantikan nilai di atas.
