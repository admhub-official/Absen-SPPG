# Absen-SPPG

Aplikasi absensi dan payroll multi-role untuk operasional SPPG. Frontend menggunakan HTML/CSS/JavaScript tanpa build step, sedangkan seluruh akses data melewati Supabase Edge Function dengan sesi aplikasi khusus.

## Arsitektur

- `index.html`: shell aplikasi, view per role, dan controller UI.
- `supabase-config.js`: konfigurasi endpoint publik tanpa logika fitur.
- `supabase/functions/Absen/index.ts`: API, autentikasi, otorisasi, validasi, dan audit log.
- `supabase/migrations`: skema serta optimasi database yang dapat direproduksi.

Frontend tidak mengakses tabel langsung. Edge Function memakai service role di server, memvalidasi token pada tabel `Sessions`, lalu menerapkan cakupan akses berdasarkan role dan mapping SPPG.

Logo dan ikon aplikasi disajikan langsung dari bucket publik Supabase Storage `icon aplikasi`. Aplikasi aktif tidak bergantung pada Google Drive, Google Apps Script, atau Google Spreadsheet.

## Hak Akses

- `USER`: dashboard pribadi, absensi, payroll, profil, scan wajah, dan pengaduan.
- `ADMIN`: dashboard operasional, data absensi/users/payroll sesuai cakupan SPPG, inbox pengaduan, dan audit log. Identitas pengaduan anonim tidak dikirim oleh API.
- `SUPER ADMIN`: akses global, termasuk identitas internal pengaduan anonim untuk audit.
- `AKUNTAN`: endpoint operasional payroll sesuai cakupan yang diberikan.

## Pengaduan

Pengaduan menyimpan relasi pengirim secara internal agar pengguna dapat melihat tanggapan dan SUPER ADMIN dapat melakukan audit. Untuk laporan anonim, API menghapus ID, nama, email, dan ID Card sebelum mengirim data kepada ADMIN. Tindakan membaca dan menanggapi dicatat pada audit log.

## Menjalankan Frontend

Sajikan direktori ini melalui web server statis. Contoh:

```bash
python3 -m http.server 4173
```

Endpoint aktif: `https://szwwpnbbsmjsbzzcecyj.supabase.co/functions/v1/Absen`.
