const METADATA_IDENTITY_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity';
const METADATA_TIMEOUT_MS = 1_000;
const TOKEN_CACHE_MS = 55 * 60 * 1_000;

type Fetcher = typeof fetch;

export interface MachineHeadersOptions {
  fetcher?: Fetcher;
  now?: () => number;
}

interface CachedToken {
  audience: string;
  expiresAt: number;
  fetcher: Fetcher;
  token: string;
}

interface TokenRequest {
  audience: string;
  fetcher: Fetcher;
  promise: Promise<string>;
}

let cachedToken: CachedToken | null = null;
let tokenRequest: TokenRequest | null = null;

async function requestMetadataToken(
  audience: string,
  fetcher: Fetcher
): Promise<string> {
  const url = new URL(METADATA_IDENTITY_URL);
  url.searchParams.set('audience', audience);
  url.searchParams.set('format', 'full');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), METADATA_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('Metadata identity request failed');

    const token = (await response.text()).trim();
    if (!token) throw new Error('Metadata identity response was empty');
    return token;
  } finally {
    clearTimeout(timeout);
  }
}

async function getMetadataToken(
  audience: string,
  fetcher: Fetcher,
  now: () => number
): Promise<string | null> {
  try {
    if (
      cachedToken &&
      cachedToken.audience === audience &&
      cachedToken.fetcher === fetcher &&
      now() < cachedToken.expiresAt
    ) {
      return cachedToken.token;
    }

    let pending: Promise<string>;
    if (
      tokenRequest &&
      tokenRequest.audience === audience &&
      tokenRequest.fetcher === fetcher
    ) {
      pending = tokenRequest.promise;
    } else {
      pending = requestMetadataToken(audience, fetcher);
      tokenRequest = { audience, fetcher, promise: pending };
    }

    const token = await pending;
    cachedToken = {
      audience,
      expiresAt: now() + TOKEN_CACHE_MS,
      fetcher,
      token,
    };
    return token;
  } catch {
    return null;
  } finally {
    if (
      tokenRequest?.audience === audience &&
      tokenRequest.fetcher === fetcher
    ) {
      tokenRequest = null;
    }
  }
}

export async function machineHeaders(
  opts: MachineHeadersOptions = {}
): Promise<Headers> {
  const cronSecret = process.env.CRON_SECRET || '';
  const headers = new Headers({ 'x-rosie-cron-auth': cronSecret });
  const audience = process.env.ROSIE_OIDC_AUDIENCE;
  const fetcher = opts.fetcher ?? globalThis.fetch;
  const now = opts.now ?? Date.now;

  const idToken = audience
    ? await getMetadataToken(audience, fetcher, now)
    : null;

  // Only ever a Google-signed OIDC token: IAP consumes this header, and the
  // app authenticates on x-rosie-cron-auth. Sending the raw shared secret here
  // would put a credential on the wire that nothing accepts.
  if (idToken) {
    headers.set('authorization', `Bearer ${idToken}`);
  }

  return headers;
}
