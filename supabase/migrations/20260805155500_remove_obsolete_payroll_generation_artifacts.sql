drop table if exists public."Payroll_TTD_Massal_Item" cascade;
drop table if exists public."Payroll_TTD_Massal_Job" cascade;

drop function if exists public.bulk_publish_payroll_tick();
drop function if exists public.invoke_bulk_publish_payroll(integer);
drop function if exists public.import_payroll_2026_batch(jsonb, text, text, text, text);
drop function if exists public.import_payroll_2026_compact(jsonb, text, text, text, text);
drop function if exists public.import_weekly_payroll_draft(date, date, text, text[], integer[], numeric[], numeric[], numeric[], numeric[], numeric[], text, text, text, text);
