import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  __setTestOverrides,
  type GHHiringTeamMember,
  type GHJob,
  type GHUser,
} from '../src/lib/greenhouse';
import {
  __resetJobAccessCacheForTests,
  resolveJobAccess,
  type JobAccess,
} from '../src/lib/job-access';

const originalFetch = globalThis.fetch;
const originalConsoleError = console.error;

interface FakeGreenhouseOptions {
  user: GHUser | null;
  jobs?: GHJob[];
  failingJobRequests?: number;
}

interface FakeGreenhouseCalls {
  total: number;
  users: number;
  jobs: number;
  emails: string[];
  jobUrls: string[];
}

function greenhouseUser(
  overrides: Partial<GHUser> = {}
): GHUser {
  return {
    id: 42,
    name: 'Test Recruiter',
    primary_email_address: 'recruiter@example.com',
    emails: ['recruiter@example.com'],
    disabled: false,
    ...overrides,
  };
}

function hiringTeamMember(id: number): GHHiringTeamMember {
  return { id, name: `Greenhouse User ${id}` };
}

function greenhouseJob(
  id: number,
  overrides: Partial<GHJob> = {}
): GHJob {
  return {
    id,
    name: `Job ${id}`,
    status: 'open',
    departments: [],
    offices: [],
    opened_at: '2026-01-01T00:00:00Z',
    closed_at: null,
    requisition_id: `REQ-${id}`,
    notes: null,
    is_template: false,
    openings: [],
    ...overrides,
  };
}

function installFakeGreenhouse(
  options: FakeGreenhouseOptions
): FakeGreenhouseCalls {
  const calls: FakeGreenhouseCalls = {
    total: 0,
    users: 0,
    jobs: 0,
    emails: [],
    jobUrls: [],
  };

  globalThis.fetch = async (input) => {
    calls.total++;
    const url = new URL(input instanceof Request ? input.url : String(input));

    if (url.pathname.endsWith('/users')) {
      calls.users++;
      calls.emails.push(url.searchParams.get('email') ?? '');
      return options.user
        ? Response.json(options.user)
        : new Response('user not found', { status: 404 });
    }

    if (url.pathname.endsWith('/jobs')) {
      calls.jobs++;
      calls.jobUrls.push(url.toString());
      if (calls.jobs <= (options.failingJobRequests ?? 0)) {
        return new Response('server error', { status: 500 });
      }
      return Response.json(options.jobs ?? []);
    }

    throw new Error(`Unexpected Greenhouse URL path: ${url.pathname}`);
  };

  return calls;
}

function assertJobIds(access: JobAccess, expected: number[]): void {
  if (access.kind !== 'jobs') {
    assert.fail('Expected job-scoped access');
  }
  assert.deepEqual(
    [...access.jobIds].sort((left, right) => left - right),
    [...expected].sort((left, right) => left - right)
  );
}

beforeEach(() => {
  __resetJobAccessCacheForTests();
  __setTestOverrides({ sleep: async () => {} });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;
  __setTestOverrides();
  __resetJobAccessCacheForTests();
});

