# PRD — KaemSKP MVP Log Harian

## 1. Nama Produk

**KaemSKP**

## 2. Tujuan Produk

KaemSKP dibuat untuk membantu pengguna mengisi **Log Harian SKP** secara otomatis setiap hari berdasarkan data rencana log yang sudah disiapkan dalam file Excel.

Aplikasi ini tidak menggantikan sistem SKP resmi. KaemSKP hanya bertindak sebagai alat bantu lokal untuk membuka situs SKP, mengisi form, dan menyimpan status pengisian.

## 3. Scope MVP

MVP hanya fokus pada **Log Harian**.

### Termasuk dalam MVP

- Login manual/otomatis terbatas ke situs SKP melalui browser automation lokal.
- Penggunaan session browser lokal.
- Import Excel rencana Log Harian.
- Edit data Log Harian di aplikasi.
- Validasi kelengkapan data.
- Mapping data Excel ke form Tambah Log Harian.
- Auto-run harian.
- Tombol manual:
  - Jalankan Hari Ini.
  - Jalankan Semua yang Terlewat.
  - Jalankan Periode Terpilih.
- Dashboard status tanggal:
  - Sudah terisi.
  - Belum terisi.
  - Menunggu tanggal.
  - Hari libur.
  - Tanggal merah.
  - Cuti.
  - Tidak ada rencana kerja.
  - Gagal kirim.
  - Perlu review.
- Riwayat submit.
- Screenshot error opsional.
- Export laporan status lokal.

### Tidak termasuk dalam MVP

- Pembuatan Rencana SKP.
- Edit Rencana SKP di situs.
- Pengajuan SKP.
- Realisasi SKP.
- Penilaian SKP.
- Integrasi API resmi, karena situs SKP tidak menyediakan API untuk kebutuhan ini.

## 4. Situs Target

Base URL:

```text
https://skp.sdm.kemendikdasmen.go.id
```

Halaman Log Harian:

```text
/skp/pegawai/logharian/cal.jsp
```

Alur login:

1. Buka base URL.
2. Pilih **Login Non Portal**.
3. Isi username/NIP.
4. Isi password.
5. Masuk ke dashboard.
6. Buka halaman Log Harian.

## 5. Login dan Kredensial

Username/NIP dapat disimpan di pengaturan lokal.

Password tidak boleh ditulis di dokumentasi, prompt, atau source code. Password harus dimasukkan pengguna sendiri melalui salah satu cara:

- Halaman pengaturan lokal KaemSKP.
- File `.env.local` hanya untuk development.
- Secret lokal terenkripsi untuk versi aplikasi.

Rekomendasi produksi:

- Simpan session browser lokal.
- Jangan simpan password jika tidak diperlukan.
- Sediakan tombol **Hapus Session SKP**.

## 6. Data Form Log Harian

Field form Tambah Log Harian yang terlihat:

| Field Situs SKP | Keterangan |
|---|---|
| Tanggal | Wajib |
| Nama Aktivitas | Wajib |
| Deskripsi | Wajib, minimal 10 karakter |
| SKP | Dropdown referensi SKP |
| Kuantitas Output | Opsional/terkait output |
| Satuan | Opsional/terkait output |
| Link / Tautan | Opsional |
| Simpan | Tombol submit/simpan |

## 7. Perilaku Harian

KaemSKP harus bisa berjalan otomatis pada hari kerja.

Default:

```text
Jam mulai cek: 08:00 WIB
Retry: setiap 10 menit
Batas retry: sampai 16:00 WIB
```

Jika berhasil, tidak perlu retry lagi.

Jika belum bisa submit, aplikasi menunggu dan mencoba ulang.

Jika session expired, aplikasi menampilkan notifikasi agar pengguna login ulang.

## 8. Hari Terlewat

Jika ada tanggal sebelumnya yang belum terisi, KaemSKP harus bisa mengisi sekaligus melalui tombol:

```text
Jalankan Semua yang Terlewat
```

Aturan:

- Hanya memproses tanggal `<= hari ini`.
- Tidak memproses tanggal masa depan.
- Tetap mengikuti validasi situs SKP.
- Jika situs tidak mengizinkan tanggal tertentu, status menjadi `Tidak Diizinkan Situs` atau `Gagal`.

## 9. Tanggal Masa Depan

Tanggal masa depan tidak boleh dikirim sebelum waktunya.

Status untuk tanggal masa depan:

```text
Menunggu Tanggal
```

## 10. Import Data

KaemSKP harus bisa import data:

- Per bulan.
- Per tahun.

Setelah import, user dapat:

- Mengedit langsung di KaemSKP.
- Upload ulang file Excel.
- Memilih mode update:
  - Tambah data baru saja.
  - Perbarui data yang berubah.
  - Ganti semua data periode ini.
  - Preview perubahan sebelum simpan.

## 11. Mode Sinkron ke Situs SKP

Mode yang harus tersedia:

| Mode | Fungsi |
|---|---|
| Hanya data baru | Mengirim log yang belum pernah dikirim |
| Kirim ulang yang gagal | Mengirim ulang log berstatus gagal |
| Jalankan semua yang terlewat | Mengirim semua pending sampai hari ini |
| Ganti data lama | Untuk update/replace, jika situs menyediakan edit/hapus |
| Manual per tanggal | User memilih tanggal tertentu |

Untuk MVP awal, prioritas:

1. Hanya data baru.
2. Kirim ulang yang gagal.
3. Jalankan semua yang terlewat.

## 12. Tahun Aktif

Fokus awal:

```text
Tahun aktif: 2026
Periode: 01 Januari 2026 - 31 Desember 2026
```

Tetapi struktur aplikasi harus multi-year ready agar dapat digunakan untuk 2027 dan seterusnya.

## 13. Master SKP 2026

Daftar SKP 2026 dari dokumen referensi:

| Kode | Hasil Kerja |
|---|---|
| SKP-2026-01 | Tersalurkannya Dana Bantuan Sosial PIP kepada Siswa SMP/Paket B |
| SKP-2026-02 | Tersalurkannya Dana Bantuan Sosial PIP kepada Siswa SD/Paket A |
| SKP-2026-03 | Tersalurkannya Dana Bantuan Sosial PIP kepada Siswa SMA/Paket C |
| SKP-2026-04 | Tersalurkannya Dana Bantuan Sosial PIP kepada Siswa SMK/Paket C |
| SKP-2026-05 | Terlaksananya Kegiatan Penunjang Pelaksanaan PIP TA 2026 |
| SKP-2026-06 | Teradministrasikannya Data Usulan Calon Penerima PIP |
| SKP-2026-07 | Teradministrasikannya Data Siswa Penerima PIP |
| SKP-2026-08 | Terkelolanya Media Sosial Sobat PIP |

## 14. Prioritas MVP

Prioritas pengerjaan:

1. Desktop shell + shortcut.
2. Database lokal.
3. Import Excel.
4. Dashboard status.
5. Login/session SKP.
6. Automation tambah log.
7. Scheduler harian.
8. Batch tanggal terlewat.
9. Riwayat dan error handling.
