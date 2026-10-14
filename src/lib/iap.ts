const IAP_JWKS_URL = 'https://www.gstatic.com/iap/verify/public_key-jwk';
const IAP_ISSUER = 'https://cloud.google.com/iap';
const CLOCK_SKEW_SECONDS = 30;
const JWKS_TIMEOUT_MS = 5_000;

export interface IapIdentity {
  email: string;
}

export type IapJwk = JsonWebKey & { kid?: string };
export type IapJwksFetcher = () => Promise<IapJwk[]>;

export interface IapVerificationOptions {
  jwksFetcher?: IapJwksFetcher;
  /** Epoch milliseconds (Date.now()) or epoch seconds. */
  now?: () => number;
}

interface JwksCache {
  keys: IapJwk[] | null;
  loading: Promise<IapJwk[]> | null;
}

const jwksCaches = new WeakMap<IapJwksFetcher, JwksCache>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function fetchGoogleJwks(): Promise<IapJwk[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), JWKS_TIMEOUT_MS);
  try {
    const response = await fetch(IAP_JWKS_URL, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`IAP JWKS request failed with status ${response.status}`);
    }

    const body: unknown = await response.json();
    if (!isRecord(body) || !Array.isArray(body.keys)) {
      throw new Error('IAP JWKS response did not contain a key set');
    }
    return body.keys as IapJwk[];
  } finally {
    clearTimeout(timeout);
  }
}

function getJwksCache(fetcher: IapJwksFetcher): JwksCache {
  const cached = jwksCaches.get(fetcher);
  if (cached) return cached;

  const created: JwksCache = {
    keys: null,
    loading: null,
  };
  jwksCaches.set(fetcher, created);
  return created;
}

async function loadJwks(
  fetcher: IapJwksFetcher,
  cache: JwksCache,
  force: boolean
): Promise<IapJwk[]> {
  if (!force && cache.keys) return cache.keys;
  if (cache.loading) return cache.loading;

  const loading = fetcher().then((keys) => {
    if (!Array.isArray(keys)) {
      throw new Error('IAP JWKS fetcher returned an invalid key set');
    }
    cache.keys = keys;
    return keys;
  });
  cache.loading = loading;

  try {
    return await loading;
  } finally {
    if (cache.loading === loading) cache.loading = null;
  }
}

function decodeBase64Url(segment: string): Uint8Array {
  if (!segment || !/^[A-Za-z0-9_-]+$/.test(segment) || segment.length % 4 === 1) {
    throw new Error('Malformed base64url segment');
  }

  const padding = '='.repeat((4 - (segment.length % 4)) % 4);
  const binary = atob(segment.replace(/-/g, '+').replace(/_/g, '/') + padding);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function decodeJsonSegment(segment: string): Record<string, unknown> {
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(
    decodeBase64Url(segment)
  );
  const value: unknown = JSON.parse(decoded);
  if (!isRecord(value)) throw new Error('JWT segment was not an object');
  return value;
}

function debugValue(value: unknown): string | null {
  if (typeof value !== 'string') return value === undefined ? null : '[non-string]';
  return value.slice(0, 500);
}

function verificationFailure(payload?: Record<string, unknown>): null {
  if (process.env.ROSIE_IAP_DEBUG === '1') {
    try {
      console.warn('IAP JWT verification failed', {
        aud: debugValue(payload?.aud),
        iss: debugValue(payload?.iss),
      });
    } catch {
      // Debug logging must never change fail-closed verification behavior.
    }
  }
  return null;
}

function epochSeconds(timestamp: number): number {
  return timestamp >= 100_000_000_000 ? timestamp / 1_000 : timestamp;
}

async function findJwk(
  kid: string,
  fetcher: IapJwksFetcher
): Promise<IapJwk | null> {
  const cache = getJwksCache(fetcher);
  let keys = await loadJwks(fetcher, cache, false);
  let key = keys.find((candidate) => candidate.kid === kid);
  if (key) return key;

  keys = await loadJwks(fetcher, cache, true);
  key = keys.find((candidate) => candidate.kid === kid);
  return key ?? null;
}

export async function verifyIapJwt(
  assertion: string,
  opts: IapVerificationOptions = {}
): Promise<IapIdentity | null> {
  let payload: Record<string, unknown> | undefined;

  try {
    const parts = assertion.split('.');
    if (parts.length !== 3) return verificationFailure();

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = decodeJsonSegment(encodedHeader);
    payload = decodeJsonSegment(encodedPayload);

    if (header.alg !== 'ES256' || typeof header.kid !== 'string' || !header.kid) {
      return verificationFailure(payload);
    }

    const expectedAudience = process.env.ROSIE_IAP_AUDIENCE;
    if (
      !expectedAudience ||
      payload.iss !== IAP_ISSUER ||
      payload.aud !== expectedAudience
    ) {
      return verificationFailure(payload);
    }

    const nowSeconds = epochSeconds(opts.now?.() ?? Date.now());
    if (
      typeof payload.exp !== 'number' ||
      !Number.isFinite(payload.exp) ||
      typeof payload.iat !== 'number' ||
      !Number.isFinite(payload.iat) ||
      payload.exp < nowSeconds - CLOCK_SKEW_SECONDS ||
      payload.iat > nowSeconds + CLOCK_SKEW_SECONDS ||
      payload.exp < payload.iat
    ) {
      return verificationFailure(payload);
    }

    if (typeof payload.email !== 'string' || !payload.email.trim()) {
      return verificationFailure(payload);
    }

    const fetcher = opts.jwksFetcher ?? fetchGoogleJwks;
    const jwk = await findJwk(header.kid, fetcher);
    if (!jwk || (jwk.alg !== undefined && jwk.alg !== 'ES256')) {
      return verificationFailure(payload);
    }

    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    const decodedSignature = decodeBase64Url(encodedSignature);
    if (decodedSignature.byteLength !== 64) return verificationFailure(payload);
    const signature = Uint8Array.from(decodedSignature);

    const signedData = new TextEncoder().encode(
      `${encodedHeader}.${encodedPayload}`
    );
    const verified = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      signature,
      signedData
    );
    if (!verified) return verificationFailure(payload);

    return { email: payload.email.trim() };
  } catch {
    return verificationFailure(payload);
  }
}
