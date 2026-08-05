create index if not exists idx_absensi_id_import
  on public."Absensi" ("ID_Import");

create index if not exists idx_absensi_id_import_row
  on public."Absensi" ("ID_Import_Row");

create index if not exists idx_app_notifications_created_by
  on public."App_Notifications" ("Created_By");

create index if not exists idx_attendance_import_jobs_uploaded_by
  on public."Attendance_Import_Jobs" ("Uploaded_By");

create index if not exists idx_attendance_import_role_config_updated_by
  on public."Attendance_Import_Role_Config" ("Updated_By");

create index if not exists idx_attendance_import_rows_id_import
  on public."Attendance_Import_Rows" ("ID_Import");

create index if not exists idx_attendance_name_mappings_created_by
  on public."Attendance_Name_Mappings" ("Created_By");

create index if not exists idx_face_attendance_policy_updated_by
  on public."Face_Attendance_Policy" ("Updated_By");

create index if not exists idx_system_settings_updated_by
  on public."System_Settings" ("Updated_By");

-- Supabase advisor confirmed this index is identical to idx_audit_log_waktu_desc.
drop index if exists public.idx_auditlog_waktu;
