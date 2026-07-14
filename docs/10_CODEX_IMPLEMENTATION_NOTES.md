# Codex Implementation Notes — KaemSKP

## 1. Objective

Build **KaemSKP**, a local Windows desktop app for automatic SKP Log Harian filling.

Current scope: Log Harian only.

Do not implement Rencana SKP module yet.

## 2. Important Rules

- Do not hardcode password.
- Do not commit `.env.local`.
- Do not send user data to any external server.
- Do not bypass captcha/OTP.
- Do not submit future dates.
- Do not submit already submitted logs unless replace mode is explicitly selected.
- If unsure, mark `needs_review`.

## 3. Preferred Stack

Use:

- Electron
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- Lucide React
- Playwright
- SQLite
- ExcelJS
- electron-builder

## 4. UI Style

Use:

- Accessible & Ethical
- Minimalism & Swiss Style
- Bento dashboard cards
- Sidebar layout
- Light mode default
- Clean professional government/ASN workflow UI

## 5. Required Pages

Implement these pages:

```text
/dashboard
/logs
/import
/mapping-skp
/queue
/calendar
/history
/settings
```

For Electron renderer, routes can be implemented via React Router.

## 6. Required Buttons

Dashboard:

- Jalankan Hari Ini
- Jalankan Semua yang Terlewat
- Buka SKP
- Login Ulang SKP

Logs page:

- Tambah Manual
- Edit
- Jalankan
- Lewati
- Tandai Libur/Cuti

Import page:

- Upload Excel
- Preview
- Simpan Import

Queue page:

- Jalankan Periode Terpilih
- Retry Gagal
- Pause
- Resume

Settings:

- Test Login
- Hapus Session
- Simpan Pengaturan

## 7. Automation Must Be Abstracted

Create an automation service:

```text
src/main/automation/skpAutomation.ts
```

Functions:

```ts
openLogin(): Promise<void>
checkSession(): Promise<SessionStatus>
openLogHarian(): Promise<void>
submitDailyLog(log: DailyLog): Promise<SubmitResult>
fetchSkpDropdownOptions(): Promise<SkpSiteOption[]>
```

## 8. Database Service

Create a database service:

```text
src/main/db/
```

Functions:

```ts
initDatabase()
seedPeriod2026()
seedSkpItems2026()
upsertDailyLogs()
listDailyLogs()
updateDailyLogStatus()
listCalendarStatus()
createSyncJob()
updateSyncJobItem()
```

## 9. Excel Service

Create:

```text
src/main/import/excelImportService.ts
```

Functions:

```ts
previewExcelImport(filePath, options)
commitExcelImport(previewId, mode)
validateDailyLogRow(row)
```

## 10. Scheduler Service

Create:

```text
src/main/scheduler/autoRunScheduler.ts
```

Functions:

```ts
startScheduler()
stopScheduler()
runToday()
runMissed()
runRange(dateFrom, dateTo)
```

## 11. Status Logic

Use these statuses consistently:

```text
status_local:
draft
valid
invalid
needs_review
skipped
holiday
leave
no_plan

status_skp:
not_submitted
waiting_date
ready
submitted
failed
not_allowed_by_site
duplicate_detected
manual_marked_submitted
```

## 12. Dashboard Cards

Dashboard must compute from SQLite:

- Hari Ini
- Belum Terisi
- Terlewat
- Berhasil Terkirim
- Gagal
- Menunggu Tanggal
- Libur/Cuti/Tanggal Merah
- Perlu Review

## 13. Seed Data

Seed active period:

```text
2026-01-01 to 2026-12-31
```

Seed SKP items:

- SKP-2026-01 to SKP-2026-08

## 14. Packaging

Use electron-builder to produce:

```text
KaemSKP Setup 1.0.0.exe
```

Installer must create:

- Desktop shortcut.
- Start Menu shortcut.

## 15. First Implementation Order

1. Project setup.
2. Layout/sidebar.
3. SQLite init + seed.
4. Dashboard static.
5. Excel import.
6. Logs CRUD.
7. Calendar status.
8. SKP mapping.
9. Playwright login/session.
10. Submit one log.
11. Run today.
12. Run missed.
13. Scheduler/tray.
14. Installer.
