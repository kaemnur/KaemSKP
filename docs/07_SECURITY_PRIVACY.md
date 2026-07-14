# Security & Privacy — KaemSKP

## 1. Prinsip Keamanan

KaemSKP menangani data kerja dan session login SKP. Karena itu aplikasi harus lokal-first dan tidak mengirim data ke server Kaemnur.

Prinsip:

- Data tetap di laptop pengguna.
- Password tidak boleh ditulis di source code.
- Password tidak boleh disimpan dalam plain text.
- Session bisa dihapus kapan saja.
- Automation tidak boleh bypass captcha/OTP/proteksi.
- Pengguna tetap bertanggung jawab memeriksa data.

## 2. Penyimpanan Lokal

Lokasi:

```text
%APPDATA%\KaemSKP
```

Isi:

```text
kaemskp.db
sessions/
imports/
logs/
screenshots/
config/
```

## 3. Password

### Development

Boleh menggunakan `.env.local`, tetapi file ini tidak boleh masuk Git.

Contoh:

```env
SKP_USERNAME=isi_username_lokal
SKP_PASSWORD=isi_password_lokal
```

`.env.local` wajib masuk `.gitignore`.

### Production

Rekomendasi:

- User memasukkan password di Pengaturan.
- Password disimpan menggunakan secure storage.
- Alternatif lebih aman: tidak menyimpan password, hanya menyimpan session.

## 4. Session

Gunakan Playwright persistent context.

Session disimpan di:

```text
%APPDATA%\KaemSKP\sessions\skp
```

Fitur wajib:

- Cek session.
- Refresh session.
- Hapus session.
- Login ulang.

## 5. Screenshot Error

Screenshot error berguna untuk debugging, tetapi bisa berisi data sensitif.

Pengaturan:

```text
[ ] Simpan screenshot saat gagal
```

Default rekomendasi:

```text
Aktif saat development
Nonaktif secara default untuk produksi
```

## 6. Database

SQLite lokal dapat berisi:

- aktivitas kerja,
- rencana log,
- status submit,
- link dokumen,
- catatan internal.

Fitur keamanan:

- Backup manual.
- Hapus data lokal.
- Export status tanpa kredensial.

## 7. Audit Log

Setiap automation harus mencatat:

- waktu,
- aksi,
- hasil,
- error jika ada.

Jangan mencatat password.

## 8. Batasan Etis

KaemSKP hanya alat bantu pengisian data milik pengguna sendiri.

Aplikasi tidak boleh:

- Membobol login.
- Melewati captcha/OTP.
- Mengakses akun orang lain.
- Mengirim data ke server pihak ketiga.
- Mengubah data lama tanpa konfirmasi.
- Submit tanggal masa depan.
