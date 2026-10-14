import { headers as nextHeaders } from 'next/headers';
import { notFound as nextNotFound } from 'next/navigation';
import { isEmailInConfiguredList } from '@/lib/auth';
import {
  verifyIapJwt,
  type IapVerificationOptions,
} from '@/lib/iap';

export type ViewerRole = 'operator' | 'viewer';

export interface ViewerIdentity {
  role: ViewerRole;
  email: string | null;
}

interface HeaderReader {
  get(name: string): string | null;
}

export interface RequireViewerOptions extends IapVerificationOptions {
  requestHeaders?: HeaderReader;
  notFound?: () => never;
}

function firstAdminEmail(): string {
  return (
    (process.env.ROSIE_ADMIN_EMAILS || '')
      .split(',')
      .map((email) => email.trim())
      .find(Boolean) || 'operator'
  );
}

export async function requireViewer(
  opts: RequireViewerOptions = {}
): Promise<ViewerIdentity> {
  const identity = await resolveViewer(opts);
  if (identity) return identity;
  return (opts.notFound ?? nextNotFound)();
}

/**
 * Same identity derivation as requireViewer, but returns null instead of
 * throwing — API route handlers need to answer with their own status code.
 */
export async function resolveViewer(
  opts: RequireViewerOptions = {}
): Promise<ViewerIdentity | null> {
  const requestHeaders = opts.requestHeaders ?? (await nextHeaders());

  if (
    process.env.NODE_ENV === 'development' &&
    requestHeaders.get('x-rosie-auth-role') === 'operator'
  ) {
    return { role: 'operator', email: firstAdminEmail() };
  }

  // Never trust x-rosie-auth-* here: this guard exists for the case where the
  // sanitizing proxy did NOT run, so those headers may be attacker-supplied.
  // Authentication below is always re-derived from primary evidence.
  const assertion = requestHeaders.get('x-goog-iap-jwt-assertion');
  if (assertion) {
    const identity = await verifyIapJwt(assertion, opts);
    if (identity) {
      return {
        role: isEmailInConfiguredList(
          identity.email,
          process.env.ROSIE_ADMIN_EMAILS
        )
          ? 'operator'
          : 'viewer',
        email: identity.email,
      };
    }
  }

  return null;
}
