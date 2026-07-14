# Acceptance Criteria — KaemSKP MVP Log Harian

## 1. App Launch

- Aplikasi bisa dibuka dari shortcut KaemSKP.
- User tidak perlu membuka terminal.
- User tidak perlu mengetik localhost.
- Window utama tampil dengan sidebar dan dashboard.

## 2. Data Tahun 2026

- Aplikasi memiliki periode aktif 2026.
- Periode tampil sebagai 01 Januari 2026 - 31 Desember 2026.
- Master SKP 2026 tersedia dengan 8 item.
- Struktur data bisa menerima periode tahun lain di masa depan.

## 3. Import Excel

- User bisa upload `.xlsx`.
- Aplikasi membaca sheet `Log_Harian_2026`.
- Aplikasi memvalidasi kolom wajib.
- Aplikasi menampilkan preview data.
- Aplikasi menandai baris tidak valid.
- Aplikasi mendukung mode:
  - tambah baru,
  - update berubah,
  - ganti periode,
  - preview saja.
- Data berhasil disimpan ke SQLite.

## 4. Dashboard

Dashboard harus menampilkan:

- Status session SKP.
- Tahun aktif.
- Jadwal auto run.
- Log hari ini.
- Jumlah log terkirim.
- Jumlah log belum terkirim.
- Jumlah tanggal terlewat.
- Jumlah gagal.
- Jumlah tanggal libur/cuti/tanggal merah.
- Daftar tanggal bermasalah.
- Tombol:
  - Jalankan Hari Ini.
  - Jalankan Semua yang Terlewat.
  - Buka SKP.

## 5. Kalender Status

- Kalender menampilkan status tiap tanggal.
- Weekend ditandai libur jika pengaturan aktif.
- Tanggal merah/cuti bisa ditambahkan manual atau dari Excel.
- Tanggal tanpa log memiliki alasan.
- Klik tanggal membuka detail.
- Tanggal masa depan tidak bisa dijalankan otomatis.

## 6. Login SKP

- Aplikasi membuka halaman SKP.
- User dapat login Non Portal.
- Session disimpan lokal.
- Aplikasi dapat mendeteksi session aktif.
- Jika session expired, aplikasi meminta login ulang.
- Password tidak tersimpan di source code.

## 7. Automation Isi Log

Untuk satu data log valid:

- Aplikasi membuka halaman Log Harian.
- Aplikasi klik Tambah Log.
- Aplikasi mengisi:
  - Tanggal,
  - Nama Aktivitas,
  - Deskripsi,
  - SKP,
  - Kuantitas Output,
  - Satuan,
  - Link/Tautan.
- Aplikasi klik Simpan sesuai mode submit.
- Status lokal berubah menjadi `submitted` jika berhasil.
- Jika gagal, status menjadi `failed` dan error tercatat.

## 8. Jalankan Hari Ini

- Tombol memproses hanya tanggal hari ini.
- Jika tidak ada data, tampilkan pesan.
- Jika sudah submitted, jangan submit ulang.
- Jika hari ini libur/cuti, tampilkan alasan dan jangan submit.

## 9. Jalankan Semua yang Terlewat

- Tombol memproses semua log pending dengan tanggal <= hari ini.
- Tidak memproses tanggal masa depan.
- Urutan proses berdasarkan tanggal naik.
- Jika satu tanggal gagal, proses tanggal lain tetap lanjut.
- Hasil batch tampil di riwayat.

## 10. Scheduler

- Auto run dapat diaktifkan/nonaktifkan.
- Default jam mulai 08:00.
- Retry interval dapat diatur.
- Jika berhasil, tidak retry lagi.
- Jika gagal sampai batas waktu, status gagal dan muncul notifikasi.
- Close app dapat minimize to tray.

## 11. Keamanan

- Tidak ada password di repo.
- `.env.local` masuk `.gitignore`.
- Session bisa dihapus.
- Screenshot error bisa dimatikan.
- Data tidak dikirim ke server eksternal.

## 12. Packaging

- Bisa build installer Windows.
- Installer membuat Desktop Shortcut.
- Installer membuat Start Menu Shortcut.
- App menyimpan data di `%APPDATA%\KaemSKP`.
