# Absen-SPPG

Aplikasi absensi multi-user yang terhubung ke Supabase Edge Function.

## Konfigurasi Supabase

- Endpoint Edge Function: https://szwwpnbbsmjsbzzcecyj.supabase.co/functions/v1/Absen
- Konfigurasi terpusat: [supabase-config.js](supabase-config.js)

## Catatan

- Semua pemanggilan API frontend diarahkan melalui [index.html](index.html) menggunakan konfigurasi dari [supabase-config.js](supabase-config.js).
- Jika fungsi Supabase membutuhkan `Authorization` header, tambahkan `apiKey` pada `supabase-config.js`.
- Jika ingin berpindah project Supabase, cukup ubah nilai di [supabase-config.js](supabase-config.js).
