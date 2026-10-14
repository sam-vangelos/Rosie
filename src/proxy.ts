import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  isCronAuthorized,
  isEmailInConfiguredList,
} from '@/lib/auth';
import { verifyIapJwt } from '@/lib/iap';

const AUTH_CHECK_PATH = '/api/auth/check';

type AuthRole = 'operator' | 'viewer';

function continueRequest(
  requestHeaders: Headers,
  identity?: { role: AuthRole; email: string }
) {
  if (identity) {
    requestHeaders.set('x-rosie-auth-role', identity.role);
    requestHeaders.set('x-rosie-auth-email', identity.email);
  }
  return NextResponse.next({ request: { headers: requestHeaders } });
}

function firstAdminEmail(): string {
  return (
    (process.env.ROSIE_ADMIN_EMAILS || '')
      .split(',')
      .map((email) => email.trim())
      .find(Boolean) || 'operator'
  );
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '[::1]' ||
    normalized.startsWith('127.')
  );
}

function hasSameOriginSignal(request: NextRequest, requestHeaders: Headers): boolean {
  const fetchSite = (
    requestHeaders.get('sec-fetch-site') || ''
  ).trim().toLowerCase();
  if (fetchSite === 'same-origin' || fetchSite === 'none') return true;

  const origin = requestHeaders.get('origin');
  if (!origin) return false;

  try {
    const requestHost = (
      requestHeaders.get('host') || request.nextUrl.host
    ).toLowerCase();
    return new URL(origin).host.toLowerCase() === requestHost;
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    process.env.ROSIE_MAINTENANCE === '1' &&
    !(request.method === 'GET' && pathname === AUTH_CHECK_PATH)
  ) {
    return NextResponse.json(
      { error: 'Maintenance in progress' },
      { status: 503 }
    );
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete('x-rosie-auth-role');
  requestHeaders.delete('x-rosie-auth-email');

  const cronPath =
    /^\/api\/runs\/[^/]+\/tick$/.test(pathname) ||
    pathname.startsWith('/api/cron/');
  if (cronPath) {
    if (!process.env.CRON_SECRET) {
      return NextResponse.json(
        { error: 'Server misconfigured' },
        { status: 500 }
      );
    }
    if (!(await isCronAuthorized({ headers: requestHeaders }))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return continueRequest(requestHeaders);
  }

  if (
    process.env.NODE_ENV === 'development' &&
    isLoopbackHostname(request.nextUrl.hostname)
  ) {
    if (
      request.method !== 'GET' &&
      request.method !== 'HEAD' &&
      !hasSameOriginSignal(request, requestHeaders)
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return continueRequest(requestHeaders, {
      role: 'operator',
      email: firstAdminEmail(),
    });
  }

  const iapConfigured = Boolean(process.env.ROSIE_IAP_AUDIENCE);
  if (!iapConfigured) {
    return NextResponse.json(
      { error: 'Server misconfigured' },
      { status: 500 }
    );
  }

  const assertion = requestHeaders.get('x-goog-iap-jwt-assertion');
  if (assertion) {
    const identity = await verifyIapJwt(assertion);
    if (identity) {
      const isAdmin = isEmailInConfiguredList(
        identity.email,
        process.env.ROSIE_ADMIN_EMAILS
      );

      if (request.method === 'GET' || request.method === 'HEAD') {
        return continueRequest(requestHeaders, {
          role: isAdmin ? 'operator' : 'viewer',
          email: identity.email,
        });
      }

      // Mutations still require a same-origin signal: IAP cookies are ambient,
      // so a verified identity alone does not prove the request was intended.
      if (!isAdmin || !hasSameOriginSignal(request, requestHeaders)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      return continueRequest(requestHeaders, {
        role: 'operator',
        email: identity.email,
      });
    }
  }

  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export const config = {
  matcher: ['/api/:path*', '/runs', '/runs/:path*'],
};
