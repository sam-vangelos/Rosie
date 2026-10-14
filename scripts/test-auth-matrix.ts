import assert from 'node:assert/strict';
import {
  after,
  afterEach,
  before,
  beforeEach,
  describe,
  it,
} from 'node:test';
import {
  isCronAuthorized,
  isOperatorRequest,
} from '../src/lib/auth';
import {
  verifyIapJwt,
  type IapJwk,
  type IapJwksFetcher,
} from '../src/lib/iap';
import { machineHeaders } from '../src/lib/machine-fetch';
import { requireViewer } from '../src/lib/require-viewer';
import { GET as authCheck } from '../src/app/api/auth/check/route';
import { NextRequest } from 'next/server';
import { config as proxyConfig, proxy } from '../src/proxy';

const NOW_MS = Date.UTC(2026, 6, 27, 12, 0, 0);
const NOW_SECONDS = NOW_MS / 1_000;
const IAP_AUDIENCE =
  '/projects/000000000000/locations/us-central1/services/rosie';
const IAP_ISSUER = 'https://cloud.google.com/iap';
const KEY_ID = 'auth-matrix-key';

const ENV_KEYS = [
  'CRON_SECRET',
  'NODE_ENV',
  'ROSIE_ADMIN_EMAILS',
  'ROSIE_AUTH_SECRET',
  'ROSIE_CRON_INVOKERS',
  'ROSIE_IAP_AUDIENCE',
  'ROSIE_IAP_DEBUG',
  'ROSIE_MAINTENANCE',
  'ROSIE_OIDC_AUDIENCE',
] as const;

const savedEnv = new Map(
  ENV_KEYS.map((key) => [key, process.env[key]] as const)
);
const savedFetch = globalThis.fetch;

let privateKey: CryptoKey;
let publicJwk: IapJwk;

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else Reflect.set(process.env, key, value);
  }
}

function setNodeEnv(value: 'development' | 'production') {
  Reflect.set(process.env, 'NODE_ENV', value);
}

function base64Url(value: string | Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}

async function makeJwt(
  payloadOverrides: Record<string, unknown> = {},
  headerOverrides: Record<string, unknown> = {}
): Promise<string> {
  const header = {
    alg: 'ES256',
    kid: KEY_ID,
    typ: 'JWT',
    ...headerOverrides,
  };
  const payload = {
    aud: IAP_AUDIENCE,
    email: 'viewer@example.com',
    exp: NOW_SECONDS + 300,
    iat: NOW_SECONDS - 10,
    iss: IAP_ISSUER,
    ...payloadOverrides,
  };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signedData = new TextEncoder().encode(
    `${encodedHeader}.${encodedPayload}`
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      privateKey,
      signedData
    )
  );
  return `${encodedHeader}.${encodedPayload}.${base64Url(signature)}`;
}

const jwksFetcher: IapJwksFetcher = async () => [publicJwk];
const verificationOptions = {
  jwksFetcher,
  now: () => NOW_MS,
};

function requestWithHeaders(
  values: HeadersInit = {}
): { headers: Headers } {
  return { headers: new Headers(values) };
}

before(async () => {
  const keyPair = (await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  )) as CryptoKeyPair;
  privateKey = keyPair.privateKey;
  publicJwk = {
    ...(await crypto.subtle.exportKey('jwk', keyPair.publicKey)),
    alg: 'ES256',
    kid: KEY_ID,
    use: 'sig',
  };
});

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(restoreEnv);
afterEach(() => {
  globalThis.fetch = savedFetch;
});
after(() => {
  restoreEnv();
  globalThis.fetch = savedFetch;
});

