import {
  verifyIapJwt,
  type IapVerificationOptions,
} from '@/lib/iap';

// Constant-time comparison without Node.js crypto (Edge Runtime compatible)
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function isOperatorRequest(request: {
  headers?: { get(name: string): string | null };
}): Promise<boolean> {
  return request.headers?.get('x-rosie-auth-role') === 'operator';
}

export function isEmailInConfiguredList(
  email: string,
  configuredEmails: string | undefined
): boolean {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return false;

  return (configuredEmails || '')
    .split(',')
    .some((candidate) => candidate.trim().toLowerCase() === normalizedEmail);
}

export async function isCronAuthorized(
  request: { headers: { get(name: string): string | null } },
  opts: IapVerificationOptions = {}
): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const customAuthorization = request.headers.get('x-rosie-cron-auth') || '';
  if (timingSafeEqual(customAuthorization, secret)) return true;

  // IAP owns the Authorization header, so the app secret travels in
  // x-rosie-cron-auth (above). Cloud Scheduler carries no app secret at all
  // and is authorized purely by its verified IAP identity.
  const assertion = request.headers.get('x-goog-iap-jwt-assertion');
  if (assertion !== null) {
    const identity = await verifyIapJwt(assertion, opts);
    return Boolean(
      identity &&
        isEmailInConfiguredList(
          identity.email,
          process.env.ROSIE_CRON_INVOKERS
        )
    );
  }

  return false;
}
