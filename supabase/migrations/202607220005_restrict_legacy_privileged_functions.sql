revoke execute on function public.cleanup_expired_sessions() from public, anon, authenticated;
revoke execute on function public.complete_registration_yayasan(text, text, text, text) from public, anon, authenticated;
revoke execute on function public.payroll_api(text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.registration_options() from public, anon, authenticated;
revoke execute on function public.super_admin_users(text) from public, anon, authenticated;
revoke execute on function public.sync_email_verified() from public, anon, authenticated;

grant execute on function public.cleanup_expired_sessions() to service_role;
grant execute on function public.complete_registration_yayasan(text, text, text, text) to service_role;
grant execute on function public.payroll_api(text, text, jsonb) to service_role;
grant execute on function public.registration_options() to service_role;
grant execute on function public.super_admin_users(text) to service_role;
grant execute on function public.sync_email_verified() to service_role;
