# UI/UX Spec — KaemSKP MVP Log Harian

## 1. Referensi Desain

Gunakan pendekatan dari:

```text
ui-ux-pro-max-skill
```

Gaya yang dipilih:

- Accessible & Ethical
- Minimalism & Swiss Style
- Bento Box Dashboard
- Real-time Monitoring Dashboard
- Enterprise/government-friendly

## 2. Karakter Visual

| Elemen | Arah |
|---|---|
| Mode default | Light |
| Nuansa | Profesional, bersih, rapi |
| Target pengguna | Pegawai/ASN/operator administrasi |
| Bahasa | Indonesia |
| Navigasi | Sidebar kiri |
| Dashboard | Card-based |
| Warna utama | Navy / blue |
| Status berhasil | Green |
| Warning | Amber |
| Error | Red |
| Netral | Slate/gray |

## 3. Struktur Menu

Sidebar utama:

```text
Dashboard
Log Harian
Import Data
Mapping SKP
Antrean
Kalender Status
Riwayat
Pengaturan
Bantuan
```

Untuk MVP, menu yang wajib:

1. Dashboard
2. Log Harian
3. Import Data
4. Mapping SKP
5. Antrean
6. Kalender Status
7. Riwayat
8. Pengaturan

## 4. Dashboard

Dashboard harus menampilkan ringkasan lengkap.

### 4.1 Header Dashboard

Elemen:

- Tahun aktif: 2026
- Periode: 01 Januari 2026 - 31 Desember 2026
- Status session SKP:
  - Terhubung
  - Perlu login ulang
  - Belum login
- Jadwal auto run berikutnya
- Tombol:
  - Jalankan Hari Ini
  - Jalankan Semua yang Terlewat
  - Buka SKP

### 4.2 Card Ringkasan

Card wajib:

| Card | Isi |
|---|---|
| Log Hari Ini | Status tanggal hari ini |
| Belum Terisi | Jumlah log sampai hari ini yang belum terkirim |
| Terlewat | Jumlah tanggal kerja yang lewat dan belum terkirim |
| Berhasil Terkirim | Jumlah log submitted |
| Gagal | Jumlah log failed |
| Menunggu Tanggal | Jumlah log masa depan |
| Libur / Cuti | Jumlah tanggal yang sengaja tidak dibuatkan log |
| Perlu Review | Data yang belum valid atau mapping SKP belum cocok |

### 4.3 Panel Hari Ini

Tampilkan:

```text
Tanggal: 02 Juli 2026
Status: Siap Dikirim / Terkirim / Tidak Ada Rencana / Libur
Nama Aktivitas
SKP terkait
Mode submit
Aksi cepat
```

Aksi:

- Preview
- Edit
- Jalankan
- Tandai Libur/Cuti
- Lewati

### 4.4 Panel Tanggal Bermasalah

Tampilkan daftar tanggal yang perlu perhatian.

Kolom:

| Tanggal | Status | Alasan | Aksi |
|---|---|---|---|
| 2026-07-06 | Belum Dibuat | Tidak ada data import | Buat/Edit |
| 2026-07-08 | Gagal | SKP tidak ditemukan | Perbaiki Mapping |
| 2026-07-11 | Libur | Sabtu | Lihat |
| 2026-07-12 | Libur | Minggu | Lihat |

### 4.5 Panel Auto Run

Isi:

- Auto Run: Aktif/Tidak Aktif
- Jam mulai: 08:00
- Retry: 10 menit
- Batas waktu: 16:00
- Status terakhir: Berhasil/Gagal/Belum jalan
- Log proses terakhir

## 5. Halaman Log Harian

Fungsi:

- Menampilkan daftar log.
- Filter berdasarkan bulan, status, SKP, keyword.
- Edit data.
- Tambah manual.
- Hapus lokal.
- Tandai sebagai libur/cuti/tidak perlu log.
- Jalankan per item.

Kolom tabel:

| Kolom |
|---|
| Tanggal |
| Kode Log |
| Nama Aktivitas |
| SKP |
| Output |
| Status |
| Alasan |
| Terakhir Sinkron |
| Aksi |

Aksi per baris:

- Preview
- Edit
- Jalankan
- Tandai Terkirim Manual
- Lewati
- Hapus Lokal

## 6. Halaman Import Data

### 6.1 Stepper Import

Gunakan stepper:

```text
1. Upload File
2. Validasi Kolom
3. Preview Data
4. Pilih Mode Update
5. Simpan
```

### 6.2 Mode Update

Pilihan:

| Mode | Penjelasan |
|---|---|
| Tambah data baru saja | Data lama tidak diubah |
| Perbarui data yang berubah | Cocok untuk upload ulang revisi |
| Ganti data periode ini | Hapus data lokal pada bulan/tahun terkait lalu ganti |
| Preview saja | Tidak menyimpan, hanya melihat hasil |

### 6.3 Preview Perubahan

Tampilkan status:

- Baru
- Berubah
- Sama
- Duplikat
- Tidak Valid
- Akan Dihapus jika mode ganti periode

## 7. Halaman Mapping SKP

Tampilkan master SKP dan hasil mapping ke dropdown situs.

Kolom:

| Kode SKP | Master SKP | Teks Dropdown Situs | Status | Aksi |
|---|---|---|---|---|

Status:

- Cocok
- Cocok Sebagian
- Perlu Review
- Tidak Ditemukan

Aksi:

- Refresh dari situs
- Edit mapping manual
- Simpan mapping

## 8. Halaman Antrean

Menampilkan daftar yang akan dijalankan.

Filter:

- Hari ini
- Terlewat
- Periode
- Gagal
- Siap Dikirim

Aksi:

- Jalankan Hari Ini
- Jalankan Semua yang Terlewat
- Jalankan Periode Terpilih
- Pause
- Resume

## 9. Halaman Kalender Status

Kalender bulanan dengan warna status.

Status warna:

| Status | Warna |
|---|---|
| Terkirim | Hijau |
| Siap Dikirim | Biru |
| Belum Dibuat | Amber |
| Gagal | Merah |
| Libur/Cuti | Abu-abu |
| Tanggal Merah | Abu-abu/merah muda |
| Menunggu Tanggal | Slate |
| Perlu Review | Ungu/amber |

Klik tanggal membuka panel detail:

- Tanggal
- Hari
- Status
- Alasan
- Data log jika ada
- Aksi:
  - Buat/Edit Log
  - Tandai Libur
  - Tandai Cuti
  - Tandai Tidak Ada Rencana
  - Jalankan Tanggal Ini

## 10. Halaman Riwayat

Tabel riwayat:

| Waktu | Tanggal Log | Aksi | Hasil | Pesan |
|---|---|---|---|---|

Aksi:

- Lihat detail
- Buka screenshot error
- Retry

## 11. Halaman Pengaturan

Section:

### Akun SKP

- Username/NIP
- Password lokal
- Tombol Simpan
- Tombol Test Login
- Tombol Hapus Session

### Jadwal Auto Run

- Aktifkan Auto Run
- Jam mulai
- Retry interval
- Batas waktu
- Hanya hari kerja
- Jalankan saat Windows menyala

### Hari Libur

- Weekend otomatis libur
- Import daftar tanggal merah
- Tambah libur manual
- Tambah cuti manual

### Mode Submit

- Auto isi saja
- Auto isi + konfirmasi
- Auto isi + simpan otomatis

Default MVP:

```text
Auto isi + simpan otomatis setelah user mengaktifkan.
Saat development/testing gunakan Auto isi saja atau konfirmasi.
```

### Data Lokal

- Lokasi database
- Backup database
- Restore database
- Hapus data lokal