describe('verifyIapJwt', () => {
  it('verifies a real ES256 assertion and returns its email', async () => {
    process.env.ROSIE_IAP_AUDIENCE = IAP_AUDIENCE;

    assert.deepEqual(
      await verifyIapJwt(await makeJwt(), verificationOptions),
      { email: 'viewer@example.com' }
    );
  });

  it('rejects the wrong audience', async () => {
    process.env.ROSIE_IAP_AUDIENCE = 'different-audience';

    assert.equal(
      await verifyIapJwt(await makeJwt(), verificationOptions),
      null
    );
  });

  it('rejects the wrong issuer', async () => {
    process.env.ROSIE_IAP_AUDIENCE = IAP_AUDIENCE;

    assert.equal(
      await verifyIapJwt(
        await makeJwt({ iss: 'https://example.com/not-iap' }),
        verificationOptions
      ),
      null
    );
  });

  it('rejects an assertion expired beyond clock skew', async () => {
    process.env.ROSIE_IAP_AUDIENCE = IAP_AUDIENCE;

    assert.equal(
      await verifyIapJwt(
        await makeJwt({
          exp: NOW_SECONDS - 31,
          iat: NOW_SECONDS - 300,
        }),
        verificationOptions
      ),
      null
    );
  });

  it('accepts an assertion expired within clock skew', async () => {
    process.env.ROSIE_IAP_AUDIENCE = IAP_AUDIENCE;

    assert.deepEqual(
      await verifyIapJwt(
        await makeJwt({
          exp: NOW_SECONDS - 29,
          iat: NOW_SECONDS - 300,
        }),
        verificationOptions
      ),
      { email: 'viewer@example.com' }
    );
  });

  it('rejects an assertion issued beyond future clock skew', async () => {
    process.env.ROSIE_IAP_AUDIENCE = IAP_AUDIENCE;

    assert.equal(
      await verifyIapJwt(
        await makeJwt({ iat: NOW_SECONDS + 31 }),
        verificationOptions
      ),
      null
    );
  });

  it('rejects alg=none', async () => {
    process.env.ROSIE_IAP_AUDIENCE = IAP_AUDIENCE;

    assert.equal(
      await verifyIapJwt(
        await makeJwt({}, { alg: 'none' }),
        verificationOptions
      ),
      null
    );
  });

  it('rejects alg=RS256', async () => {
    process.env.ROSIE_IAP_AUDIENCE = IAP_AUDIENCE;

    assert.equal(
      await verifyIapJwt(
        await makeJwt({}, { alg: 'RS256' }),
        verificationOptions
      ),
      null
    );
  });

  it('refetches exactly once when a kid is absent from the cache', async () => {
    process.env.ROSIE_IAP_AUDIENCE = IAP_AUDIENCE;
    let fetchCount = 0;
    const countingFetcher: IapJwksFetcher = async () => {
      fetchCount += 1;
      return [publicJwk];
    };

    assert.deepEqual(
      await verifyIapJwt(await makeJwt(), {
        jwksFetcher: countingFetcher,
        now: () => NOW_MS,
      }),
      { email: 'viewer@example.com' }
    );
    assert.equal(fetchCount, 1);

    assert.deepEqual(
      await verifyIapJwt(await makeJwt(), {
        jwksFetcher: countingFetcher,
        now: () => NOW_MS,
      }),
      { email: 'viewer@example.com' }
    );
    assert.equal(fetchCount, 1);

    assert.equal(
      await verifyIapJwt(
        await makeJwt({}, { kid: 'unknown-key' }),
        {
          jwksFetcher: countingFetcher,
          now: () => NOW_MS,
        }
      ),
      null
    );
    assert.equal(fetchCount, 2);
  });

  it('fails closed when ROSIE_IAP_AUDIENCE is unset', async () => {
    assert.equal(
      await verifyIapJwt(await makeJwt(), verificationOptions),
      null
    );
  });

  it('rejects a tampered payload', async () => {
    process.env.ROSIE_IAP_AUDIENCE = IAP_AUDIENCE;
    const assertion = await makeJwt();
    const [header, encodedPayload, signature] = assertion.split('.');
    const payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8')
    ) as Record<string, unknown>;
    payload.email = 'attacker@example.com';
    const tampered = `${header}.${base64Url(JSON.stringify(payload))}.${signature}`;

    assert.equal(
      await verifyIapJwt(tampered, verificationOptions),
      null
    );
  });

  it('rejects an assertion with no email', async () => {
    process.env.ROSIE_IAP_AUDIENCE = IAP_AUDIENCE;

    assert.equal(
      await verifyIapJwt(
        await makeJwt({ email: undefined }),
        verificationOptions
      ),
      null
    );
  });
});

