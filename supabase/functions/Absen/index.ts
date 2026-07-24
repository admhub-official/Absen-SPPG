// Entry point publik untuk seluruh API aplikasi Absen-SPPG.
// Gateway memvalidasi sesi dan geofence absensi sebelum meneruskan fungsi
// bisnis lainnya ke AbsenCore yang dipin agar alur lama tetap stabil.
import "./geofence-gateway.ts";
