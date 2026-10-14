import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { describe, it, test } from 'node:test';
import { NextRequest } from 'next/server';
import type { ScoringRubric } from '../src/lib/types';

if (!process.env.DATABASE_URL) {
  try {
    loadEnvFile('.env.local');
  } catch {
    // DB-backed cases skip below when no local database is configured.
  }
}

// The unit tests below never touch the database: refresh.ts takes its store
// and Greenhouse calls as injected deps, and db.ts builds its pool on first
// query rather than at import, so importing this module connects to nothing.
// Only the last case needs a real database, and it skips without one.
const HAS_REAL_DB = Boolean(process.env.DATABASE_URL);

type RefreshModule = typeof import('../src/lib/refresh');
type RunStoreModule = typeof import('../src/lib/run-store');
type RefreshDeps = RefreshModule extends { runScheduledRefresh: (deps: infer D) => unknown }
  ? D
  : never;
type CreateRunInput = Parameters<RunStoreModule['createRun']>[0];
type CreateRunResult = Awaited<ReturnType<RunStoreModule['createRun']>>;
type Template = Awaited<ReturnType<RunStoreModule['getRefreshableJobTemplates']>>[number];

const rubric: ScoringRubric = {
  criteria: [
    {
      id: 'systems',
      name: 'Systems',
      description: 'Builds reliable systems',
      weight: 100,
      scoringGuide: { high: 'Excellent', mid: 'Adequate', low: 'Limited' },
    },
  ],
  tableStakes: ['TypeScript'],
};

function template(overrides: Partial<Template> = {}): Template {
  return {
    jobId: 101,
    jobTitle: 'Stored title',
    provider: 'api',
    rubricVersion: 'rubric-1',
    calibrationVersion: 'cal-1',
    rubric,
    idealPatterns: null,
    ...overrides,
  };
}

interface FakeHarness {
  deps: RefreshDeps;
  created: CreateRunInput[];
  fetchedJobIds: number[];
  kickedRunIds: string[];
}

function fakeDeps(
  templates: Template[],
  overrides: Partial<RefreshDeps> = {}
): FakeHarness {
  const created: CreateRunInput[] = [];
  const fetchedJobIds: number[] = [];
  const kickedRunIds: string[] = [];
  const deps: RefreshDeps = {
    listTemplates: async () => templates,
    fetchJob: async (jobId) => {
      fetchedJobIds.push(jobId);
      return { status: 'open', name: 'Fresh title' };
    },
    create: async (input) => {
      created.push(input);
      return {
        run: { id: `run-${created.length}` },
      } as unknown as CreateRunResult;
    },
    kickTick: async (runId) => {
      kickedRunIds.push(runId);
    },
    executableProviders: ['api'],
    ...overrides,
  };
  return { deps, created, fetchedJobIds, kickedRunIds };
}

describe('runScheduledRefresh', () => {
  it('clones the template into a scheduled new_or_changed run and kicks it', async () => {
    const { runScheduledRefresh } = await import('../src/lib/refresh');
    const harness = fakeDeps([template()]);

    const outcome = await runScheduledRefresh(harness.deps);

    assert.deepEqual(outcome, {
      started: 1,
      skippedActive: 0,
      skippedClosed: 0,
      skippedProvider: 0,
      failed: 0,
    });
    assert.equal(harness.created.length, 1);
    const input = harness.created[0];
    assert.equal(input.jobId, 101);
    assert.equal(input.mode, 'new_or_changed');
    assert.equal(input.trigger, 'scheduled');
    assert.equal(input.provider, 'api');
    assert.equal(input.rubricVersion, 'rubric-1');
    assert.equal(input.calibrationVersion, 'cal-1');
    assert.equal(input.jobTitle, 'Fresh title');
    assert.deepEqual(harness.kickedRunIds, ['run-1']);
  });

  it('always uses new_or_changed even when nothing overrides the template mode', async () => {
    // The template row carries no mode at all: a manual retry_failed_only run
    // contributes its rubric, never its candidate filter. This locks the type
    // contract — if a mode field is ever added to templates and threaded
    // through, this test forces the decision to be explicit.
    const { runScheduledRefresh } = await import('../src/lib/refresh');
    const harness = fakeDeps([
      template({ jobId: 7, rubricVersion: 'rubric-7', calibrationVersion: null }),
    ]);

    await runScheduledRefresh(harness.deps);

    assert.equal(harness.created[0].mode, 'new_or_changed');
    assert.equal(harness.created[0].calibrationVersion, null);
  });

  it('skips a job whose req is closed in Greenhouse', async () => {
    const { runScheduledRefresh } = await import('../src/lib/refresh');
    const harness = fakeDeps([template()], {
      fetchJob: async () => ({ status: 'closed', name: 'Closed req' }),
    });

    const outcome = await runScheduledRefresh(harness.deps);

    assert.equal(outcome.skippedClosed, 1);
    assert.equal(outcome.started, 0);
    assert.equal(harness.created.length, 0);
  });

  it('skips a job that already has an active run', async () => {
    const { runScheduledRefresh } = await import('../src/lib/refresh');
    const { RunAlreadyInProgressError } = await import('../src/lib/run-store');
    const harness = fakeDeps([template()], {
      create: async () => {
        throw new RunAlreadyInProgressError();
      },
    });

    const outcome = await runScheduledRefresh(harness.deps);

    assert.equal(outcome.skippedActive, 1);
    assert.equal(outcome.started, 0);
    assert.equal(harness.kickedRunIds.length, 0);
  });

  it('skips non-executable providers without querying Greenhouse', async () => {
    const { runScheduledRefresh } = await import('../src/lib/refresh');
    const harness = fakeDeps([template({ provider: 'codex-agent' })]);

    const outcome = await runScheduledRefresh(harness.deps);

    assert.equal(outcome.skippedProvider, 1);
    assert.equal(harness.fetchedJobIds.length, 0);
    assert.equal(harness.created.length, 0);
  });

  it('counts a Greenhouse failure and continues with the remaining jobs', async () => {
    const { runScheduledRefresh } = await import('../src/lib/refresh');
    const harness = fakeDeps([
      template({ jobId: 1 }),
      template({ jobId: 2, rubricVersion: 'rubric-2' }),
    ]);
    const upstreamFetch = harness.deps.fetchJob;
    harness.deps.fetchJob = async (jobId) => {
      if (jobId === 1) throw new Error('Greenhouse 500');
      return upstreamFetch(jobId);
    };

    const outcome = await runScheduledRefresh(harness.deps);

    assert.equal(outcome.failed, 1);
    assert.equal(outcome.started, 1);
    assert.equal(harness.created[0].jobId, 2);
  });

  it('leaves a run counted as started when its initial kick fails', async () => {
    const { runScheduledRefresh } = await import('../src/lib/refresh');
    const harness = fakeDeps([template()], {
      kickTick: async () => {
        throw new Error('tick request failed');
      },
    });

    const outcome = await runScheduledRefresh(harness.deps);

    assert.equal(outcome.started, 1);
    assert.equal(outcome.failed, 0);
  });
});