describe('isCronAuthorized', () => {
  it('accepts the custom machine-secret header', async () => {
    process.env.CRON_SECRET = 'cron-secret';

    assert.equal(
      await isCronAuthorized(
        requestWithHeaders({ 'x-rosie-cron-auth': 'cron-secret' })
      ),
      true
    );
  });

  it('rejects a mismatched custom machine-secret header', async () => {
    process.env.CRON_SECRET = 'cron-secret';

    assert.equal(
      await isCronAuthorized(
        requestWithHeaders({ 'x-rosie-cron-auth': 'wrong-secret' })
      ),
      false
    );
  });

  it('accepts a verified IAP cron invoker case-insensitively', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    process.env.ROSIE_IAP_AUDIENCE = IAP_AUDIENCE;
    process.env.ROSIE_CRON_INVOKERS =
      'other@example.com, CRON@EXAMPLE.COM ';
    const assertion = await makeJwt({ email: 'cron@example.com' });

    assert.equal(
      await isCronAuthorized(
        requestWithHeaders({ 'x-goog-iap-jwt-assertion': assertion }),
        verificationOptions
      ),
      true
    );
  });

  it('rejects a verified IAP email outside the cron invoker list', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    process.env.ROSIE_IAP_AUDIENCE = IAP_AUDIENCE;
    process.env.ROSIE_CRON_INVOKERS = 'cron@example.com';
    const assertion = await makeJwt({ email: 'outsider@example.com' });

    assert.equal(
      await isCronAuthorized(
        requestWithHeaders({ 'x-goog-iap-jwt-assertion': assertion }),
        verificationOptions
      ),
      false
    );
  });

  it('rejects a bare Bearer secret — the legacy path was removed at cutover', async () => {
    process.env.CRON_SECRET = 'cron-secret';

    assert.equal(
      await isCronAuthorized(
        requestWithHeaders({ authorization: 'Bearer cron-secret' })
      ),
      false,
      'the app secret now travels only in x-rosie-cron-auth'
    );
  });

  it('still rejects legacy Bearer auth when an IAP assertion header is present', async () => {
    process.env.CRON_SECRET = 'cron-secret';

    assert.equal(
      await isCronAuthorized(
        requestWithHeaders({
          authorization: 'Bearer cron-secret',
          'x-goog-iap-jwt-assertion': 'malformed',
        })
      ),
      false
    );
  });

  it('fails closed when CRON_SECRET is unset', async () => {
    assert.equal(
      await isCronAuthorized(
        requestWithHeaders({
          authorization: 'Bearer ',
          'x-rosie-cron-auth': '',
        })
      ),
      false
    );
  });
});

describe('machineHeaders', () => {
  it('uses an OIDC token plus the custom secret after metadata success', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    process.env.ROSIE_OIDC_AUDIENCE = 'oauth-client-id';
    let fetchCount = 0;
    const fetcher: typeof fetch = async (input, init) => {
      fetchCount += 1;
      const url = new URL(
        input instanceof Request ? input.url : input.toString()
      );
      assert.equal(url.hostname, 'metadata.google.internal');
      assert.equal(url.searchParams.get('audience'), 'oauth-client-id');
      assert.equal(url.searchParams.get('format'), 'full');
      assert.equal(
        new Headers(init?.headers).get('metadata-flavor'),
        'Google'
      );
      return new Response('google-id-token');
    };

    const headers = await machineHeaders({
      fetcher,
      now: () => NOW_MS,
    });

    assert.equal(fetchCount, 1);
    assert.equal(headers.get('x-rosie-cron-auth'), 'cron-secret');
    assert.equal(headers.get('authorization'), 'Bearer google-id-token');
    assert.notEqual(
      headers.get('authorization'),
      'Bearer google-id-token, Bearer cron-secret'
    );
  });

  it('sends no Authorization header at all when the metadata server fails', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    process.env.ROSIE_OIDC_AUDIENCE = 'failing-oauth-client-id';
    const fetcher: typeof fetch = async () =>
      new Response('not available', { status: 404 });

    const headers = await machineHeaders({
      fetcher,
      now: () => NOW_MS,
    });

    assert.equal(headers.get('x-rosie-cron-auth'), 'cron-secret');
    assert.equal(
      headers.get('authorization'),
      null,
      'never put the raw shared secret on the wire — nothing accepts it'
    );
  });

  it('caches a metadata token across calls', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    process.env.ROSIE_OIDC_AUDIENCE = 'cached-oauth-client-id';
    let fetchCount = 0;
    const fetcher: typeof fetch = async () => {
      fetchCount += 1;
      return new Response('cached-id-token');
    };

    const first = await machineHeaders({
      fetcher,
      now: () => NOW_MS,
    });
    const second = await machineHeaders({
      fetcher,
      now: () => NOW_MS + 1_000,
    });

    assert.equal(first.get('authorization'), 'Bearer cached-id-token');
    assert.equal(second.get('authorization'), 'Bearer cached-id-token');
    assert.equal(fetchCount, 1);
  });

  it('skips metadata entirely when the OIDC audience is unset', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    let fetchCount = 0;
    const fetcher: typeof fetch = async () => {
      fetchCount += 1;
      return new Response('unexpected');
    };

    const headers = await machineHeaders({ fetcher });

    assert.equal(fetchCount, 0);
    assert.equal(headers.get('x-rosie-cron-auth'), 'cron-secret');
    assert.equal(headers.get('authorization'), null);
  });
});

