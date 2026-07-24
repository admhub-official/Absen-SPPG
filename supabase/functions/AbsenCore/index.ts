// Fungsi inti aplikasi sebelum pemasangan gateway geofence.
// Dipin ke commit agar perilaku bisnis lama tetap stabil dan gateway dapat
// difokuskan untuk autentikasi sesi, validasi radius, serta audit GPS.
import "https://raw.githubusercontent.com/admhub-official/Absen-SPPG/52f97758af5c174346a3ceee78bb5db852e19a72/supabase/functions/Absen/index.ts";
