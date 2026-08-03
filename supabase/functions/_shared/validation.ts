export class ValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export function requiredString(
  value: unknown,
  field: string,
  options: { min?: number; max?: number; uppercase?: boolean } = {},
): string {
  let result = String(value ?? "").trim();
  if (!result) throw new ValidationError("FIELD_REQUIRED", `${field} wajib diisi.`, field);
  if (options.min && result.length < options.min) {
    throw new ValidationError("FIELD_TOO_SHORT", `${field} minimal ${options.min} karakter.`, field);
  }
  if (options.max && result.length > options.max) {
    throw new ValidationError("FIELD_TOO_LONG", `${field} maksimal ${options.max} karakter.`, field);
  }
  if (options.uppercase) result = result.toUpperCase();
  return result;
}

export function optionalString(value: unknown, max = 4000): string | null {
  const result = String(value ?? "").trim();
  if (!result) return null;
  if (result.length > max) throw new ValidationError("FIELD_TOO_LONG", `Nilai maksimal ${max} karakter.`);
  return result;
}

export function enumValue<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T {
  const normalized = String(value ?? "").trim().toUpperCase() as T;
  if (!allowed.includes(normalized)) {
    throw new ValidationError("INVALID_ENUM", `${field} tidak valid.`, field);
  }
  return normalized;
}

export function positiveInteger(value: unknown, field: string): number {
  const result = Number(value);
  if (!Number.isInteger(result) || result <= 0) {
    throw new ValidationError("INVALID_INTEGER", `${field} harus berupa bilangan bulat positif.`, field);
  }
  return result;
}

export function pageOptions(body: Record<string, unknown>) {
  const page = Math.max(1, Number(body.page) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(body.pageSize) || 25));
  return { page, pageSize, from: (page - 1) * pageSize };
}

export function isoDate(value: unknown, fallback: string): string {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}