describe('requireViewer', () => {
  it('rejects role headers alone — they are spoofable when the proxy did not run', async () => {
    const missing = new Error('not found');

    for (const role of ['viewer', 'operator']) {
      await assert.rejects(
        requireViewer({
          requestHeaders: new Headers({
            'x-rosie-auth-email': 'attacker@example.com',
            'x-rosie-auth-role': role,
          }),
          notFound: () => {
            throw missing;
          },
        }),
        (error) => error === missing
      );
    }
  });

  it('rejects a legacy session cookie without an IAP assertion', async () => {
    const missing = new Error('not found');

    await assert.rejects(
      requireViewer({
        requestHeaders: new Headers({
          cookie: 'other=value; rosie-session=obsolete',
        }),
        notFound: () => {
          throw missing;
        },
      }),
      (error) => error === missing
    );
  });

  it('independently accepts a verified IAP assertion without role headers', async () => {
    process.env.ROSIE_IAP_AUDIENCE = IAP_AUDIENCE;
    process.env.ROSIE_ADMIN_EMAILS = 'ADMIN@EXAMPLE.COM';
    const assertion = await makeJwt({ email: 'admin@example.com' });

    assert.deepEqual(
      await requireViewer({
        ...verificationOptions,
        requestHeaders: new Headers({
          'x-goog-iap-jwt-assertion': assertion,
        }),
      }),
      { role: 'operator', email: 'admin@example.com' }
    );
  });

  it('throws notFound when no authentication mechanism succeeds', async () => {
    const missing = new Error('not found');

    await assert.rejects(
      requireViewer({
        requestHeaders: new Headers(),
        notFound: () => {
          throw missing;
        },
      }),
      (error) => error === missing
    );
  });

  it('resolves local development as the configured operator', async () => {
    setNodeEnv('development');
    process.env.ROSIE_ADMIN_EMAILS = 'local.operator@example.com';

    assert.deepEqual(
      await requireViewer({
        requestHeaders: new Headers({ 'x-rosie-auth-role': 'operator' }),
      }),
      { role: 'operator', email: 'local.operator@example.com' }
    );
  });

  it('does not infer local access from NODE_ENV alone', async () => {
    setNodeEnv('development');
    const missing = new Error('not found');

    await assert.rejects(
      requireViewer({
        requestHeaders: new Headers(),
        notFound: () => {
          throw missing;
        },
      }),
      (error) => error === missing
    );
  });
});

