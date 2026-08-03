# Sprint 6 Production Readiness Runbook

## Tujuan

Memastikan migration, Edge Function, device policy, impossible-travel evidence, dan observability dapat diterapkan tanpa mengunci pengguna aktif secara massal.

## Urutan deployment

1. Pastikan quality gate GitHub lulus.
2. Backup database atau pastikan point-in-time recovery tersedia.
3. Jalankan `deploy-supabase.ps1` dari PowerShell.
4. Verifikasi Edge Function berikut aktif:
   - Absen
   - AbsenV2
   - DeviceTrust
   - SecurityOps
   - ProductionReadiness
5. Panggil action `report` pada ProductionReadiness menggunakan sesi Admin/Super Admin.
6. Pastikan semua nilai `tables` dan `functions` pada report bernilai `true`.
7. Catat hasil sebagai `Deployment_Audit` untuk environment PRODUCTION.

## Rollout device trust

Default `Require_Trusted_Device` adalah `false`. Jangan mengubahnya menjadi `true` sebelum:

- perangkat aktif telah terdaftar;
- Admin memiliki antrean review perangkat;
- perangkat PENDING telah ditinjau;
- jalur dukungan pengguna tersedia;
- smoke test perangkat TRUSTED, PENDING, REVOKED, dan BLOCKED selesai.

Tahapan:

1. `Block_Revoked_Device=true`, `Require_Trusted_Device=false`.
2. Pantau event `DEVICE_PENDING_TRUST` minimal 3–7 hari.
3. Aktifkan `Require_Trusted_Device=true` hanya untuk satu SPPG pilot.
4. Evaluasi insiden dan false positive.
5. Perluas bertahap.

## Smoke test wajib

1. Login dengan user aktif.
2. Perangkat baru terdaftar PENDING.
3. Action `evaluateAttendance` mengembalikan allowed=true untuk PENDING saat policy belum wajib trusted.
4. Device BLOCKED dan REVOKED mengembalikan allowed=false.
5. Accuracy di atas policy mengembalikan allowed=false.
6. Device milik user lain mengembalikan `DEVICE_OWNER_MISMATCH`.
7. Impossible travel menghasilkan reason `IMPOSSIBLE_TRAVEL` dan risk HIGH.
8. Production readiness report berhasil.
9. Deployment audit dapat dicatat.
10. Presensi DATANG dan PULANG normal tetap berhasil melalui AbsenV2.

## Rollback

- Set `Require_Trusted_Device=false` untuk semua SPPG.
- Pertahankan `Block_Revoked_Device=true` kecuali ditemukan false positive kritis.
- Rollback Edge Function ke commit sebelumnya bila endpoint readiness menyebabkan regresi.
- Migration Sprint 6 menambah tabel/fungsi dan tidak mengubah data historis; tidak perlu drop tabel saat rollback aplikasi.

## Catatan keamanan

- Jangan menyimpan token sesi di Deployment_Audit.
- Detail audit hanya boleh berisi metadata deployment dan hasil pemeriksaan.
- Impossible travel adalah evidence untuk review, bukan bukti tunggal kecurangan.
