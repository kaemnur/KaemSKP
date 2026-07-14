# Roadmap — KaemSKP MVP Log Harian

## Phase 0 — Dokumentasi

Output:

- PRD
- SDD
- UI/UX Spec
- Data Model
- Automation Flow
- Excel Template
- Security Spec
- Acceptance Criteria

Status: current.

## Phase 1 — Project Setup

Target:

- Electron + React + TypeScript.
- Tailwind + shadcn/ui.
- SQLite initialized.
- App opens via desktop shortcut in dev/prod.
- Basic layout sidebar.

Deliverable:

```text
KaemSKP dev app running
```

## Phase 2 — Local Data & Master SKP

Target:

- Seed periode 2026.
- Seed master SKP 2026.
- CRUD daily logs.
- Calendar days generation.

Deliverable:

```text
Database lokal siap dan data 2026 tersedia.
```

## Phase 3 — Import Excel

Target:

- Upload `.xlsx`.
- Validasi template.
- Preview.
- Mode update:
  - tambah baru,
  - update berubah,
  - ganti periode,
  - preview saja.
- Simpan ke SQLite.

Deliverable:

```text
User bisa import rencana Log Harian.
```

## Phase 4 — Dashboard & Calendar Status

Target:

- Dashboard ringkasan.
- Status tanggal lengkap.
- Kalender bulanan.
- Tanggal bermasalah.
- Alasan tidak dibuatkan log:
  - weekend,
  - tanggal merah,
  - cuti,
  - sakit,
  - tidak ada rencana,
  - skip manual.

Deliverable:

```text
User bisa melihat status semua tanggal.
```

## Phase 5 — Login Session SKP

Target:

- Open browser login.
- Login Non Portal.
- Simpan session.
- Cek session.
- Hapus session.

Deliverable:

```text
KaemSKP dapat membuka SKP dengan session lokal.
```

## Phase 6 — Automation Isi Log

Target:

- Buka halaman Log Harian.
- Klik Tambah Log.
- Isi field.
- Pilih SKP.
- Klik Simpan.
- Simpan status.

Deliverable:

```text
KaemSKP bisa mengisi 1 log harian.
```

## Phase 7 — Batch & Retry

Target:

- Jalankan Hari Ini.
- Jalankan Semua yang Terlewat.
- Jalankan Periode Terpilih.
- Retry jika gagal.
- Lanjut item berikutnya jika batch error.

Deliverable:

```text
KaemSKP bisa mengisi banyak tanggal.
```

## Phase 8 — Scheduler & Tray

Target:

- System tray.
- Auto run jam 08:00.
- Retry sampai jam 16:00.
- Notifikasi Windows.
- Close minimize to tray.

Deliverable:

```text
KaemSKP bisa berjalan otomatis harian.
```

## Phase 9 — Packaging

Target:

- Build Windows installer.
- Desktop shortcut.
- Start Menu shortcut.
- App icon.
- Versioning.

Deliverable:

```text
KaemSKP Setup 1.0.0.exe
```

## Phase 10 — Stabilization

Target:

- Error handling.
- Screenshot error.
- Log detail.
- Backup/restore database.
- UI polish.
- Testing dengan data real 2026.

Deliverable:

```text
KaemSKP MVP stabil.
```
