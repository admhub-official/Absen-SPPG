-- Protect operational tables from direct PostgREST access.
-- Edge Functions use the service role and continue to operate normally.
alter table if exists public."Payroll_TTD_Massal_Job" enable row level security;
alter table if exists public."Payroll_TTD_Massal_Item" enable row level security;
alter table if exists public."Attendance_Import_Jobs" enable row level security;
alter table if exists public."Attendance_Name_Mappings" enable row level security;
alter table if exists public."Attendance_Import_Rows" enable row level security;
alter table if exists public."Attendance_Import_Role_Config" enable row level security;
alter table if exists public."Face_Attendance_Policy" enable row level security;
alter table if exists public."App_Notifications" enable row level security;
alter table if exists public."App_Notification_Read" enable row level security;
alter table if exists public."Push_Subscriptions" enable row level security;

-- These SECURITY DEFINER routines are backend-only. Prevent direct REST/RPC calls.
revoke execute on function public.bulk_publish_payroll_tick() from public, anon, authenticated;
revoke execute on function public.invoke_bulk_publish_payroll(integer) from public, anon, authenticated;
revoke execute on function public.import_payroll_2026_batch(jsonb, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.import_payroll_2026_compact(jsonb, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.import_weekly_payroll_draft(
  date,
  date,
  text,
  text[],
  integer[],
  numeric[],
  numeric[],
  numeric[],
  numeric[],
  numeric[],
  text,
  text,
  text,
  text
) from public, anon, authenticated;
revoke execute on function public.enforce_face_attendance_policy() from public, anon, authenticated;
