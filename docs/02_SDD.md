# SDD — KaemSKP MVP Log Harian

## 1. Arsitektur Umum

KaemSKP adalah aplikasi desktop lokal berbasis Electron.

```text
KaemSKP
├── Main Process
│   ├── App lifecycle
│   ├── Tray
│   ├── Scheduler
│   ├── Secure storage
│   ├── SQLite service
│   └── Playwright automation service
│
├── Renderer
│   ├── Dashboard
│   ├── Log Harian
│   ├── Import Excel
│   ├── Mapping SKP
│   ├── Antrean
│   ├── Riwayat
│   └── Pengaturan
│
└── Local Data
    ├── kaemskp.db
    ├── sessions/
    ├── imports/
    ├── logs/
    └── screenshots/
```

## 2. Stack Teknis

| Komponen | Teknologi |
|---|---|
| Desktop | Electron |
| UI | React + TypeScript |
| Styling | Tailwind CSS |
| Komponen | shadcn/ui |
| Icon | Lucide React |
| Browser automation | Playwright |
| Database lokal | SQLite |
| Excel import | ExcelJS atau SheetJS |
| Packaging | electron-builder |
| Scheduler | node-cron atau custom timer |
| Secure storage | safeStorage Electron / keytar / encrypted local file |

## 3. Mode Aplikasi

### 3.1 Foreground

Window utama tampil seperti aplikasi dashboard.

### 3.2 Background Tray

Saat user menutup window, default:

```text
Close = minimize to tray
```

User tetap bisa membuka lagi melalui tray icon.

### 3.3 Auto-start Opsional

Pengaturan:

```text
[ ] Jalankan KaemSKP saat Windows menyala
```

Untuk MVP, auto-start boleh dibuat opsional.

## 4. Modul Utama

### 4.1 Auth Session Module

Fungsi:

- Membuka browser login SKP.
- Menyimpan session Playwright secara lokal.
- Cek status login.
- Hapus session.
- Refresh session jika diperlukan.

### 4.2 Excel Import Module

Fungsi:

- Membaca file `.xlsx`.
- Validasi sheet dan kolom.
- Preview data.
- Mendeteksi:
  - data baru,
  - data berubah,
  - data duplikat,
  - data tidak valid.
- Menyimpan hasil ke database lokal.

### 4.3 Log Harian Module

Fungsi:

- Menampilkan data log per tanggal.
- Edit data log.
- Validasi field wajib.
- Menentukan status log.
- Menyiapkan antrean submit.

### 4.4 Calendar Status Module

Fungsi:

- Menampilkan kalender status per bulan.
- Menandai tanggal:
  - sudah terkirim,
  - belum dibuat,
  - libur/cuti,
  - tanggal merah,
  - pending,
  - gagal,
  - menunggu tanggal.
- Menyediakan alasan kenapa tanggal tidak dibuatkan log.

### 4.5 SKP Mapping Module

Fungsi:

- Menyimpan master SKP 2026.
- Mencocokkan `kode_skp` dengan dropdown di website SKP.
- Memberi status:
  - cocok,
  - perlu review,
  - tidak ditemukan.

### 4.6 Automation Module

Fungsi:

- Membuka halaman Log Harian.
- Klik Tambah Log.
- Isi form.
- Pilih SKP.
- Klik Simpan.
- Ambil status sukses/gagal.
- Simpan screenshot jika gagal.

### 4.7 Scheduler Module

Fungsi:

- Menjalankan proses otomatis harian.
- Retry jika belum bisa submit.
- Stop setelah berhasil atau setelah batas waktu.
- Tidak memproses tanggal masa depan.

### 4.8 History Module

Fungsi:

- Mencatat semua percobaan.
- Mencatat waktu mulai, selesai, hasil, dan error.
- Menampilkan riwayat berdasarkan tanggal.

## 5. Data Directory

Gunakan direktori lokal:

```text
%APPDATA%\KaemSKP
```

Struktur:

```text
KaemSKP
├── kaemskp.db
├── sessions
├── imports
├── logs
├── screenshots
└── config
```

## 6. IPC Design

Renderer tidak langsung mengakses database atau Playwright.

Gunakan IPC:

```text
renderer -> main -> service -> database/automation
```

Contoh IPC channel:

```text
app:getStatus
auth:openLogin
auth:checkSession
auth:clearSession
import:previewExcel
import:commitExcel
logs:list
logs:update
logs:runToday
logs:runMissed
logs:runRange
settings:get
settings:update
history:list
```

## 7. Error Handling

Setiap error automation harus menyimpan:

- kode error,
- pesan error,
- tanggal log,
- field yang gagal,
- screenshot opsional,
- HTML selector terakhir jika tersedia,
- waktu kejadian.

## 8. Prinsip Reliability

- Jangan submit data masa depan.
- Jangan submit data duplikat jika status sudah `submitted`.
- Jika ragu, set status `perlu_review`.
- Jika dropdown SKP tidak ditemukan, jangan paksa submit.
- Jika session expired, hentikan proses dan minta login ulang.
