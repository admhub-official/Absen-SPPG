export const OPERATIONAL_ROLES = ["ADMIN", "SUPER ADMIN", "AKUNTAN"] as const;
export type OperationalRole = typeof OPERATIONAL_ROLES[number];

export const INCIDENT_STATUSES = [
  "OPEN",
  "INVESTIGATING",
  "CONFIRMED",
  "RESOLVED",
  "FALSE_POSITIVE",
] as const;
export type IncidentStatus = typeof INCIDENT_STATUSES[number];

export const INCIDENT_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type IncidentSeverity = typeof INCIDENT_SEVERITIES[number];

export const HEALTH_STATUSES = ["OK", "WARN", "CRITICAL"] as const;
export type HealthStatus = typeof HEALTH_STATUSES[number];

export type ApiSuccess<T> = {
  success: true;
  result: T;
  requestId: string;
};

export type ApiFailure = {
  success: false;
  code: string;
  message: string;
  requestId: string;
  details?: Record<string, unknown>;
};

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export function normalizeRole(value: unknown): string {
  return String(value || "").trim().toUpperCase().replace(/_/g, " ");
}
