import { File, UploadType } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';

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
  headers?: Record<string, string>;
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
        ...opts.headers,
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

export type PhotoAsset = {
  uri: string;
  width?: number;
  height?: number;
  fileName?: string | null;
  mimeType?: string | null;
};

const MAX_SIDE = 1600; // the server keeps 1400px at most; bigger only wastes mobile data

/** Make phone photos small and plain JPEG before upload (also turns iPhone HEIC into JPEG). */
async function shrink(photo: PhotoAsset): Promise<string> {
  const ctx = ImageManipulator.manipulate(photo.uri);
  const { width = 0, height = 0 } = photo;
  if (Math.max(width, height) > MAX_SIDE) {
    ctx.resize(width >= height ? { width: MAX_SIDE } : { height: MAX_SIDE });
  }
  const image = await ctx.renderAsync();
  const result = await image.saveAsync({ compress: 0.82, format: SaveFormat.JPEG });
  return result.uri;
}

/**
 * Upload one photo (product photo, banner, logo) as multipart field "file".
 * Phones: shrink, then the native uploader (sturdier than fetch + FormData). Web previews: fetch.
 */
export async function uploadImage<T>(path: string, photo: PhotoAsset): Promise<T> {
  const url = buildUrl(path);
  const auth = (): Record<string, string> => {
    const token = useAuth.getState().accessToken;
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  let send: () => Promise<{ status: number; body: string }>;
  if (Platform.OS === 'web') {
    send = async () => {
      const blob = await (await fetch(photo.uri)).blob();
      const form = new FormData();
      form.append('file', blob, photo.fileName || 'photo.jpg');
      const res = await fetch(url, { method: 'POST', headers: { Accept: 'application/json', ...auth() }, body: form });
      return { status: res.status, body: await res.text() };
    };
  } else {
    let uri: string;
    try {
      uri = await shrink(photo);
    } catch {
      uri = photo.uri; // could not resize; send the original
    }
    send = () =>
      new File(uri).upload(url, {
        httpMethod: 'POST',
        uploadType: UploadType.MULTIPART,
        fieldName: 'file',
        mimeType: 'image/jpeg',
        headers: { Accept: 'application/json', ...auth() },
        sessionType: 'foreground',
      });
  }

  const attempt = async () => {
    try {
      return await send();
    } catch (err) {
      const why = err instanceof Error && err.message ? ` (${err.message})` : '';
      throw new ApiError(`Couldn't upload the photo${why}. Check your internet and try again.`, null);
    }
  };
  let res = await attempt();
  if (res.status === 401 && (await useAuth.getState().refresh())) res = await attempt();
  let body: any = null;
  try {
    body = res.body ? JSON.parse(res.body) : null;
  } catch {
    body = null;
  }
  if (res.status < 200 || res.status >= 300) {
    if (res.status === 413) throw new ApiError('This photo is too large. Pick a smaller one.', 413);
    throw new ApiError(messageFrom(body, res.status), res.status, body?.detail);
  }
  return body as T;
}
