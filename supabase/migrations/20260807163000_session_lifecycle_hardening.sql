-- Server-side session lifecycle hardening.
-- Raw bearer material is never persisted; Sessions.Token and Token_Hash remain SHA-256 digests.

DO $session_cutover$
DECLARE
  v_cutover timestamptz := clock_timestamp();
BEGIN
  -- Existing live sessions predate reliable activity touching. Give them one clean
  -- idle window at cutover instead of incorrectly expiring active users.
  UPDATE public."Sessions"
  SET "Last_Activity_At" = v_cutover
  WHERE "Expires_At" > v_cutover;

  DELETE FROM public."Sessions"
  WHERE "Expires_At" <= v_cutover;

  INSERT INTO public."System_Settings"(
    "Setting_Key", "Setting_Value", "Description", "Updated_At", "Updated_By"
  )
  VALUES (
    'security.session_idle_runtime',
    jsonb_build_object(
      'idleSeconds', 3600,
      'touchIntervalSeconds', 300,
      'enforcementStartedAt', v_cutover
    ),
    'Runtime server-side untuk idle session Hadirly. Dikelola oleh migration, bukan UI.',
    v_cutover,
    NULL
  )
  ON CONFLICT ("Setting_Key") DO UPDATE
  SET "Setting_Value" = EXCLUDED."Setting_Value",
      "Description" = EXCLUDED."Description",
      "Updated_At" = EXCLUDED."Updated_At",
      "Updated_By" = NULL;
END
$session_cutover$;

CREATE OR REPLACE FUNCTION public.revoke_user_sessions_after_password_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  DELETE FROM public."Sessions"
  WHERE "ID_User" = NEW."ID_User";
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.revoke_user_sessions_after_password_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_user_sessions_after_password_change() FROM anon;
REVOKE ALL ON FUNCTION public.revoke_user_sessions_after_password_change() FROM authenticated;

DROP TRIGGER IF EXISTS trg_revoke_sessions_after_password_change ON public."Users";
CREATE TRIGGER trg_revoke_sessions_after_password_change
AFTER UPDATE OF "Password_Hash", "Password_Salt" ON public."Users"
FOR EACH ROW
WHEN (
  OLD."Password_Hash" IS DISTINCT FROM NEW."Password_Hash"
  OR OLD."Password_Salt" IS DISTINCT FROM NEW."Password_Salt"
)
EXECUTE FUNCTION public.revoke_user_sessions_after_password_change();

-- Preserve the pre-existing void return contract so this migration can run on
-- production databases that already have cleanup_expired_sessions().
CREATE OR REPLACE FUNCTION public.cleanup_expired_sessions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  DELETE FROM public."Sessions" WHERE "Expires_At" <= clock_timestamp();
  DELETE FROM public."Rate_Limits" WHERE "Expires_At" <= clock_timestamp();
  DELETE FROM public."Absen_Locks" WHERE "Expires_At" <= clock_timestamp();
END
$function$;

REVOKE ALL ON FUNCTION public.cleanup_expired_sessions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_expired_sessions() FROM anon;
REVOKE ALL ON FUNCTION public.cleanup_expired_sessions() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_sessions() TO service_role;

DO $cron_setup$
DECLARE
  v_job record;
BEGIN
  FOR v_job IN
    SELECT jobid FROM cron.job WHERE jobname = 'hadirly-expired-session-cleanup'
  LOOP
    PERFORM cron.unschedule(v_job.jobid);
  END LOOP;

  PERFORM cron.schedule(
    'hadirly-expired-session-cleanup',
    '17 * * * *',
    $cron$SELECT public.cleanup_expired_sessions();$cron$
  );
END
$cron_setup$;
