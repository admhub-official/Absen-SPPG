// Entry point publik untuk seluruh API aplikasi Absen-SPPG.
// Operasi lokasi diarahkan ke AttendanceLocation, sedangkan operasi legacy
// diteruskan ke AbsenCore yang dipin melalui proxy kanonis.
import './proxy.ts';
