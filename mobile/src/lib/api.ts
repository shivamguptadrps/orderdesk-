import { useAuth } from './auth';
import { API_URL } from './config';

export { API_URL };

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number | null,
    public detail?: unknown,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

type Options = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Query;
  auth?: boolean;
  timeoutMs?: number;
};

export function buildUrl(path: string, query?: Query): string {
  const params = Object.entries(query ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return `${API_URL}${path}${params.length ? `?${params.join('&')}` : ''}`;
}

/** Turn FastAPI error bodies into one readable sentence. */
function messageFrom(body: any, status: number): string {
  const detail = body?.detail;
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail.message === 'string') return detail.message;
  if (Array.isArray(detail) && detail.length) {
    return detail
      .map((d: any) => String(d.msg ?? '').replace(/^Value error, /, ''))
      .filter(Boolean)
      .join('\n');
  }
  if (status === 401) return 'Please log in again.';
  return `Something went wrong (${status}). Please try again.`;
}

async function rawFetch(path: string, opts: Options, token: string | null): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);
  try {
    return await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(`Can't reach the server at ${API_URL}. Check your Wi-Fi and that the backend is running.`, null);
  } finally {
    clearTimeout(timer);
  }
}

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const auth = opts.auth ?? true;
  let res = await rawFetch(path, opts, auth ? useAuth.getState().accessToken : null);
  if (res.status === 401 && auth && (await useAuth.getState().refresh())) {
    res = await rawFetch(path, opts, useAuth.getState().accessToken);
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && auth) await useAuth.getState().signOut();
    throw new ApiError(messageFrom(body, res.status), res.status, body?.detail);
  }
  return body as T;
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Upload one photo (multipart). Used for product photos and the distributor logo. */
export async function uploadImage<T>(path: string, file: { uri: string; name?: string | null; mimeType?: string | null }): Promise<T> {
  const send = async () => {
    const form = new FormData();
    // React Native's FormData takes { uri, name, type } for files.
    form.append('file', {
      uri: file.uri,
      name: file.name || 'photo.jpg',
      type: file.mimeType || 'image/jpeg',
    } as unknown as Blob);
    const token = useAuth.getState().accessToken;
    try {
      return await fetch(buildUrl(path), {
        method: 'POST',
        headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: form,
      });
    } catch {
      throw new ApiError(`Can't reach the server at ${API_URL}.`, null);
    }
  };
  let res = await send();
  if (res.status === 401 && (await useAuth.getState().refresh())) res = await send();
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(messageFrom(body, res.status), res.status, body?.detail);
  return body as T;
}
