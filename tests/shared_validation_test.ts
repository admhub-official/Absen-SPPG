import {
  enumValue,
  isoDate,
  pageOptions,
  positiveInteger,
  requiredString,
  ValidationError,
} from "../supabase/functions/_shared/validation.ts";
import {
  isOriginAllowed,
} from "../supabase/functions/_shared/http.ts";
import {
  INCIDENT_STATUSES,
  normalizeRole,
} from "../supabase/functions/_shared/contracts.ts";

Deno.test("requiredString trims and validates values", () => {
  const result = requiredString("  ADMIN  ", "role", { min: 3, uppercase: true });
  if (result !== "ADMIN") throw new Error(`Unexpected result: ${result}`);
});

Deno.test("requiredString rejects empty values", () => {
  try {
    requiredString("  ", "token");
    throw new Error("Expected ValidationError");
  } catch (error) {
    if (!(error instanceof ValidationError) || error.code !== "FIELD_REQUIRED") throw error;
  }
});

Deno.test("enumValue accepts known incident status", () => {
  const result = enumValue("investigating", "status", INCIDENT_STATUSES);
  if (result !== "INVESTIGATING") throw new Error(`Unexpected result: ${result}`);
});

Deno.test("enumValue rejects unknown incident status", () => {
  try {
    enumValue("deleted", "status", INCIDENT_STATUSES);
    throw new Error("Expected ValidationError");
  } catch (error) {
    if (!(error instanceof ValidationError) || error.code !== "INVALID_ENUM") throw error;
  }
});

Deno.test("pagination enforces safe limits", () => {
  const low = pageOptions({ page: -3, pageSize: 1 });
  const high = pageOptions({ page: 2, pageSize: 500 });
  if (low.page !== 1 || low.pageSize !== 10 || low.from !== 0) throw new Error("Low pagination bounds failed");
  if (high.page !== 2 || high.pageSize !== 100 || high.from !== 100) throw new Error("High pagination bounds failed");
});

Deno.test("positiveInteger rejects invalid identifiers", () => {
  for (const value of [0, -1, 1.5, "abc"]) {
    try {
      positiveInteger(value, "eventId");
      throw new Error(`Expected rejection for ${value}`);
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
    }
  }
});

Deno.test("isoDate falls back for invalid input", () => {
  const fallback = "2026-01-01T00:00:00.000Z";
  if (isoDate("invalid", fallback) !== fallback) throw new Error("Fallback was not used");
});

Deno.test("role normalization removes underscore differences", () => {
  if (normalizeRole("super_admin") !== "SUPER ADMIN") throw new Error("Role normalization failed");
});

Deno.test("CORS allowlist accepts production and preview only", () => {
  const options = {
    allowedOriginsEnv: "https://custom.example.id",
    productionOrigin: "https://absen-sppg.pages.dev",
    previewSuffix: ".absen-sppg.pages.dev",
    localOrigins: ["http://localhost:4173"],
  };
  const accepted = [
    "https://custom.example.id",
    "https://absen-sppg.pages.dev",
    "https://branch.absen-sppg.pages.dev",
    "http://localhost:4173",
  ];
  for (const origin of accepted) {
    if (!isOriginAllowed(origin, options)) throw new Error(`Expected origin allowed: ${origin}`);
  }
  if (isOriginAllowed("https://evil.example.com", options)) throw new Error("Unexpected origin allowed");
});
