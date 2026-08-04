# Arsitektur Edge Function Presensi

Dokumen ini menetapkan tanggung jawab dan batas akses tiga Edge Function presensi agar tidak kembali tumpang tindih.

## AbsenCore

- Menyediakan implementasi bisnis legacy yang dipin ke commit stabil.
- Bukan endpoint frontend.
- Hanya dipanggil oleh `Absen` melalui jaringan internal Supabase.
- Harus dideploy sebelum `Absen`.
- Tidak boleh ditambahkan ke konfigurasi endpoint frontend.

## Absen

- Gateway publik kompatibel untuk fungsi aplikasi legacy.
- Menangani autentikasi, cakupan admin, geofence, dashboard operasional, dan workflow yang belum dimigrasikan.
- Meneruskan operasi bisnis lama ke `AbsenCore`.
- Tetap dipertahankan selama frontend legacy masih menggunakan `window.apiCall`.

## AbsenV2

- Gateway presensi berintegritas tinggi.
- Menangani challenge lokasi, kualitas GPS, rate limit, idempotensi, audit keamanan, dan normalisasi error.
- Meneruskan operasi yang telah divalidasi ke `Absen`.
- Digunakan untuk aksi presensi sensitif; bukan pengganti semua operasi aplikasi.

## Alur resmi

```text
Frontend legacy ───────────────> Absen ─────────> AbsenCore
Frontend presensi terproteksi ─> AbsenV2 ───────> Absen ─────> AbsenCore
```

Frontend tidak boleh memanggil `AbsenCore` secara langsung.

## Urutan deployment

1. Migration database.
2. `AbsenCore`.
3. `Absen`.
4. `AbsenV2`.
5. Edge Function domain lain.

## Rencana penghentian AbsenCore

`AbsenCore` hanya dapat dihapus setelah:

- seluruh operasi legacy diinventarisasi;
- operasi yang masih digunakan dipindahkan ke function domain atau gateway baru;
- frontend tidak lagi bergantung pada `window.apiCall` untuk operasi tersebut;
- contract test dan smoke test produksi membuktikan tidak ada request menuju `AbsenCore` maupun forwarding dari `Absen`;
- masa observasi deployment selesai tanpa error upstream.

Sebelum syarat tersebut terpenuhi, `AbsenCore` adalah dependency produksi dan bukan script mati.
