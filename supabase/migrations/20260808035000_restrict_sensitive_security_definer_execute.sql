-- Restrict privileged SECURITY DEFINER functions to backend service-role usage.
REVOKE EXECUTE ON FUNCTION public.acquire_absen_lock_v1(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_employment_master_scope() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_master_sppg_scope() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_system_setting_v1(text, boolean, text, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.acquire_absen_lock_v1(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_employment_master_scope() TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_master_sppg_scope() TO service_role;
GRANT EXECUTE ON FUNCTION public.update_system_setting_v1(text, boolean, text, text, text) TO service_role;
