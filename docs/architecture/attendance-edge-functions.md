# Arsitektur Edge Function Presensi

Dokumen ini menetapkan tanggung jawab dan batas akses Edge Function presensi agar lokasi, kompatibilitas legacy, dan proteksi request tidak kembali tumpang tindih.

## AbsenCore

- Menyediakan implementasi bisnis legacy yang dipin ke commit stabil.
- Bukan endpoint frontend.
- Digunakan oleh jalur kompatibilitas untuk operasi yang belum dimigrasikan.
- Harus dideploy sebelum gateway lain.
- Tidak boleh ditambahkan ke konfigurasi endpoint frontend.
- Koordinat dan radius hardcoded di dalam implementasi lama **bukan** sumber lokasi produksi untuk `recordAbsensiSelf`.

## AttendanceLocation

- Satu-satunya pemilik kebijakan lokasi untuk absensi mandiri.
- Membaca `attendance.geofence_required` dari `System_Settings`.
- Membaca latitude, longitude, radius, status aktif, dan titik cadangan dari `Lokasi_SPPG` pada setiap request.
- Memprioritaskan titik aktif milik SPPG pengguna, kemudian titik `DEFAULT` aktif.
- Menolak absensi bila geofence wajib tetapi tidak ada titik aktif yang valid.
- Melakukan pemeriksaan wajah server-side, validasi lokasi, lock atomik, penyimpanan absensi, metadata GPS, dan audit.
- Tidak memiliki daftar koordinat atau radius SPPG dalam source code.

## SppgLocationConfig

- Endpoint pengelolaan lokasi khusus SUPER ADMIN.
- Menjadi jalur baca/tulis untuk menu **Lokasi & Geofence SPPG**.
- Menyimpan konfigurasi ke `Lokasi_SPPG`.
- Tidak memutuskan hasil absensi; keputusan dilakukan ulang oleh `AttendanceLocation` berdasarkan data tersimpan.

## Absen

- Gateway publik kompatibel untuk fungsi aplikasi.
- Merutekan `getAttendanceLocationPolicy`, `checkAttendanceLocation`, dan `recordAbsensiSelf` ke `AttendanceLocation`.
- Meneruskan operasi nonlokasi yang belum dimigrasikan ke jalur legacy.
- Tidak menyimpan koordinat, radius, atau fungsi kompatibilitas titik lokasi.
- Tetap dipertahankan selama frontend legacy masih menggunakan `window.apiCall`.

## AbsenV2

- Gateway presensi berintegritas tinggi dan endpoint utama frontend lama.
- Menangani challenge, rate limit, idempotensi, audit keamanan, dan normalisasi error yang tersedia pada lapisan tersebut.
- Meneruskan request ke `Absen`.
- Tidak menyimpan konfigurasi lokasi.

## Alur resmi

```text
Menu SUPER ADMIN ─> SppgLocationConfig ─> Lokasi_SPPG
                                              │
Frontend absensi ─> AttendanceLocation <──────┘

Frontend legacy ───────────────> Absen ─────────> jalur legacy / AbsenCore
Frontend presensi terproteksi ─> AbsenV2 ───────> Absen ─────> AttendanceLocation
```

Frontend tidak boleh memanggil `AbsenCore` secara langsung. Frontend juga tidak boleh menentukan sendiri apakah koordinat berada di dalam radius; hasil akhir harus berasal dari `AttendanceLocation`.

## Urutan deployment

1. Migration database.
2. `AbsenCore`.
3. `AttendanceLocation`.
4. `Absen`.
5. `AbsenV2`.
6. Edge Function domain lain.

Urutan tersebut memastikan RPC lock dan constraint lokasi tersedia sebelum `AttendanceLocation`, lalu gateway publik baru diarahkan setelah layanan lokasi aktif.

## Rencana penghentian AbsenCore

`AbsenCore` hanya dapat dihapus setelah:

- seluruh operasi legacy diinventarisasi;
- operasi yang masih digunakan dipindahkan ke function domain atau gateway baru;
- frontend tidak lagi bergantung pada `window.apiCall` untuk operasi tersebut;
- contract test dan smoke test produksi membuktikan tidak ada request menuju `AbsenCore` maupun forwarding dari `Absen`;
- masa observasi deployment selesai tanpa error upstream.

Sebelum syarat tersebut terpenuhi, `AbsenCore` tetap menjadi dependency untuk operasi nonlokasi dan bukan script mati. Konfigurasi lokasi hardcoded di dalamnya tidak lagi digunakan untuk absensi mandiri.
