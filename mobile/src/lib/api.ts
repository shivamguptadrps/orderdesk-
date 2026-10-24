// Backend address comes from .env.local (EXPO_PUBLIC_API_URL). On a phone this must be the
// laptop's Wi-Fi IP, e.g. http://192.168.29.110:8000 - "localhost" would mean the phone itself.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number | null,
  ) {
    super(message);
  }
}

export async function apiGet<T>(path: string, timeoutMs = 8000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_URL}${path}`, { signal: controller.signal });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new ApiError(body?.detail ?? `Request failed (${res.status})`, res.status);
    }
    return body as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(`Cannot reach the server at ${API_URL}`, null);
  } finally {
    clearTimeout(timer);
  }
}

export type Health = { status: string; db: string; env: string };
