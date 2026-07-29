insert into public."System_Settings" ("Setting_Key", "Setting_Value", "Description")
values
  ('menu.user.complaints', '{"enabled":true}'::jsonb, 'Tampilkan pusat pengaduan untuk pengguna.'),
  ('menu.admin.payroll', '{"enabled":true}'::jsonb, 'Izinkan ADMIN mengakses penerbitan payroll.'),
  ('menu.admin.audit', '{"enabled":true}'::jsonb, 'Tampilkan audit operasional bagi ADMIN.'),
  ('attendance.geofence_required', '{"enabled":true}'::jsonb, 'Tolak absensi di luar radius SPPG.'),
  ('attendance.capture_gps_accuracy', '{"enabled":true}'::jsonb, 'Rekam metadata akurasi lokasi setiap punch.'),
  ('attendance.allow_import_single_punch', '{"enabled":true}'::jsonb, 'Izinkan punch tunggal hasil impor dihitung valid.'),
  ('attendance.correction_requires_audit', '{"enabled":true}'::jsonb, 'Setiap koreksi wajib menyertakan alasan dan audit.'),
  ('payroll.recipient_signature_required', '{"enabled":true}'::jsonb, 'Slip final memerlukan tanda tangan penerima.'),
  ('payroll.accountant_signature_required', '{"enabled":true}'::jsonb, 'Penerbitan slip memerlukan tanda tangan akuntan.'),
  ('payroll.head_signature_required', '{"enabled":true}'::jsonb, 'Penerbitan slip memerlukan tanda tangan kepala SPPG.'),
  ('payroll.private_pdf', '{"enabled":true}'::jsonb, 'Batasi unduhan slip hanya untuk pihak berwenang.'),
  ('notification.new_slip', '{"enabled":true}'::jsonb, 'Beri tahu pengguna saat slip diterbitkan.'),
  ('notification.complaint_reply', '{"enabled":true}'::jsonb, 'Beri tahu pengguna saat tiket ditanggapi.'),
  ('notification.incomplete_attendance', '{"enabled":true}'::jsonb, 'Beri peringatan punch hari ini belum lengkap.'),
  ('notification.global_announcement', '{"enabled":false}'::jsonb, 'Izinkan SUPER ADMIN menerbitkan pengumuman lintas SPPG.'),
  ('security.idle_session_expiry', '{"enabled":true}'::jsonb, 'Akhiri sesi yang tidak aktif sesuai kebijakan.'),
  ('security.revoke_on_password_reset', '{"enabled":true}'::jsonb, 'Keluar dari seluruh perangkat setelah perubahan sandi.'),
  ('security.risky_action_reason', '{"enabled":true}'::jsonb, 'Wajibkan alasan pada perubahan berisiko.'),
  ('security.two_step_confirmation', '{"enabled":true}'::jsonb, 'Tampilkan dampak lalu minta frasa konfirmasi.')
on conflict ("Setting_Key") do nothing;
