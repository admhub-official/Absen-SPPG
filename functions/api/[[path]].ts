import worker from "../../bff/cloudflare/worker.ts";

const RUNTIME_DEFAULTS = Object.freeze({
  HADIRLY_ORIGIN: "https://hadirly.org",
  SUPABASE_URL: "https://szwwpnbbsmjsbzzcecyj.supabase.co",
  SESSION_MAX_AGE_SECONDS: "28800",
  ALLOW_LEGACY_EXCHANGE: "false",
});

export const onRequest = async (context: any) => {
  const env = { ...RUNTIME_DEFAULTS, ...(context?.env || {}) };
  return worker.fetch(context.request, env);
};
