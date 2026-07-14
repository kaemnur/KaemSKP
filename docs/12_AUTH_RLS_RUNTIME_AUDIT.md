# Auth, RLS, and Periodic Job Item Audit

Tanggal audit: 2026-07-13

## periodic_job_items

Status: tidak dimigrasikan dan tidak dibuat dummy.

Alasan:
- SQLite hanya menyimpan ringkasan proses periodik di `periodic_history`.
- Tidak ada tabel SQLite yang menyimpan rincian item periodik per SKP/per run.
- Rincian periodik dibuat dinamis oleh `generatePeriodicPreview()` dari `skp_items` dan `daily_logs`.
- Hasil item dari Playwright digunakan sebagai response runtime, lalu hanya ringkasan run yang disimpan ke `periodic_history`.
- UI riwayat periodik membaca `/api/periodic/history`, yang bersumber dari `periodic_history`, bukan `periodic_job_items`.

Validasi:
- SQLite `periodic_history`: 25 rows.
- Supabase `periodic_jobs`: 25 rows.
- Supabase `periodic_job_items`: 0 rows.
- Source detail persisten: tidak ada.

Keputusan:
- `periodic_job_items` tetap kosong sampai aplikasi benar-benar menyimpan detail item periodik per run.
- Tidak ada migrasi sintetis dari preview karena itu akan menjadi data turunan/dummy, bukan data historis yang pernah dipersist.

## Runtime Auth/RLS

Runtime backend Supabase wajib menerima user dari JWT Supabase yang valid. Service role boleh dipakai di backend hanya setelah JWT valid, dan query tetap dibatasi dengan `user_id` dari token.

`KAEMSKP_MIGRATION_USER_ID` tetap hanya untuk skrip migrasi/test sumber data, bukan identitas runtime permanen.

## Credential dan Session SKP

Credential dan session SKP disimpan sebagai envelope AES-256-GCM:

`v1:base64(iv):base64(auth_tag):base64(ciphertext)`

Frontend hanya menerima status configured/valid/expired/unknown. Password, cookie, storage state, JWT, dan encryption key tidak dikirim balik ke frontend.