describe('proxy auth matrix', () => {
  function nextRequest(
    path: string,
    init: ConstructorParameters<typeof NextRequest>[1] = {}
  ): NextRequest {
    return new NextRequest(`http://localhost${path}`, init);
  }

  function forwardedHeader(response: Response, name: string): string | null {
    return response.headers.get(`x-middleware-request-${name}`);
  }

  function installGoogleJwksResponse() {
    globalThis.fetch = async () =>
      Response.json({ keys: [publicJwk] });
  }

  async function currentJwt(
    payloadOverrides: Record<string, unknown> = {}
  ): Promise<string> {
    const nowSeconds = Date.now() / 1_000;
    return makeJwt({
      exp: nowSeconds + 300,
      iat: nowSeconds - 10,
      ...payloadOverrides,
    });
  }

  it('matches both API and future runs-page routes', () => {
    assert.deepEqual(proxyConfig.matcher, [
      '/api/:path*',
      '/runs',
      '/runs/:path*',
    ]);
  });

  it('returns maintenance mode before browser auth handling', async () => {
    process.env.ROSIE_MAINTENANCE = '1';

    const response = await proxy(nextRequest('/api/runs'));

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: 'Maintenance in progress',
    });
  });

  it('keeps GET auth check available during maintenance', async () => {
    process.env.ROSIE_MAINTENANCE = '1';
    setNodeEnv('development');

    const response = await proxy(nextRequest('/api/auth/check'));

    assert.equal(response.status, 200);
    assert.equal(
      forwardedHeader(response, 'x-rosie-auth-role'),
      'operator'
    );
  });

  it('replaces spoofable local role headers with the development identity', async () => {
    setNodeEnv('development');
    process.env.ROSIE_ADMIN_EMAILS = 'local.operator@example.com';

    const response = await proxy(
      nextRequest('/api/runs', {
        headers: {
          'x-rosie-auth-email': 'attacker@example.com',
          'x-rosie-auth-role': 'viewer',
        },
      })
    );

    assert.equal(response.status, 200);
    assert.equal(forwardedHeader(response, 'x-rosie-auth-role'), 'operator');
    assert.equal(
      forwardedHeader(response, 'x-rosie-auth-email'),
      'local.operator@example.com'
    );
  });

  it('injects viewer identity for a verified IAP GET', async () => {
    process.env.ROSIE_IAP_AUDIENCE = IAP_AUDIENCE;
    installGoogleJwksResponse();
    const assertion = await currentJwt({ email: 'viewer@example.com' });

    const response = await proxy(
      nextRequest('/runs/example', {
        headers: { 'x-goog-iap-jwt-assertion': assertion },
      })
    );

    assert.equal(response.status, 200);
    assert.equal(
      forwardedHeader(response, 'x-rosie-auth-role'),
      'viewer'
    );
    assert.equal(
      forwardedHeader(response, 'x-rosie-auth-email'),
      'viewer@example.com'
    );
  });

  it('forbids a non-admin IAP write even with a same-origin signal', async () => {
    process.env.ROSIE_IAP_AUDIENCE = IAP_AUDIENCE;
    process.env.ROSIE_ADMIN_EMAILS = 'admin@example.com';
    installGoogleJwksResponse();
    const assertion = await currentJwt({ email: 'viewer@example.com' });

    const response = await proxy(
      nextRequest('/api/runs', {
        method: 'POST',
        headers: {
          'sec-fetch-site': 'same-origin',
          'x-goog-iap-jwt-assertion': assertion,
        },
      })
    );

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'Forbidden' });
  });

  it('forbids an IAP-admin write without a same-origin signal', async () => {
    process.env.ROSIE_IAP_AUDIENCE = IAP_AUDIENCE;
    process.env.ROSIE_ADMIN_EMAILS = 'admin@example.com';
    installGoogleJwksResponse();
    const assertion = await currentJwt({ email: 'admin@example.com' });

    const response = await proxy(
      nextRequest('/api/runs', {
        method: 'POST',
        headers: { 'x-goog-iap-jwt-assertion': assertion },
      })
    );

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'Forbidden' });
  });

  it('injects operator identity for an IAP-admin same-origin write', async () => {
    process.env.ROSIE_IAP_AUDIENCE = IAP_AUDIENCE;
    process.env.ROSIE_ADMIN_EMAILS = 'ADMIN@EXAMPLE.COM';
    installGoogleJwksResponse();
    const assertion = await currentJwt({ email: 'admin@example.com' });

    const response = await proxy(
      nextRequest('/api/runs', {
        method: 'POST',
        headers: {
          origin: 'http://localhost',
          'x-goog-iap-jwt-assertion': assertion,
        },
      })
    );

    assert.equal(response.status, 200);
    assert.equal(
      forwardedHeader(response, 'x-rosie-auth-role'),
      'operator'
    );
    assert.equal(
      forwardedHeader(response, 'x-rosie-auth-email'),
      'admin@example.com'
    );
  });

  it('refuses a bare cron Bearer even without IAP (legacy path removed)', async () => {
    process.env.CRON_SECRET = 'cron-secret';

    const response = await proxy(
      nextRequest('/api/runs/run-id/tick', {
        method: 'POST',
        headers: { authorization: 'Bearer cron-secret' },
      })
    );

    assert.equal(response.status, 401);
  });

  it('accepts the cron custom header, which is how machines authenticate now', async () => {
    process.env.CRON_SECRET = 'cron-secret';

    const response = await proxy(
      nextRequest('/api/runs/run-id/tick', {
        method: 'POST',
        headers: { 'x-rosie-cron-auth': 'cron-secret' },
      })
    );

    assert.equal(response.status, 200);
  });

  it('requires IAP outside local development', async () => {
    const response = await proxy(nextRequest('/api/runs'));

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: 'Server misconfigured',
    });
  });

  it('auto-authenticates local development without a shared secret', async () => {
    setNodeEnv('development');
    process.env.ROSIE_ADMIN_EMAILS = 'local.operator@example.com';

    const response = await proxy(nextRequest('/api/runs'));

    assert.equal(response.status, 200);
    assert.equal(forwardedHeader(response, 'x-rosie-auth-role'), 'operator');
    assert.equal(
      forwardedHeader(response, 'x-rosie-auth-email'),
      'local.operator@example.com'
    );
  });

  it('does not auto-authenticate a non-loopback development host', async () => {
    setNodeEnv('development');

    const response = await proxy(
      new NextRequest('http://devbox.example/api/runs')
    );

    assert.equal(response.status, 500);
  });

  it('requires a same-origin signal for local development writes', async () => {
    setNodeEnv('development');

    const crossSite = await proxy(
      nextRequest('/api/runs', {
        method: 'POST',
        headers: { origin: 'https://attacker.example' },
      })
    );
    assert.equal(crossSite.status, 403);

    const sameOrigin = await proxy(
      nextRequest('/api/runs', {
        method: 'POST',
        headers: { 'sec-fetch-site': 'same-origin' },
      })
    );
    assert.equal(sameOrigin.status, 200);
  });

  it('does not accept ROSIE_AUTH_SECRET as production authentication', async () => {
    setNodeEnv('production');
    process.env.ROSIE_AUTH_SECRET = 'obsolete-secret';

    const response = await proxy(nextRequest('/api/runs'));

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: 'Server misconfigured',
    });
  });

  it('admin identity is operator on an IAP GET', async () => {
    process.env.ROSIE_IAP_AUDIENCE = IAP_AUDIENCE;
    process.env.ROSIE_ADMIN_EMAILS = 'admin@example.com';
    installGoogleJwksResponse();
    const assertion = await currentJwt({ email: 'admin@example.com' });

    const response = await proxy(
      nextRequest('/api/runs', {
        headers: { 'x-goog-iap-jwt-assertion': assertion },
      })
    );

    assert.equal(response.status, 200);
    assert.equal(forwardedHeader(response, 'x-rosie-auth-role'), 'operator');
  });

  it('an obsolete cookie cannot alter an IAP viewer identity', async () => {
    process.env.ROSIE_IAP_AUDIENCE = IAP_AUDIENCE;
    process.env.ROSIE_ADMIN_EMAILS = 'admin@example.com';
    installGoogleJwksResponse();
    const assertion = await currentJwt({ email: 'viewer@example.com' });

    const read = await proxy(
      nextRequest('/api/runs', {
        headers: {
          cookie: 'rosie-session=obsolete',
          'x-goog-iap-jwt-assertion': assertion,
        },
      })
    );
    assert.equal(forwardedHeader(read, 'x-rosie-auth-role'), 'viewer');

    const write = await proxy(
      nextRequest('/api/runs', {
        method: 'POST',
        headers: {
          cookie: 'rosie-session=obsolete',
          'sec-fetch-site': 'same-origin',
          'x-goog-iap-jwt-assertion': assertion,
        },
      })
    );
    assert.equal(write.status, 403);
  });

  it('fails closed when IAP is absent outside development', async () => {
    process.env.ROSIE_IAP_AUDIENCE = IAP_AUDIENCE;

    const response = await proxy(nextRequest('/api/runs'));

    assert.equal(response.status, 401, 'anonymous is still refused');

    delete process.env.ROSIE_IAP_AUDIENCE;
    const misconfigured = await proxy(nextRequest('/api/runs'));
    assert.equal(
      misconfigured.status,
      500,
      'production without IAP has no browser authentication path'
    );
  });
});

describe('operator compatibility and auth check', () => {
  it('accepts an injected operator role for nudge authorization', async () => {
    assert.equal(
      await isOperatorRequest({
        headers: new Headers({ 'x-rosie-auth-role': 'operator' }),
      }),
      true
    );
  });

  it('rejects an obsolete cookie without an injected operator role', async () => {
    assert.equal(
      await isOperatorRequest({
        headers: new Headers({ cookie: 'rosie-session=obsolete' }),
      }),
      false
    );
  });

  it('auth check returns injected identity fields', async () => {
    const response = await authCheck(
      new Request('http://localhost/api/auth/check', {
        headers: {
          'x-rosie-auth-email': 'viewer@example.com',
          'x-rosie-auth-role': 'viewer',
        },
      })
    );

    assert.deepEqual(await response.json(), {
      ok: true,
      role: 'viewer',
      email: 'viewer@example.com',
    });
  });

  it('auth check preserves local defaults without injected headers', async () => {
    const response = await authCheck(
      new Request('http://localhost/api/auth/check')
    );

    assert.deepEqual(await response.json(), {
      ok: true,
      role: 'operator',
      email: null,
    });
  });
});
