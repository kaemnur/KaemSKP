# Automation Flow — KaemSKP MVP Log Harian

## 1. Prinsip Automation

KaemSKP menggunakan Playwright untuk mengontrol browser lokal.

Aturan:

- Jangan bypass captcha, OTP, atau proteksi situs.
- Jangan menyimpan password di source code.
- Gunakan session lokal.
- Jika session expired, minta user login ulang.
- Jangan submit tanggal masa depan.
- Jika selector tidak ditemukan, hentikan proses dan beri status `needs_review`.

## 2. URL Target

Base URL:

```text
https://skp.sdm.kemendikdasmen.go.id
```

Login page:

```text
/skp/site/login.jsp
```

Log Harian:

```text
/skp/pegawai/logharian/cal.jsp
```

## 3. Login Flow

```text
1. Launch persistent browser context.
2. Buka base URL.
3. Jika muncul pilihan login:
   - Klik Login Non Portal.
4. Isi username.
5. Isi password.
6. Klik Masuk.
7. Tunggu dashboard.
8. Verifikasi login berhasil dengan indikator:
   - nama user tampil,
   - sidebar tampil,
   - menu Log Harian tersedia,
   - URL bukan halaman login.
9. Simpan session di folder lokal.
```

## 4. Session Check

Sebelum menjalankan submit:

```text
1. Buka halaman Log Harian.
2. Jika diarahkan ke login, session expired.
3. Status aplikasi = Perlu Login Ulang.
4. Jangan lanjut automation.
```

## 5. Run Today

```text
1. Ambil tanggal hari ini.
2. Cari daily_logs untuk tanggal hari ini.
3. Jika tidak ada:
   - set status calendar: no_plan atau missing.
   - tampilkan di dashboard.
4. Jika status submitted:
   - skip.
5. Jika tanggal hari ini weekend/tanggal merah/cuti:
   - skip sesuai reason.
6. Jika data valid:
   - jalankan submitLog(log).
```

## 6. Run Missed

```text
1. Ambil semua daily_logs dengan tanggal <= hari ini.
2. Exclude:
   - submitted,
   - skipped,
   - holiday,
   - leave,
   - no_plan,
   - future.
3. Urutkan tanggal ascending.
4. Jalankan submitLog(log) satu per satu.
5. Jika satu gagal, catat error dan lanjut item berikutnya.
```

## 7. Run Range

```text
1. User memilih tanggal mulai dan tanggal akhir.
2. Sistem membatasi tanggal akhir maksimal hari ini.
3. Ambil daily_logs sesuai periode.
4. Tampilkan preview.
5. Setelah user konfirmasi, jalankan batch.
```

## 8. submitLog(log)

Pseudo-flow:

```text
function submitLog(log):
  ensureLoggedIn()
  open Log Harian page
  ensure correct year selected
  ensure correct month visible
  click Tambah Log
  wait modal Tambah Log Harian
  fill Tanggal
  fill Nama Aktivitas
  fill Deskripsi rich text editor
  select SKP dropdown
  fill Kuantitas Output
  fill Satuan
  fill Link/Tautan
  if submit_mode == "fill_only":
      stop and mark needs_user_action
  if submit_mode == "confirm":
      ask user confirmation in app
  if submit_mode == "auto_save":
      click Simpan
      wait success message or modal close
      mark submitted
```

## 9. Field Mapping

| Local Field | Website Field |
|---|---|
| tanggal | Tanggal |
| nama_aktivitas | Nama Aktivitas |
| deskripsi | Deskripsi |
| kode_skp/nama_skp | SKP |
| kuantitas_output | Kuantitas Output |
| satuan | Satuan |
| link_tautan | Link / Tautan |

## 10. Rich Text Deskripsi

Field Deskripsi menggunakan editor rich text.

Automation harus mendukung beberapa strategi:

1. Isi editor dengan `keyboard.type()`.
2. Jika tidak bisa, klik area editor lalu gunakan clipboard paste.
3. Jika editor berbasis iframe, cari iframe terlebih dahulu.
4. Jika gagal, status `failed` dengan error `DESCRIPTION_EDITOR_NOT_FOUND`.

## 11. Dropdown SKP

Strategi:

1. Baca mapping `kode_skp`.
2. Cari `site_option_value` jika sudah tersedia.
3. Jika belum ada, cari opsi berdasarkan teks `nama_skp`.
4. Gunakan fuzzy match ringan.
5. Jika tidak ditemukan, jangan submit.
6. Set status `needs_review`.

## 12. Success Detection

Setelah klik Simpan, deteksi berhasil melalui:

- Modal tertutup.
- Muncul toast/swal sukses.
- Kalender tanggal berubah menjadi terisi.
- Counter terisi bertambah.
- Tidak ada pesan error validasi.

Jika tidak pasti, gunakan status:

```text
unknown_needs_review
```

## 13. Duplicate Prevention

Sebelum submit:

- Jika `status_skp = submitted`, skip.
- Jika ada indikasi tanggal sudah terisi di halaman kalender, jangan submit otomatis kecuali mode replace/update aktif.
- Untuk MVP, hindari replace otomatis.

## 14. Error Codes

Gunakan kode error standar:

```text
SESSION_EXPIRED
LOGIN_FAILED
LOG_PAGE_NOT_FOUND
ADD_LOG_BUTTON_NOT_FOUND
DATE_FIELD_NOT_FOUND
ACTIVITY_FIELD_NOT_FOUND
DESCRIPTION_EDITOR_NOT_FOUND
SKP_DROPDOWN_NOT_FOUND
SKP_OPTION_NOT_FOUND
OUTPUT_FIELD_NOT_FOUND
SAVE_BUTTON_NOT_FOUND
VALIDATION_ERROR
SITE_NOT_ALLOWED
UNKNOWN_ERROR
```

## 15. Screenshot Error

Jika terjadi error:

```text
%APPDATA%\KaemSKP\screenshots\YYYY-MM-DD_HH-mm-ss_error.png
```

Screenshot bisa dimatikan di pengaturan.
