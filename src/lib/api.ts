import { getTelegramInitData } from './telegram.ts';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  adminToken?: string;
  isFormData?: boolean;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const initData = getTelegramInitData();
  if (initData) {
    headers['X-Telegram-Init-Data'] = initData;
  }
  if (options.adminToken) {
    headers['Authorization'] = `Bearer ${options.adminToken}`;
  }

  let fetchBody: BodyInit | undefined;
  if (options.body !== undefined) {
    if (options.isFormData && options.body instanceof FormData) {
      fetchBody = options.body;
    } else {
      headers['Content-Type'] = 'application/json';
      fetchBody = JSON.stringify(options.body);
    }
  }

  const res = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: fetchBody,
  });

  const data = (await res.json().catch(() => ({}))) as { error?: string; status?: string } & T;
  if (!res.ok) {
    throw new ApiError(data.error || `Request failed (${res.status})`, res.status);
  }
  return data;
}
