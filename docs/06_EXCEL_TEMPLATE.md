# Excel Template — KaemSKP Log Harian 2026

## 1. Tujuan

Template Excel digunakan untuk mengisi rencana Log Harian yang akan diimpor ke KaemSKP.

KaemSKP harus mendukung:

- Import bulanan.
- Import tahunan.
- Upload ulang untuk update.
- Preview perubahan.
- Validasi data.
- Mapping ke master SKP.

## 2. Sheet Wajib

File Excel minimal memiliki sheet:

```text
Log_Harian_2026
```

Disarankan memiliki sheet tambahan:

```text
Master_SKP_2026
Pengaturan
Hari_Libur_2026
```

## 3. Sheet `Log_Harian_2026`

Kolom wajib:

| Kolom | Wajib | Contoh |
|---|---|---|
| kode_log | Ya | LOG-2026-07-02-01 |
| tanggal | Ya | 2026-07-02 |
| kode_skp | Ya | SKP-2026-06 |
| nama_aktivitas | Ya | Verifikasi data usulan PIP |
| deskripsi | Ya | Melakukan verifikasi dan rekapitulasi data usulan calon penerima PIP. |
| kuantitas_output | Tidak | 1 |
| satuan | Tidak | Dokumen |
| link_tautan | Tidak | https://drive.google.com/... |
| catatan_internal | Tidak | Catatan untuk KaemSKP saja |
| status_rencana | Tidak | aktif/libur/cuti/skip |

## 4. Contoh Data

| kode_log | tanggal | kode_skp | nama_aktivitas | deskripsi | kuantitas_output | satuan | link_tautan | status_rencana |
|---|---|---|---|---|---:|---|---|---|
| LOG-2026-07-02-01 | 2026-07-02 | SKP-2026-06 | Verifikasi data usulan PIP | Melakukan verifikasi dan rekapitulasi data usulan calon penerima PIP. | 1 | Dokumen |  | aktif |
| LOG-2026-07-03-01 | 2026-07-03 | SKP-2026-07 | Pengolahan data siswa penerima PIP | Melakukan pengolahan data siswa penerima PIP untuk proses penyaluran dana. | 1 | Data |  | aktif |
| LOG-2026-07-04-01 | 2026-07-04 |  | Libur akhir pekan | Sabtu, tidak dibuatkan log harian. |  |  |  | libur |

## 5. Aturan `kode_log`

Format:

```text
LOG-YYYY-MM-DD-XX
```

Contoh:

```text
LOG-2026-07-02-01
LOG-2026-07-02-02
```

Alasan:

- Satu tanggal bisa memiliki lebih dari satu log.
- Saat upload ulang, KaemSKP dapat mengetahui data mana yang harus diperbarui.

## 6. Aturan Tanggal

Format tanggal wajib:

```text
YYYY-MM-DD
```

Contoh:

```text
2026-07-02
```

Jangan gunakan format ambigu seperti:

```text
02/07/2026
```

## 7. Sheet `Master_SKP_2026`

Kolom:

| kode_skp | nama_skp |
|---|---|

Isi awal:

| kode_skp | nama_skp |
|---|---|
| SKP-2026-01 | Tersalurkannya Dana Bantuan Sosial PIP kepada Siswa SMP/Paket B |
| SKP-2026-02 | Tersalurkannya Dana Bantuan Sosial PIP kepada Siswa SD/Paket A |
| SKP-2026-03 | Tersalurkannya Dana Bantuan Sosial PIP kepada Siswa SMA/Paket C |
| SKP-2026-04 | Tersalurkannya Dana Bantuan Sosial PIP kepada Siswa SMK/Paket C |
| SKP-2026-05 | Terlaksananya Kegiatan Penunjang Pelaksanaan PIP TA 2026 |
| SKP-2026-06 | Teradministrasikannya Data Usulan Calon Penerima PIP |
| SKP-2026-07 | Teradministrasikannya Data Siswa Penerima PIP |
| SKP-2026-08 | Terkelolanya Media Sosial Sobat PIP |

## 8. Sheet `Hari_Libur_2026`

Kolom:

| tanggal | jenis | alasan |
|---|---|---|
| 2026-07-04 | weekend | Sabtu |
| 2026-07-05 | weekend | Minggu |
| 2026-08-17 | tanggal_merah | Hari Kemerdekaan RI |
| 2026-09-01 | cuti | Cuti tahunan |

Jenis yang didukung:

```text
weekend
tanggal_merah
cuti
sakit
dinas_luar
tidak_ada_rencana
skip_manual
```

## 9. Sheet `Pengaturan`

Kolom:

| key | value |
|---|---|
| tahun | 2026 |
| periode_mulai | 2026-01-01 |
| periode_selesai | 2026-12-31 |
| mode_submit_default | auto_save |
| jam_auto_run | 08:00 |
| retry_interval_menit | 10 |
| hanya_hari_kerja | YA |

## 10. Mode Import

KaemSKP harus menampilkan pilihan:

### 10.1 Tambah Data Baru Saja

- Data lama tidak diubah.
- Data dengan `kode_log` yang sudah ada dilewati.

### 10.2 Perbarui Data yang Berubah

- Data dengan `kode_log` sama akan diperbarui jika ada perubahan.
- Cocok untuk upload ulang file revisi.

### 10.3 Ganti Data Periode Ini

- Data pada periode bulan/tahun file akan diganti.
- Wajib tampilkan preview dulu.
- Data yang sudah submitted tidak boleh dihapus tanpa konfirmasi.

### 10.4 Preview Saja

- Tidak menyimpan data.
- Hanya menampilkan validasi.

## 11. Validasi

Data dianggap valid jika:

- `kode_log` tidak kosong.
- `tanggal` valid.
- `tanggal` berada dalam periode aktif.
- `nama_aktivitas` tidak kosong.
- `deskripsi` minimal 10 karakter.
- `kode_skp` cocok dengan master SKP, kecuali status_rencana adalah libur/cuti/skip.
- Jika status_rencana libur/cuti/skip, alasan harus ada.

## 12. Status Rencana

Nilai `status_rencana`:

```text
aktif
libur
cuti
sakit
dinas_luar
tidak_ada_rencana
skip
```

Jika kosong, dianggap `aktif`.
