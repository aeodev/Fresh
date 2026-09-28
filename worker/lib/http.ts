import type { Context } from "hono";

export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 502 | 503,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code?: string) => new HttpError(400, message, code);
export const unauthorized = (message = "Sign in to continue.") => new HttpError(401, message);
export const forbidden = (message = "You do not have permission to do that.") => new HttpError(403, message);
export const notFound = (message = "Not found.") => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);

export async function readJson<T extends Record<string, unknown>>(c: Context): Promise<T> {
  try {
    const body = (await c.req.json()) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw badRequest("Expected a JSON object.");
    return body as T;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw badRequest("Request body is not valid JSON.");
  }
}

/** Trimmed string with a hard length cap; anything else becomes "". */
export function str(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function num(value: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}
