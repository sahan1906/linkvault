const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return bytesToHex(new Uint8Array(digest));
}

export async function hmacSha256Raw(key: Uint8Array | string, data: string): Promise<Uint8Array> {
  const rawKey = typeof key === 'string' ? encoder.encode(key) : key;
  const keyBuffer = rawKey.buffer.slice(rawKey.byteOffset, rawKey.byteOffset + rawKey.byteLength) as ArrayBuffer;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
  return new Uint8Array(sig);
}

export async function hmacSha256Hex(key: Uint8Array | string, data: string): Promise<string> {
  return bytesToHex(await hmacSha256Raw(key, data));
}

export async function signToken(payload: Record<string, unknown>, secret: string): Promise<string> {
  const body = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const sigBytes = await hmacSha256Raw(secret, body);
  const sig = bytesToBase64Url(sigBytes);
  return `${body}.${sig}`;
}

export async function verifyToken<T = Record<string, unknown>>(
  token: string,
  secret: string
): Promise<T | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;

  try {
    const expectedSig = await hmacSha256Raw(secret, body);
    const providedSig = base64UrlToBytes(sig);
    if (!timingSafeEqualBytes(expectedSig, providedSig)) return null;

    const payload = JSON.parse(decoder.decode(base64UrlToBytes(body))) as T & { exp?: number };
    if (typeof payload.exp === 'number' && Date.now() > payload.exp) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return `pbkdf2_sha256$100000$${bytesToHex(salt)}$${bytesToHex(new Uint8Array(derived))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations < 10000) return false;
  const saltHex = parts[2];
  const hashHex = parts[3];
  const salt = new Uint8Array(saltHex.length / 2);
  for (let i = 0; i < salt.length; i++) {
    salt[i] = parseInt(saltHex.slice(i * 2, i * 2 + 2), 16);
  }
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const expected = new Uint8Array(hashHex.length / 2);
  for (let i = 0; i < expected.length; i++) {
    expected[i] = parseInt(hashHex.slice(i * 2, i * 2 + 2), 16);
  }
  return timingSafeEqualBytes(new Uint8Array(derived), expected);
}

export async function verifyPlaintextConstantTime(input: string, expected: string): Promise<boolean> {
  const key = 'linkvault-const-compare';
  const a = await hmacSha256Raw(key, input);
  const b = await hmacSha256Raw(key, expected);
  return timingSafeEqualBytes(a, b);
}

export interface VerifiedTelegramUser {
  id: string;
  username: string;
  first_name: string;
}

export async function verifyTelegramInitData(
  initData: string,
  botToken: string
): Promise<VerifiedTelegramUser | null> {
  if (!initData || !botToken) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;

    const entries: [string, string][] = [];
    params.forEach((value, key) => {
      if (key !== 'hash') entries.push([key, value]);
    });
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');

    const secretKey = await hmacSha256Raw('WebAppData', botToken);
    const calculatedHex = await hmacSha256Hex(secretKey, dataCheckString);

    const a = encoder.encode(calculatedHex.toLowerCase());
    const b = encoder.encode(hash.toLowerCase());
    if (!timingSafeEqualBytes(a, b)) return null;

    const authDate = Number(params.get('auth_date') || '0');
    if (authDate > 0 && Math.abs(Date.now() / 1000 - authDate) > 86400 * 7) {
      return null;
    }

    const userStr = params.get('user');
    if (!userStr) return null;
    const userObj = JSON.parse(userStr) as { id?: number | string; username?: string; first_name?: string };
    if (!userObj.id) return null;

    return {
      id: String(userObj.id),
      username: (userObj.username || userObj.first_name || `user_${userObj.id}`).slice(0, 64),
      first_name: (userObj.first_name || '').slice(0, 64),
    };
  } catch {
    return null;
  }
}

export function randomSlug(length = 6): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export function randomApiKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `lv_${bytesToHex(bytes)}`;
}

export function randomFileId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `img_${bytesToHex(bytes)}`;
}

let ephemeralSecret: string | null = null;
export function getSigningSecret(envSecret?: string): string {
  if (envSecret && envSecret.trim().length >= 16) {
    return envSecret.trim();
  }
  if (!ephemeralSecret) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    ephemeralSecret = bytesToHex(bytes);
  }
  return ephemeralSecret;
}
