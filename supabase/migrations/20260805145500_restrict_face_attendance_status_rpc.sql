-- This helper is consumed by trusted backend code only.
-- Prevent direct PostgREST/RPC access by public API roles.
revoke execute on function public.is_face_attendance_enabled(text) from public, anon, authenticated;
