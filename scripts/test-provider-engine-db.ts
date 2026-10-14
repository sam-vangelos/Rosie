import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import type { ScoringRubric } from '../src/lib/types';
import type { ScreeningProvider } from '../src/lib/providers/types';

if (!process.env.DATABASE_URL) {
  try {
    loadEnvFile('.env.local');
  } catch {
    // The suite skips below when no local database is configured.
  }
}

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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('provider engine database scenarios', async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip('DATABASE_URL is unset');
    return;
  }

  const store = await import('../src/lib/run-store');
  const { pool, query } = await import('../src/lib/db');
  const { runTick } = await import('../src/lib/screening-engine');
  const { makeScoreVersionKey, makeTriageVersionKey } = await import('../src/lib/cache');
  const runIds: string[] = [];
  const rubricVersions: string[] = [];
  const artifactKeys: string[] = [];
  const cacheKeys: string[] = [];

  async function seedRun(label: string, stage: 'triage' | 'score') {
    const rubricVersion = `${label}-${randomUUID()}`;
    rubricVersions.push(rubricVersion);
    const { run } = await store.createRun({
      jobId: Date.now() * 1000 + Math.floor(Math.random() * 1000),
      jobTitle: 'Provider Engine Role',
      mode: 'all',
      provider: 'api',
      rubricVersion,
      calibrationVersion: null,
      rubric,
      idealPatterns: null,
    });
    runIds.push(run.id);
    await query(
      `update rosie_runs set stage = $2, status = $3 where id = $1`,
      [run.id, stage, stage === 'triage' ? 'triaging' : 'full_scoring']
    );
    return { run, rubricVersion };
  }

  async function seedCandidates(
    runId: string,
    rubricVersion: string,
    count: number,
    step: 'pending_triage' | 'pending_score'
  ) {
    const ids = Array.from({ length: count }, (_, index) => String(7000 + index));
    await store.insertPendingCandidates(
      runId,
      ids.map((id) => ({
        candidateId: id,
        candidateName: `Candidate ${id}`,
        metadata: {
          id: Number(id),
          greenhouseUrl: `https://app.greenhouse.io/people/${id}`,
          name: `Candidate ${id}`,
          email: `${id}@example.com`,
          company: 'ExampleCo',
          title: 'Engineer',
          updatedAt: '2026-07-16T00:00:00.000Z',
          applicationStatus: 'active',
          currentStage: 'Application Review',
          appliedAt: '2026-07-01T00:00:00.000Z',
          source: 'Test',
          resumeFilename: `${id}.txt`,
          resumeAttachmentUrl: `https://example.com/${id}.txt`,
          resumeAttachmentCreatedAt: '2026-07-01T00:00:00.000Z',
        },
      }))
    );

    const keys = ids.map((id) => `provider-engine-${rubricVersion}-${id}`);
    const fingerprints = ids.map((id) => `provider-fingerprint-${rubricVersion}-${id}`);
    artifactKeys.push(...keys);
    await query(
      `insert into rosie_resume_artifacts (
         artifact_key, resume_fingerprint, resume_filename, resume_mime_type,
         resume_text, parse_quality, byte_size
       ) select * from unnest(
         $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::integer[]
       )`,
      [
        keys,
        fingerprints,
        ids.map((id) => `${id}.txt`),
        ids.map(() => 'text/plain'),
        ids.map(() => 'A'.repeat(1500)),
        ids.map(() => 'good'),
        ids.map(() => 1500),
      ]
    );
    await query(
      `update rosie_run_candidates c
       set step = $5, artifact_key = x.artifact_key,
         resume_fingerprint = x.fingerprint, parse_quality = 'good'
       from unnest($2::text[], $3::text[], $4::text[])
         x(candidate_id, artifact_key, fingerprint)
       where c.run_id = $1 and c.candidate_id = x.candidate_id`,
      [runId, ids, keys, fingerprints, step]
    );
    return { ids, fingerprints };
  }

  try {
    await t.test('non-batch provider keeps 40 fresh candidates on the synchronous path', async () => {
      const { run, rubricVersion } = await seedRun('provider-sync', 'triage');
      const { fingerprints } = await seedCandidates(
        run.id,
        rubricVersion,
        40,
        'pending_triage'
      );
      let triageCalls = 0;
      let scoreCalls = 0;
      let batchCalls = 0;
      const provider: ScreeningProvider = {
        name: 'claude-agent',
        supportsBatch: false,
        supportsPdf: false,
        models: { triage: 'fixture-triage', full: 'fixture-full' },
        async triage() {
          triageCalls += 1;
          return {
            bucket: 'top_signal',
            confidence: 0.9,
            needsFullScore: true,
            rationale: 'Fixture top signal',
            currentRole: 'Engineer',
            currentCompany: 'ExampleCo',
          };
        },
        async score() {
          scoreCalls += 1;
          return {
            criterionScores: [
              { criterionId: 'systems', score: 8, evidence: 'Built systems' },
            ],
            strengths: ['Systems'],
            gaps: [],
            currentRole: 'Engineer',
            currentCompany: 'ExampleCo',
            usage: {} as never,
          };
        },
        async requestJSON<T>(): Promise<T> {
          throw new Error('Unexpected requestJSON call');
        },
      };
      for (const fingerprint of fingerprints) {
        cacheKeys.push(
          makeTriageVersionKey({
            resumeFingerprint: fingerprint,
            rubricVersion,
            calibrationVersion: null,
            model: provider.models.triage,
            provider: provider.name,
          }),
          makeScoreVersionKey({
            resumeFingerprint: fingerprint,
            rubricVersion,
            calibrationVersion: null,
            model: provider.models.full,
            inputMode: 'text',
            provider: provider.name,
          })
        );
      }
      const batchClient = {
        async create() {
          batchCalls += 1;
          throw new Error('batch create must not run');
        },
        async retrieve() {
          batchCalls += 1;
          throw new Error('batch retrieve must not run');
        },
        async results() {
          batchCalls += 1;
          throw new Error('batch results must not run');
        },
        async cancel() {
          batchCalls += 1;
        },
      };

      const ownerToken = randomUUID();
      assert.equal(await store.claimRunLease(run.id, ownerToken), true);
      assert.equal(
        await runTick(run.id, ownerToken, {
          provider,
          triage: provider.triage,
          score: provider.score,
          batchClient,
          auditSampleRate: 0,
          triageEnabled: true,
          budgetMs: 60_000,
        }),
        'done'
      );
      assert.equal(triageCalls, 40);
      assert.equal(scoreCalls, 40);
      assert.equal(batchCalls, 0);
    });

    await t.test('in-flight scoring keepalive prevents lease reclamation', async () => {
      const { run, rubricVersion } = await seedRun('provider-keepalive', 'score');
      const { fingerprints } = await seedCandidates(
        run.id,
        rubricVersion,
        1,
        'pending_score'
      );
      const scoreStarted = deferred();
      const finishScore = deferred();
      const provider: ScreeningProvider = {
        name: 'claude-agent',
        supportsBatch: false,
        supportsPdf: false,
        models: { triage: 'fixture-triage', full: 'fixture-full' },
        async triage() {
          throw new Error('triage must not run');
        },
        async score() {
          scoreStarted.resolve();
          await finishScore.promise;
          return {
            criterionScores: [
              { criterionId: 'systems', score: 8, evidence: 'Built systems' },
            ],
            strengths: ['Systems'],
            gaps: [],
            currentRole: 'Engineer',
            currentCompany: 'ExampleCo',
            usage: {} as never,
          };
        },
        async requestJSON<T>(): Promise<T> {
          throw new Error('Unexpected requestJSON call');
        },
      };
      cacheKeys.push(
        makeScoreVersionKey({
          resumeFingerprint: fingerprints[0],
          rubricVersion,
          calibrationVersion: null,
          model: provider.models.full,
          inputMode: 'text',
          provider: provider.name,
        })
      );

      const ownerToken = randomUUID();
      const contenderToken = randomUUID();
      assert.equal(
        await store.claimRunLease(run.id, ownerToken, 1, ['api']),
        true
      );

      const originalSetInterval = globalThis.setInterval;
      const originalDateNow = Date.now;
      globalThis.setInterval = ((callback: () => void) =>
        originalSetInterval(callback, 25)) as typeof setInterval;
      const ticking = runTick(run.id, ownerToken, {
        provider,
        score: provider.score,
        budgetMs: 60_000,
      });

      try {
        await scoreStarted.promise;
        await query(
          `update rosie_runs
           set leased_until = now() + interval '2 seconds'
           where id = $1 and owner_token = $2`,
          [run.id, ownerToken]
        );
        Date.now = () => originalDateNow() + 30_000;
        await new Promise((resolve) => setTimeout(resolve, 2500));

        const lease = await query<{ held: boolean; owner_token: string | null }>(
          `select leased_until > now() as held, owner_token
           from rosie_runs where id = $1`,
          [run.id]
        );
        assert.deepEqual(lease.rows[0], { held: true, owner_token: ownerToken });
        assert.equal(
          await store.claimRunLease(run.id, contenderToken, 360, ['api']),
          false
        );
      } finally {
        Date.now = originalDateNow;
        globalThis.setInterval = originalSetInterval;
        finishScore.resolve();
      }

      assert.equal(await ticking, 'done');
    });
  } finally {
    if (runIds.length) {
      await query('delete from rosie_runs where id = any($1::uuid[])', [runIds]);
    }
    if (rubricVersions.length) {
      await query(
        'delete from rosie_rubrics where rubric_version = any($1::text[])',
        [rubricVersions]
      );
    }
    if (artifactKeys.length) {
      await query(
        'delete from rosie_resume_artifacts where artifact_key = any($1::text[])',
        [artifactKeys]
      );
    }
    if (cacheKeys.length) {
      await query(
        'delete from rosie_result_cache where cache_key = any($1::text[])',
        [cacheKeys]
      );
    }
    await pool.end();
  }
});
