import {
  getAllJobs,
  getUserByEmail,
  type GHUser,
} from './greenhouse';

export type JobAccess =
  | { kind: 'all' }
  | { kind: 'jobs'; jobIds: Set<number> };

const CACHE_TTL_MS = 5 * 60 * 1_000;

type RecruiterJobMap = Map<number, Set<number>>;

interface CacheEntry<T> {
  expiresAt: number;
  value: Promise<T>;
}

let recruiterJobsCache: CacheEntry<RecruiterJobMap> | null = null;
const userCache = new Map<string, CacheEntry<GHUser | null>>();

function noJobAccess(): JobAccess {
  return { kind: 'jobs', jobIds: new Set() };
}

async function readCacheEntry<T>(
  entry: CacheEntry<T>,
  clearIfCurrent: () => void
): Promise<T> {
  try {
    return await entry.value;
  } catch (error) {
    clearIfCurrent();
    throw error;
  }
}

async function getCachedUser(email: string): Promise<GHUser | null> {
  const now = Date.now();
  const cached = userCache.get(email);
  if (cached && cached.expiresAt > now) {
    return readCacheEntry(cached, () => {
      if (userCache.get(email) === cached) userCache.delete(email);
    });
  }

  if (cached) userCache.delete(email);
  const entry: CacheEntry<GHUser | null> = {
    expiresAt: now + CACHE_TTL_MS,
    value: getUserByEmail(email),
  };
  userCache.set(email, entry);
  return readCacheEntry(entry, () => {
    if (userCache.get(email) === entry) userCache.delete(email);
  });
}

async function buildRecruiterJobMap(): Promise<RecruiterJobMap> {
  const jobs = await getAllJobs();
  const recruiterJobs = new Map<number, Set<number>>();

  for (const job of jobs) {
    if (job.is_template !== false || !Number.isSafeInteger(job.id)) continue;

    // Recruiters and sourcers only. Sourcers are included because they are
    // asked to work these lists and speak with candidates, so they need the
    // same view of a requisition's screen as its recruiter. Coordinators and
    // hiring managers are still excluded — widen this deliberately, never by
    // reflex, because these pages carry AI-generated assessments of real
    // people.
    for (const member of [
      ...(job.hiring_team?.recruiters ?? []),
      ...(job.hiring_team?.sourcers ?? []),
    ]) {
      if (!Number.isSafeInteger(member.id)) continue;

      const jobIds = recruiterJobs.get(member.id) ?? new Set<number>();
      jobIds.add(job.id);
      recruiterJobs.set(member.id, jobIds);
    }
  }

  return recruiterJobs;
}

async function getCachedRecruiterJobMap(): Promise<RecruiterJobMap> {
  const now = Date.now();
  if (recruiterJobsCache && recruiterJobsCache.expiresAt > now) {
    const cached = recruiterJobsCache;
    return readCacheEntry(cached, () => {
      if (recruiterJobsCache === cached) recruiterJobsCache = null;
    });
  }

  recruiterJobsCache = {
    expiresAt: now + CACHE_TTL_MS,
    value: buildRecruiterJobMap(),
  };
  const entry = recruiterJobsCache;
  return readCacheEntry(entry, () => {
    if (recruiterJobsCache === entry) recruiterJobsCache = null;
  });
}

export async function resolveJobAccess(input: {
  role: 'operator' | 'viewer';
  email: string | null;
}): Promise<JobAccess> {
  if (input.role === 'operator') return { kind: 'all' };
  if (!input.email) return noJobAccess();

  const email = input.email.trim().toLowerCase();
  if (!email) return noJobAccess();

  let user: GHUser | null;
  try {
    user = await getCachedUser(email);
  } catch {
    console.error(
      '[job-access] Greenhouse user lookup failed; denying viewer access'
    );
    return noJobAccess();
  }

  if (
    !user ||
    user.disabled !== false ||
    !Number.isSafeInteger(user.id)
  ) {
    return noJobAccess();
  }

  // A Greenhouse site admin already sees every candidate and every
  // requisition in Greenhouse itself, so withholding the same information
  // here protects nothing. Read-only: this returns a viewing scope, and the
  // separate operator check (ROSIE_ADMIN_EMAILS, enforced in the proxy) is
  // what permits starting or cancelling a run. Being able to see everything
  // is not the same power as being able to spend money.
  if (user.site_admin === true) {
    return { kind: 'all' };
  }

  try {
    const recruiterJobs = await getCachedRecruiterJobMap();
    return {
      kind: 'jobs',
      jobIds: new Set(recruiterJobs.get(user.id) ?? []),
    };
  } catch {
    console.error(
      `[job-access] Greenhouse recruiter map failed for user_id=${user.id}; denying viewer access`
    );
    return noJobAccess();
  }
}

export function __resetJobAccessCacheForTests(): void {
  recruiterJobsCache = null;
  userCache.clear();
}
