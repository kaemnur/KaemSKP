# KaemSKP Docs v0.1

## Ringkasan

**KaemSKP** adalah aplikasi lokal Windows untuk membantu pengisian **Log Harian SKP** secara otomatis berdasarkan data yang diimpor dari Excel.

Scope MVP saat ini hanya:

- Login ke situs SKP melalui browser automation lokal.
- Menyimpan session login secara lokal.
- Import rencana Log Harian dari Excel.
- Edit data Log Harian di aplikasi.
- Mengisi Log Harian otomatis ke situs SKP.
- Menjalankan otomatis setiap hari kerja.
- Mengisi hari yang terlewat secara batch jika situs SKP masih mengizinkan.
- Menampilkan dashboard lengkap status log per tanggal.
- Menandai alasan tanggal tidak dibuatkan log, misalnya hari libur, tanggal merah, cuti, atau tidak ada rencana kerja.

## Scope yang belum dibuat

Modul berikut belum menjadi fokus MVP:

- Input Rencana SKP.
- Penilaian SKP.
- Realisasi SKP.
- Arsip SKP.
- Pesan, notifikasi internal SKP, dan fitur lain di situs SKP.

Rencana SKP hanya dipakai sebagai referensi daftar pilihan SKP untuk field Log Harian.

## Target Platform

- Windows desktop.
- Aplikasi dibuka dari shortcut **KaemSKP**.
- Tidak perlu menjalankan localhost manual.
- Aplikasi boleh berjalan di system tray.
- Data disimpan lokal di perangkat pengguna.

## Rekomendasi Stack

- Electron
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- Playwright
- SQLite
- ExcelJS atau SheetJS
- electron-builder

## Referensi UI/UX

Gunakan pendekatan dari repo:

https://github.com/nextlevelbuilder/ui-ux-pro-max-skill

Style yang dipilih:

- Accessible & Ethical
- Minimalism & Swiss Style
- Bento dashboard cards
- Real-time monitoring dashboard
- Light mode default
- Bahasa Indonesia formal dan mudah dipahami

## Dokumen dalam paket ini

1. `01_PRD.md` — Product Requirement Document.
2. `02_SDD.md` — Software Design Document.
3. `03_UI_UX_SPEC.md` — Spesifikasi UI/UX.
4. `04_DATA_MODEL.md` — Struktur database lokal.
5. `05_AUTOMATION_FLOW.md` — Alur browser automation SKP.
6. `06_EXCEL_TEMPLATE.md` — Format template Excel Log Harian.
7. `07_SECURITY_PRIVACY.md` — Keamanan, session, password, dan privasi.
8. `08_ROADMAP.md` — Tahapan pengembangan.
9. `09_ACCEPTANCE_CRITERIA.md` — Kriteria selesai.
10. `10_CODEX_IMPLEMENTATION_NOTES.md` — Catatan implementasi untuk Codex.
