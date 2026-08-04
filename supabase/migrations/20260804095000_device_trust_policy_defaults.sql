-- Device Trust memakai Release_Feature_Flags yang sudah menjadi sumber konfigurasi release.
-- Default aman: enforcement nonaktif sampai Super Admin mengaktifkannya dari Pengaturan.
insert into public."Release_Feature_Flags" (
  "Flag_Key",
  "Enabled",
  "Scope_SPPG",
  "Config",
  "Updated_At"
)
values (
  'ATTENDANCE_DEVICE_ENFORCEMENT',
  false,
  null,
  jsonb_build_object(
    'requireTrusted', false,
    'showMyDevicesWhenDisabled', false,
    'enabledSppg', '[]'::jsonb,
    'disabledSppg', '[]'::jsonb,
    'rolloutNote', 'Aktifkan bertahap setelah registry perangkat siap.'
  ),
  now()
)
on conflict ("Flag_Key") do nothing;
