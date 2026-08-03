export type CorsOptions = {
  allowedOriginsEnv?: string;
  productionOrigin?: string;
  previewSuffix?: string;
  localOrigins?: string[];
  allowedHeaders?: string;
  allowedMethods?: string;
  exposedHeaders?: string;
};

export function createRequestId(prefix = "REQ"): string {
  return `${prefix}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

export function isOriginAllowed(origin: string, options: CorsOptions = {}): boolean {
  const configured = new Set(
    (options.allowedOriginsEnv || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (options.productionOrigin) configured.add(options.productionOrigin);
  for (const localOrigin of options.localOrigins || []) configured.add(localOrigin);
  if (configured.has(origin)) return true;
  try {
    const url = new URL(origin);
    return Boolean(
      options.previewSuffix &&
        url.protocol === "https:" &&
        url.hostname.endsWith(options.previewSuffix),
    );
  } catch {
    return false;
  }
}

export function corsHeaders(
  origin: string | null,
  options: CorsOptions = {},
): Record<string, string> {
  return {
    ...(origin && isOriginAllowed(origin, options)
      ? { "Access-Control-Allow-Origin": origin }
      : {}),
    "Access-Control-Allow-Headers": options.allowedHeaders ||
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": options.allowedMethods || "POST, OPTIONS",
    "Access-Control-Expose-Headers": options.exposedHeaders || "X-Request-Id",
    "Vary": "Origin",
  };
}

export function jsonResponse(
  body: unknown,
  status: number,
  requestId: string,
  headers: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Request-Id": requestId,
    },
  });
}