describe('refresh cron route', () => {
  it('rejects unauthenticated requests', async () => {
    const previousSecret = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      const { GET } = await import('../src/app/api/cron/refresh/route');
      const response = await GET(
        new NextRequest('http://localhost:3000/api/cron/refresh')
      );
      assert.equal(response.status, 401);
    } finally {
      if (previousSecret !== undefined) process.env.CRON_SECRET = previousSecret;
    }
  });
});

test('getRefreshableJobTemplates picks the newest completed manual run per job', async (t) => {
  if (!HAS_REAL_DB) {
    t.skip('DATABASE_URL is unset');
    return;
  }

  const store = await import('../src/lib/run-store');
  const { query } = await import('../src/lib/db');

  const jobA = Date.now();
  const jobB = jobA + 1;
  const jobC = jobA + 2;
  const versionA1 = `refresh-test-${randomUUID()}`;
  const versionA2 = `refresh-test-${randomUUID()}`;
  const versionB = `refresh-test-${randomUUID()}`;
  const versionC = `refresh-test-${randomUUID()}`;
  const runIds: string[] = [];
  const rubricVersions = [versionA1, versionA2, versionB, versionC];

  async function makeRun(input: {
    jobId: number;
    rubricVersion: string;
    trigger?: 'manual' | 'scheduled';
    complete?: boolean;
  }): Promise<string> {
    const { run } = await store.createRun({
      jobId: input.jobId,
      jobTitle: `Job ${input.jobId}`,
      mode: 'new_or_changed',
      rubricVersion: input.rubricVersion,
      calibrationVersion: null,
      rubric,
      idealPatterns: null,
      trigger: input.trigger,
    });
    runIds.push(run.id);
    if (input.complete !== false) {
      assert.ok(await store.setRunStatus(run.id, 'completed'));
    }
    return run.id;
  }

  try {
    // Job A: two completed manual runs, then a newer completed scheduled run.
    // The template must be the second manual run — a scheduled run must never
    // become its own successor's template.
    await makeRun({ jobId: jobA, rubricVersion: versionA1 });
    await makeRun({ jobId: jobA, rubricVersion: versionA2 });
    const scheduledId = await makeRun({
      jobId: jobA,
      rubricVersion: versionA2,
      trigger: 'scheduled',
    });

    // Job B: only a completed scheduled run — not refreshable.
    await makeRun({ jobId: jobB, rubricVersion: versionB, trigger: 'scheduled' });

    // Job C: a manual run that never completed — not refreshable.
    await makeRun({ jobId: jobC, rubricVersion: versionC, complete: false });

    const templates = await store.getRefreshableJobTemplates();
    const byJob = new Map(templates.map((row) => [row.jobId, row]));

    const templateA = byJob.get(jobA);
    assert.ok(templateA, 'job A should be refreshable');
    assert.equal(templateA.rubricVersion, versionA2);
    assert.equal(templateA.provider, 'api');
    assert.deepEqual(templateA.rubric, rubric);
    assert.equal(byJob.has(jobB), false, 'scheduled-only jobs are not refreshable');
    assert.equal(byJob.has(jobC), false, 'incomplete runs are not templates');

    // The trigger column round-trips through createRun.
    const triggers = await query<{ id: string; trigger: string }>(
      'select id, trigger from rosie_runs where id = any($1::uuid[])',
      [runIds]
    );
    const triggerById = new Map(triggers.rows.map((row) => [row.id, row.trigger]));
    assert.equal(triggerById.get(scheduledId), 'scheduled');
    assert.equal(triggerById.get(runIds[0]), 'manual');
  } finally {
    await query('delete from rosie_runs where id = any($1::uuid[])', [runIds]);
    await query('delete from rosie_rubrics where rubric_version = any($1::text[])', [
      rubricVersions,
    ]);
  }
});