describe('resolveJobAccess', () => {
  it('gives operators all access without calling Greenhouse', async () => {
    const calls = installFakeGreenhouse({
      user: greenhouseUser(),
      jobs: [greenhouseJob(101)],
    });

    assert.deepEqual(
      await resolveJobAccess({
        role: 'operator',
        email: 'operator@example.com',
      }),
      { kind: 'all' }
    );
    assert.equal(calls.total, 0);
  });

  it('returns exactly the jobs where the viewer is a recruiter', async () => {
    const recruiter = hiringTeamMember(42);
    const calls = installFakeGreenhouse({
      user: greenhouseUser(),
      jobs: [
        greenhouseJob(101, {
          hiring_team: { recruiters: [recruiter] },
        }),
        greenhouseJob(102, {
          hiring_team: { recruiters: [hiringTeamMember(7)] },
        }),
        greenhouseJob(103, {
          hiring_team: { recruiters: [] },
        }),
        greenhouseJob(104, {
          hiring_team: {
            recruiters: [hiringTeamMember(7), recruiter],
          },
        }),
        greenhouseJob(105, {
          hiring_team: { recruiters: [hiringTeamMember(8)] },
        }),
      ],
    });

    assertJobIds(
      await resolveJobAccess({
        role: 'viewer',
        email: 'recruiter@example.com',
      }),
      [101, 104]
    );
    assert.equal(calls.users, 1);
    assert.equal(calls.jobs, 1);
  });

  it('does not grant access for coordinator or hiring manager membership', async () => {
    const viewer = hiringTeamMember(42);
    installFakeGreenhouse({
      user: greenhouseUser(),
      jobs: [
        greenhouseJob(201, {
          hiring_team: {
            recruiters: [hiringTeamMember(7)],
            coordinators: [viewer],
          },
        }),
        greenhouseJob(202, {
          hiring_team: {
            recruiters: [hiringTeamMember(8)],
            hiring_managers: [viewer],
          },
        }),
      ],
    });

    assertJobIds(
      await resolveJobAccess({
        role: 'viewer',
        email: 'recruiter@example.com',
      }),
      []
    );
  });

  it('grants every run to a Greenhouse site admin', async () => {
    // A site admin already sees every candidate in Greenhouse itself, so
    // withholding the same information here protects nothing.
    installFakeGreenhouse({
      user: greenhouseUser({ site_admin: true }),
      jobs: [
        greenhouseJob(401, {
          hiring_team: { recruiters: [hiringTeamMember(999)] },
        }),
      ],
    });

    const access = await resolveJobAccess({
      role: 'viewer',
      email: 'recruiter@example.com',
    });

    assert.equal(
      access.kind,
      'all',
      'a site admin sees every run, not only their own requisitions'
    );
  });

  it('does not grant everything to a non-site-admin', async () => {
    installFakeGreenhouse({
      user: greenhouseUser({ site_admin: false }),
      jobs: [
        greenhouseJob(402, {
          hiring_team: { recruiters: [hiringTeamMember(999)] },
        }),
      ],
    });

    assertJobIds(
      await resolveJobAccess({ role: 'viewer', email: 'recruiter@example.com' }),
      []
    );
  });

  it('still denies a disabled site admin', async () => {
    installFakeGreenhouse({
      user: greenhouseUser({ site_admin: true, disabled: true }),
      jobs: [
        greenhouseJob(403, {
          hiring_team: { recruiters: [hiringTeamMember(42)] },
        }),
      ],
    });

    assertJobIds(
      await resolveJobAccess({ role: 'viewer', email: 'recruiter@example.com' }),
      []
    );
  });

  it('grants access for sourcer membership', async () => {
    // Sourcers work these lists and speak with candidates, so they get the
    // same view as the requisition's recruiter.
    const viewer = hiringTeamMember(42);
    installFakeGreenhouse({
      user: greenhouseUser(),
      jobs: [
        greenhouseJob(203, {
          hiring_team: {
            recruiters: [hiringTeamMember(9)],
            sourcers: [viewer],
          },
        }),
        greenhouseJob(204, {
          hiring_team: { recruiters: [hiringTeamMember(9)] },
        }),
      ],
    });

    assertJobIds(
      await resolveJobAccess({
        role: 'viewer',
        email: 'recruiter@example.com',
      }),
      [203]
    );
  });

  it('does not double-count someone who is both recruiter and sourcer', async () => {
    const viewer = hiringTeamMember(42);
    installFakeGreenhouse({
      user: greenhouseUser(),
      jobs: [
        greenhouseJob(205, {
          hiring_team: { recruiters: [viewer], sourcers: [viewer] },
        }),
      ],
    });

    assertJobIds(
      await resolveJobAccess({
        role: 'viewer',
        email: 'recruiter@example.com',
      }),
      [205]
    );
  });

  it('returns no jobs when the email is not found in Greenhouse', async () => {
    const calls = installFakeGreenhouse({
      user: null,
      jobs: [
        greenhouseJob(301, {
          hiring_team: { recruiters: [hiringTeamMember(42)] },
        }),
      ],
    });

    assertJobIds(
      await resolveJobAccess({
        role: 'viewer',
        email: 'missing@example.com',
      }),
      []
    );
    assert.equal(calls.users, 1);
    assert.equal(calls.jobs, 0);
  });

  it('returns no jobs for a disabled Greenhouse user', async () => {
    const calls = installFakeGreenhouse({
      user: greenhouseUser({ disabled: true }),
      jobs: [
        greenhouseJob(302, {
          hiring_team: { recruiters: [hiringTeamMember(42)] },
        }),
      ],
    });

    assertJobIds(
      await resolveJobAccess({
        role: 'viewer',
        email: 'recruiter@example.com',
      }),
      []
    );
    assert.equal(calls.users, 1);
    assert.equal(calls.jobs, 0);
  });

  it('fails closed when the Greenhouse user disabled flag is ambiguous', async () => {
    const ambiguousUser: Partial<GHUser> = greenhouseUser();
    delete ambiguousUser.disabled;
    const calls = installFakeGreenhouse({
      user: ambiguousUser as GHUser,
      jobs: [
        greenhouseJob(303, {
          hiring_team: { recruiters: [hiringTeamMember(42)] },
        }),
      ],
    });

    assertJobIds(
      await resolveJobAccess({
        role: 'viewer',
        email: 'recruiter@example.com',
      }),
      []
    );
    assert.equal(calls.jobs, 0);
  });

  it('returns no jobs for a null email without calling Greenhouse', async () => {
    const calls = installFakeGreenhouse({
      user: greenhouseUser(),
      jobs: [greenhouseJob(304)],
    });

    assertJobIds(
      await resolveJobAccess({ role: 'viewer', email: null }),
      []
    );
    assert.equal(calls.total, 0);
  });

  it('ignores jobs with missing or empty recruiter data', async () => {
    installFakeGreenhouse({
      user: greenhouseUser(),
      jobs: [
        greenhouseJob(401),
        greenhouseJob(402, {
          hiring_team: { coordinators: [hiringTeamMember(42)] },
        }),
        greenhouseJob(403, {
          hiring_team: { recruiters: [] },
        }),
      ],
    });

    assertJobIds(
      await resolveJobAccess({
        role: 'viewer',
        email: 'recruiter@example.com',
      }),
      []
    );
  });

  it('excludes template jobs', async () => {
    installFakeGreenhouse({
      user: greenhouseUser(),
      jobs: [
        greenhouseJob(501, {
          is_template: true,
          hiring_team: { recruiters: [hiringTeamMember(42)] },
        }),
      ],
    });

    assertJobIds(
      await resolveJobAccess({
        role: 'viewer',
        email: 'recruiter@example.com',
      }),
      []
    );
  });

  it('fails closed when a job template flag is ambiguous', async () => {
    const ambiguousJob: Partial<GHJob> = greenhouseJob(502, {
      hiring_team: { recruiters: [hiringTeamMember(42)] },
    });
    delete ambiguousJob.is_template;
    installFakeGreenhouse({
      user: greenhouseUser(),
      jobs: [ambiguousJob as GHJob],
    });

    assertJobIds(
      await resolveJobAccess({
        role: 'viewer',
        email: 'recruiter@example.com',
      }),
      []
    );
  });

  it('includes closed jobs and fetches jobs without a status filter', async () => {
    const calls = installFakeGreenhouse({
      user: greenhouseUser(),
      jobs: [
        greenhouseJob(601, {
          status: 'closed',
          closed_at: '2026-06-01T00:00:00Z',
          hiring_team: { recruiters: [hiringTeamMember(42)] },
        }),
      ],
    });

    assertJobIds(
      await resolveJobAccess({
        role: 'viewer',
        email: 'recruiter@example.com',
      }),
      [601]
    );
    assert.equal(
      new URL(calls.jobUrls[0]).searchParams.has('status'),
      false
    );
  });

  it('fails closed when the jobs map fails and does not cache the failure', async () => {
    const calls = installFakeGreenhouse({
      user: greenhouseUser(),
      jobs: [
        greenhouseJob(701, {
          hiring_team: { recruiters: [hiringTeamMember(42)] },
        }),
      ],
      failingJobRequests: 4,
    });
    const errors: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };

    const failed = await resolveJobAccess({
      role: 'viewer',
      email: 'recruiter@example.com',
    });
    assertJobIds(failed, []);
    assert.notEqual(failed.kind, 'all');

    assertJobIds(
      await resolveJobAccess({
        role: 'viewer',
        email: 'recruiter@example.com',
      }),
      [701]
    );
    assert.equal(calls.users, 1);
    assert.equal(calls.jobs, 5);
    assert.equal(errors.length, 1);
  });

  it('caches user and job lookups within the TTL and refetches after reset', async () => {
    const calls = installFakeGreenhouse({
      user: greenhouseUser(),
      jobs: [
        greenhouseJob(801, {
          hiring_team: { recruiters: [hiringTeamMember(42)] },
        }),
      ],
    });
    const input = {
      role: 'viewer' as const,
      email: 'recruiter@example.com',
    };

    assertJobIds(await resolveJobAccess(input), [801]);
    assertJobIds(await resolveJobAccess(input), [801]);
    assert.equal(calls.users, 1);
    assert.equal(calls.jobs, 1);

    __resetJobAccessCacheForTests();

    assertJobIds(await resolveJobAccess(input), [801]);
    assert.equal(calls.users, 2);
    assert.equal(calls.jobs, 2);
  });

  it('matches and caches viewer emails case-insensitively', async () => {
    const calls = installFakeGreenhouse({
      user: greenhouseUser(),
      jobs: [
        greenhouseJob(901, {
          hiring_team: { recruiters: [hiringTeamMember(42)] },
        }),
      ],
    });

    assertJobIds(
      await resolveJobAccess({
        role: 'viewer',
        email: 'Recruiter@EXAMPLE.COM',
      }),
      [901]
    );
    assertJobIds(
      await resolveJobAccess({
        role: 'viewer',
        email: 'recruiter@example.com',
      }),
      [901]
    );
    assert.deepEqual(calls.emails, ['recruiter@example.com']);
    assert.equal(calls.jobs, 1);
  });
});
