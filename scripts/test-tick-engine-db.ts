import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { loadEnvFile } from 'node:process';
import type { ScoringRubric } from '../src/lib/types';
import type { ScoringResult } from '../src/lib/anthropic';
import type { GreenhouseCandidateMetadata } from '../src/lib/greenhouse-candidates';
import type { TickDeps } from '../src/lib/screening-engine';

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

const names = new Map<number, string>([
  [1001, 'Likely High'],
  [1002, 'Likely Low'],
  [1003, 'Top Signal'],
  [1004, 'Borderline'],
  [1005, 'Cached'],
  [1006, 'Poor Parse'],
  [1007, 'No Resume'],
  [1008, 'Likely Lowest'],
]);

function metadata(id: number): GreenhouseCandidateMetadata {
  return {
    id,
    greenhouseUrl: `https://app.greenhouse.io/people/${id}`,
    name: names.get(id)!,
    email: `${id}@example.com`,
    company: 'ExampleCo',
    title: 'Engineer',
    updatedAt: '2026-07-16T00:00:00.000Z',
    applicationStatus: 'active',
    currentStage: 'Application Review',
    appliedAt: '2026-07-01T00:00:00.000Z',
    source: 'Test',
    resumeFilename: id === 1007 ? null : `${id}.txt`,
    resumeAttachmentUrl: id === 1007 ? null : `https://example.com/${id}.txt`,
    resumeAttachmentCreatedAt: id === 1007 ? null : '2026-07-01T00:00:00.000Z',
  };
}

function customMetadata(
  id: number,
  name: string,
  email: string,
  extension = 'txt'
): GreenhouseCandidateMetadata {
  return {
    ...metadata(1001),
    id,
    greenhouseUrl: `https://app.greenhouse.io/people/${id}`,
    name,
    email,
    resumeFilename: `${id}.${extension}`,
    resumeAttachmentUrl: `https://example.com/${id}.${extension}`,
  };
}

function scoringResult(score: number): ScoringResult {
  return {
    criterionScores: [{ criterionId: 'systems', score, evidence: 'Built systems' }],
    strengths: ['Systems'],
    gaps: [],
    currentRole: 'Engineer',
    currentCompany: 'ExampleCo',
  };
}

test('tick engine database scenarios', async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip('DATABASE_URL is unset');
    return;
  }

  const store = await import('../src/lib/run-store');
  const { pool, query } = await import('../src/lib/db');
  const { runTick } = await import('../src/lib/screening-engine');
  const {
    makeResumeArtifactKey,
    makeScoreVersionKey,
    makeTriageVersionKey,
    setCachedJson,
  } = await import('../src/lib/cache');
  const { ANTHROPIC_FULL_SCORE_MODEL, ANTHROPIC_TRIAGE_MODEL } = await import('../src/lib/anthropic');
  const runIds: string[] = [];
  const rubricVersions: string[] = [];
  const artifactKeys: string[] = [];
  const cacheKeys: string[] = [];

  async function seedRun(label: string) {
    const rubricVersion = `${label}-${randomUUID()}`;
    rubricVersions.push(rubricVersion);
    const { run } = await store.createRun({
      jobId: Date.now(),
      jobTitle: 'Tick Test Role',
      mode: 'all',
      rubricVersion,
      calibrationVersion: null,
      rubric,
      idealPatterns: null,
    });
    runIds.push(run.id);
    return { run, rubricVersion };
  }

  function makeDeps(rubricVersion: string, scoreCalls: Map<string, number>): Partial<TickDeps> {
    const candidates = [...names.keys()].map(metadata);
    return {
      listCandidates: async () => ({ targetStage: 'application review', candidates }),
      downloadResume: async (item) => {
        const key = makeResumeArtifactKey({
          candidateId: item.id,
          updatedAt: item.updatedAt,
          attachmentUrl: item.resumeAttachmentUrl,
          attachmentCreatedAt: item.resumeAttachmentCreatedAt,
        });
        artifactKeys.push(key);
        const resumeText = item.id === 1007 ? null : item.id === 1006 ? 'short' : 'A'.repeat(1500);
        return {
          id: String(item.id),
          greenhouseId: item.id,
          greenhouseUrl: item.greenhouseUrl,
          name: item.name,
          email: item.email,
          company: item.company,
          title: item.title,
          updatedAt: item.updatedAt,
          applicationStatus: item.applicationStatus,
          currentStage: item.currentStage,
          appliedAt: item.appliedAt,
          source: item.source,
          resumeFilename: item.resumeFilename,
          resumeAttachmentUrl: item.resumeAttachmentUrl,
          resumeAttachmentCreatedAt: item.resumeAttachmentCreatedAt,
          resumeMimeType: resumeText ? 'text/plain' : null,
          resumeBase64: null,
          resumeText,
          resumeFingerprint: resumeText ? `${rubricVersion}-${item.id}` : null,
          parseQuality: item.id === 1007 ? 'missing' : item.id === 1006 ? 'poor' : 'good',
          resumeCacheKey: key,
          resumeFailure: null,
          hasBlob: false,
        };
      },
      triage: async ({ candidateName }) => ({
        bucket: candidateName.startsWith('Likely') ? 'likely_no' : candidateName === 'Top Signal' ? 'top_signal' : 'borderline',
        confidence: candidateName.startsWith('Likely') ? 0.96 : 0.7,
        needsFullScore: !candidateName.startsWith('Likely'),
        rationale: 'Fixture triage',
        currentRole: 'Engineer',
        currentCompany: 'ExampleCo',
      }),
      score: async ({ candidateName }) => {
        const id = [...names].find(([, name]) => name === candidateName)![0];
        scoreCalls.set(String(id), (scoreCalls.get(String(id)) || 0) + 1);
        const scores: Record<number, number> = {
          1001: 8.5,
          1002: 6,
          1003: 9,
          1004: 7.5,
          1006: 7,
          1008: 5,
        };
        return {
          criterionScores: [{ criterionId: 'systems', score: scores[id], evidence: 'Built systems' }],
          strengths: ['Systems'],
          gaps: [],
          currentRole: 'Engineer',
          currentCompany: 'ExampleCo',
          usage: {} as never,
        };
      },
    };
  }

  async function seedCachedCandidate(rubricVersion: string) {
    const key = makeScoreVersionKey({
      resumeFingerprint: `${rubricVersion}-1005`,
      rubricVersion,
      calibrationVersion: null,
      model: ANTHROPIC_FULL_SCORE_MODEL,
      inputMode: 'text',
    });
    cacheKeys.push(key);
    await setCachedJson('score-results', key, scoringResult(9.6));
  }

  function rememberFixtureCacheKeys(rubricVersion: string) {
    for (const id of names.keys()) {
      cacheKeys.push(makeScoreVersionKey({
        resumeFingerprint: `${rubricVersion}-${id}`,
        rubricVersion,
        calibrationVersion: null,
        model: ANTHROPIC_FULL_SCORE_MODEL,
        inputMode: 'text',
      }));
      cacheKeys.push(makeTriageVersionKey({
        resumeFingerprint: `${rubricVersion}-${id}`,
        rubricVersion,
        calibrationVersion: null,
        model: ANTHROPIC_TRIAGE_MODEL,
      }));
    }
  }

  async function runToCompletion(
    runId: string,
    deps: Partial<TickDeps>
  ): Promise<'done'> {
    for (let tick = 0; tick < 50; tick++) {
      const token = randomUUID();
      assert.equal(await store.claimRunLease(runId, token), true);
      const outcome = await runTick(runId, token, deps);
      if (outcome === 'done') return outcome;
      assert.equal(outcome, 'chain');
      await store.releaseRunLease(runId, token);
    }
    assert.fail('run did not complete within 50 ticks');
  }

  function project(summary: NonNullable<Awaited<ReturnType<typeof store.getRunSummary>>>) {
    return {
      status: summary.status,
      counts: summary.counts,
      audit: summary.audit,
      failures: summary.failures,
      fullyScored: summary.fullyScored.map((candidate) => ({
        id: candidate.id,
        score: candidate.overallScore,
      })),
      likelyNo: summary.likelyNo,
    };
  }

  try {
    await t.test('lease semantics', async () => {
      const { run } = await seedRun('lease');
      const first = randomUUID();
      const second = randomUUID();
      assert.equal(await store.claimRunLease(run.id, first), true);
      assert.equal(await store.claimRunLease(run.id, second), false);
      assert.equal(await store.claimRunLease(run.id, first), true);
      assert.deepStrictEqual(await store.heartbeatRun(run.id, first), { cancelRequested: false });
      await query('update rosie_runs set leased_until = now() - interval \'1 second\' where id = $1', [run.id]);
      assert.equal(await store.claimRunLease(run.id, second), true);
      assert.equal(await store.heartbeatRun(run.id, first), null);
      await store.releaseRunLease(run.id, second);
      const third = randomUUID();
      assert.equal(await store.claimRunLease(run.id, third), true);
      await store.releaseRunLease(run.id, third);
      const fourth = randomUUID();
      assert.equal(await store.claimRunLease(run.id, fourth), true);
      await store.requestRunCancel(run.id);
      assert.deepStrictEqual(await store.heartbeatRun(run.id, fourth), { cancelRequested: true });
    });

    let expectedProjection: ReturnType<typeof project>;
    await t.test('full simulated run preserves sequential semantics', async () => {
      const { run, rubricVersion } = await seedRun('full');
      rememberFixtureCacheKeys(rubricVersion);
      await seedCachedCandidate(rubricVersion);
      const scoreCalls = new Map<string, number>();
      const token = randomUUID();
      assert.equal(await store.claimRunLease(run.id, token), true);
      assert.equal(
        await runTick(run.id, token, { ...makeDeps(rubricVersion, scoreCalls), budgetMs: 60_000 }),
        'done'
      );
      const summary = await store.getRunSummary(run.id);
      assert(summary);
      expectedProjection = project(summary);
      assert.deepStrictEqual(summary.counts, {
        total: 8,
        processed: 8,
        triagedLikelyNo: 0,
        escalated: 3,
        fullyScored: 7,
        failed: 1,
        audited: 3,
        cached: 1,
      });
      assert.deepStrictEqual(summary.audit, {
        sampled: 3,
        disagreements: 1,
        strongSignalsFound: 1,
        escalatedLikelyNoBucket: true,
        details: [
          {
            candidateId: '1001',
            triageBucket: 'likely_no',
            triageConfidence: 0.96,
            overallScore: 8.5,
            disagreement: true,
          },
          {
            candidateId: '1002',
            triageBucket: 'likely_no',
            triageConfidence: 0.96,
            overallScore: 6,
            disagreement: false,
          },
          {
            candidateId: '1008',
            triageBucket: 'likely_no',
            triageConfidence: 0.96,
            overallScore: 5,
            disagreement: false,
          },
        ],
      });
      assert.deepStrictEqual(
        summary.fullyScored.map((candidate) => candidate.id),
        ['1005', '1003', '1001', '1004', '1006', '1002', '1008']
      );
      assert.deepStrictEqual(summary.failures, [{
        candidateId: '1007',
        candidateName: 'No Resume',
        message: 'No resume available',
      }]);
      assert.deepStrictEqual([...scoreCalls.values()].sort(), [1, 1, 1, 1, 1, 1]);
    });

    await t.test('triage-disabled rollout full-scores the viable pool without auditing', async () => {
      const { run, rubricVersion } = await seedRun('triage-disabled');
      rememberFixtureCacheKeys(rubricVersion);
      await seedCachedCandidate(rubricVersion);
      const scoreCalls = new Map<string, number>();
      const deps = makeDeps(rubricVersion, scoreCalls);
      deps.triage = async () => assert.fail('triage must not run when disabled');
      await runToCompletion(run.id, {
        ...deps,
        triageEnabled: false,
        budgetMs: 60_000,
      });

      const summary = await store.getRunSummary(run.id);
      assert(summary);
      assert.deepStrictEqual(summary.counts, {
        total: 8,
        processed: 8,
        triagedLikelyNo: 0,
        escalated: 0,
        fullyScored: 7,
        failed: 1,
        audited: 0,
        cached: 1,
      });
      assert.deepStrictEqual(summary.audit, {
        sampled: 0,
        disagreements: 0,
        strongSignalsFound: 0,
        escalatedLikelyNoBucket: false,
      });
      const decisions = await query<{ triage_decision: { bucket: string; rationale: string } }>(
        `select triage_decision from rosie_run_candidates
         where run_id = $1 and full_score is not null`,
        [run.id]
      );
      assert.equal(decisions.rows.length, 7);
      assert.equal(decisions.rows.every(({ triage_decision }) =>
        triage_decision.bucket === 'borderline' && triage_decision.rationale === 'Triage disabled'
      ), true);
      assert.deepStrictEqual([...scoreCalls.values()].sort(), [1, 1, 1, 1, 1, 1]);
    });

    await t.test('zero audit sample rate leaves the likely-no bucket standing', async () => {
      const { run, rubricVersion } = await seedRun('audit-disabled');
      rememberFixtureCacheKeys(rubricVersion);
      await seedCachedCandidate(rubricVersion);
      const scoreCalls = new Map<string, number>();
      await runToCompletion(run.id, {
        ...makeDeps(rubricVersion, scoreCalls),
        auditSampleRate: 0,
        budgetMs: 60_000,
      });

      const summary = await store.getRunSummary(run.id);
      assert(summary);
      assert.deepStrictEqual(summary.counts, {
        total: 8,
        processed: 8,
        triagedLikelyNo: 3,
        escalated: 3,
        fullyScored: 4,
        failed: 1,
        audited: 0,
        cached: 1,
      });
      assert.deepStrictEqual(summary.audit, {
        sampled: 0,
        disagreements: 0,
        strongSignalsFound: 0,
        escalatedLikelyNoBucket: false,
      });
      assert.deepStrictEqual(summary.likelyNo.map((candidate) => candidate.candidateId).sort(), [
        '1001',
        '1002',
        '1008',
      ]);
      assert.equal(scoreCalls.has('1001'), false);
      assert.equal(scoreCalls.has('1002'), false);
      assert.equal(scoreCalls.has('1008'), false);
    });

    await t.test('runTick passes the configured non-zero audit sample rate', async () => {
      const { run, rubricVersion } = await seedRun('audit-rate');
      const candidates = Array.from({ length: 20 }, (_, index) => {
        const id = 2100 + index;
        const fingerprint = `audit-rate-${rubricVersion}-${id}`;
        cacheKeys.push(
          makeTriageVersionKey({
            resumeFingerprint: fingerprint,
            rubricVersion,
            calibrationVersion: null,
            model: ANTHROPIC_TRIAGE_MODEL,
          }),
          makeScoreVersionKey({
            resumeFingerprint: fingerprint,
            rubricVersion,
            calibrationVersion: null,
            model: ANTHROPIC_FULL_SCORE_MODEL,
            inputMode: 'text',
          })
        );
        return customMetadata(id, `Audit ${id}`, `${id}@example.com`);
      });
      await runToCompletion(run.id, {
        listCandidates: async () => ({ targetStage: 'application review', candidates }),
        downloadResume: async (item) => {
          const artifactKey = `audit-rate-${rubricVersion}-${item.id}`;
          artifactKeys.push(artifactKey);
          return {
            ...item,
            id: String(item.id),
            greenhouseId: item.id,
            resumeMimeType: 'text/plain',
            resumeBase64: null,
            resumeText: 'A'.repeat(1500),
            resumeFingerprint: artifactKey,
            parseQuality: 'good' as const,
            resumeCacheKey: artifactKey,
            resumeFailure: null,
            hasBlob: false,
          };
        },
        triage: async () => ({
          bucket: 'likely_no' as const,
          confidence: 0.99,
          needsFullScore: false,
          rationale: 'Fixture likely no',
          currentRole: 'Engineer',
          currentCompany: 'ExampleCo',
        }),
        score: async () => ({
          ...scoringResult(5),
          usage: {} as never,
        }),
        auditSampleRate: 0.5,
        budgetMs: 60_000,
      });
      const summary = await store.getRunSummary(run.id);
      assert.equal(summary?.audit.sampled, 10);
      assert.equal(summary?.counts.audited, 10);
      assert.equal(summary?.likelyNo.length, 10);
    });

    await t.test('score cache hits rebuild each candidate with current identity', async () => {
      const { run, rubricVersion } = await seedRun('cache-identity');
      const candidates = [
        customMetadata(2001, 'First Identity', 'first@example.com'),
        customMetadata(2002, 'Second Identity', 'second@example.com'),
      ];
      const fingerprint = `shared-${rubricVersion}`;
      const key = makeScoreVersionKey({
        resumeFingerprint: fingerprint,
        rubricVersion,
        calibrationVersion: null,
        model: ANTHROPIC_FULL_SCORE_MODEL,
        inputMode: 'text',
      });
      cacheKeys.push(key);
      await setCachedJson('score-results', key, scoringResult(8.8));

      await runToCompletion(run.id, {
        listCandidates: async () => ({ targetStage: 'application review', candidates }),
        downloadResume: async (item) => {
          const artifactKey = `cache-identity-${rubricVersion}-${item.id}`;
          artifactKeys.push(artifactKey);
          return {
            ...item,
            id: String(item.id),
            greenhouseId: item.id,
            resumeMimeType: 'text/plain',
            resumeBase64: null,
            resumeText: 'A'.repeat(1500),
            resumeFingerprint: fingerprint,
            parseQuality: 'good' as const,
            resumeCacheKey: artifactKey,
            resumeFailure: null,
            hasBlob: false,
          };
        },
        triage: async () => assert.fail('score cache should bypass triage'),
        score: async () => assert.fail('score cache should bypass scoring'),
        budgetMs: 60_000,
      });

      const stored = await query<{
        candidate_id: string;
        cache_hit: boolean;
        full_score: { name: string; email: string };
      }>(
        `select candidate_id, cache_hit, full_score from rosie_run_candidates
         where run_id = $1 order by candidate_id`,
        [run.id]
      );
      assert.deepStrictEqual(
        stored.rows.map((row) => ({
          candidateId: row.candidate_id,
          cacheHit: row.cache_hit,
          name: row.full_score.name,
          email: row.full_score.email,
        })),
        [
          {
            candidateId: '2001',
            cacheHit: true,
            name: 'First Identity',
            email: 'first@example.com',
          },
          {
            candidateId: '2002',
            cacheHit: true,
            name: 'Second Identity',
            email: 'second@example.com',
          },
        ]
      );
      const payload = (await query<{ payload: Record<string, unknown> }>(
        `select payload from rosie_result_cache
         where namespace = 'score-results' and cache_key = $1`,
        [key]
      )).rows[0].payload;
      assert.equal('name' in payload, false);
      assert.equal('email' in payload, false);
      assert.equal('greenhouseId' in payload, false);
    });

    await t.test('triage failures stop after two attempts and the run completes', async () => {
      const { run, rubricVersion } = await seedRun('triage-failure');
      const candidate = customMetadata(3001, 'Poisoned Triage', 'triage@example.com');
      let triageCalls = 0;
      await runToCompletion(run.id, {
        listCandidates: async () => ({ targetStage: 'application review', candidates: [candidate] }),
        downloadResume: async (item) => {
          const artifactKey = `triage-failure-${rubricVersion}`;
          artifactKeys.push(artifactKey);
          return {
            ...item,
            id: String(item.id),
            greenhouseId: item.id,
            resumeMimeType: 'text/plain',
            resumeBase64: null,
            resumeText: 'A'.repeat(1500),
            resumeFingerprint: artifactKey,
            parseQuality: 'good' as const,
            resumeCacheKey: artifactKey,
            resumeFailure: null,
            hasBlob: false,
          };
        },
        triage: async () => {
          triageCalls++;
          throw new Error('poisoned triage fixture');
        },
        score: async () => assert.fail('failed triage candidate must not score'),
        budgetMs: 60_000,
      });
      const failed = (await query<{ step: string; attempt_count: number; failure: string }>(
        `select step, attempt_count, failure from rosie_run_candidates
         where run_id = $1 and candidate_id = '3001'`,
        [run.id]
      )).rows[0];
      assert.deepStrictEqual(failed, {
        step: 'failed',
        attempt_count: 2,
        failure: 'poisoned triage fixture',
      });
      assert.equal(triageCalls, 2);
      assert.equal((await store.getRunSummary(run.id))?.status, 'completed');
    });

    await t.test('score failures use the same two-attempt limit', async () => {
      const { run, rubricVersion } = await seedRun('score-failure');
      const candidate = customMetadata(3003, 'Poisoned Score', 'score@example.com');
      let scoreCalls = 0;
      await runToCompletion(run.id, {
        listCandidates: async () => ({ targetStage: 'application review', candidates: [candidate] }),
        downloadResume: async (item) => {
          const artifactKey = `score-failure-${rubricVersion}`;
          artifactKeys.push(artifactKey);
          return {
            ...item,
            id: String(item.id),
            greenhouseId: item.id,
            resumeMimeType: 'text/plain',
            resumeBase64: null,
            resumeText: 'A'.repeat(1500),
            resumeFingerprint: artifactKey,
            parseQuality: 'good' as const,
            resumeCacheKey: artifactKey,
            resumeFailure: null,
            hasBlob: false,
          };
        },
        triageEnabled: false,
        score: async () => {
          scoreCalls++;
          throw new Error('poisoned score fixture');
        },
        budgetMs: 60_000,
      });
      const failed = (await query<{ step: string; attempt_count: number; failure: string }>(
        `select step, attempt_count, failure from rosie_run_candidates
         where run_id = $1 and candidate_id = '3003'`,
        [run.id]
      )).rows[0];
      assert.deepStrictEqual(failed, {
        step: 'failed',
        attempt_count: 2,
        failure: 'poisoned score fixture',
      });
      assert.equal(scoreCalls, 2);
    });

    await t.test('non-PDF bytes without extracted text fail in artifacts', async () => {
      const { run, rubricVersion } = await seedRun('docx-extraction');
      const candidate = customMetadata(3002, 'Broken DOCX', 'docx@example.com', 'docx');
      await runToCompletion(run.id, {
        listCandidates: async () => ({ targetStage: 'application review', candidates: [candidate] }),
        downloadResume: async (item) => {
          const artifactKey = `docx-extraction-${rubricVersion}`;
          artifactKeys.push(artifactKey);
          return {
            ...item,
            id: String(item.id),
            greenhouseId: item.id,
            resumeMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            resumeBase64: null,
            resumeText: null,
            resumeFingerprint: artifactKey,
            parseQuality: 'poor' as const,
            resumeCacheKey: artifactKey,
            resumeFailure: null,
            hasBlob: true,
          };
        },
        triage: async () => assert.fail('broken DOCX must not reach triage'),
        score: async () => assert.fail('broken DOCX must not reach scoring'),
        budgetMs: 60_000,
      });
      assert.deepStrictEqual((await store.getRunSummary(run.id))?.failures, [{
        candidateId: '3002',
        candidateName: 'Broken DOCX',
        message: 'Resume text extraction failed (application/vnd.openxmlformats-officedocument.wordprocessingml.document)',
      }]);
    });

    await t.test('resumability produces identical state without double scoring', async () => {
      const { run, rubricVersion } = await seedRun('resume');
      rememberFixtureCacheKeys(rubricVersion);
      await seedCachedCandidate(rubricVersion);
      const scoreCalls = new Map<string, number>();
      const firstToken = randomUUID();
      assert.equal(await store.claimRunLease(run.id, firstToken), true);
      assert.equal(
        await runTick(run.id, firstToken, { ...makeDeps(rubricVersion, scoreCalls), budgetMs: 1 }),
        'chain'
      );
      await store.releaseRunLease(run.id, firstToken);
      await runToCompletion(run.id, { ...makeDeps(rubricVersion, scoreCalls), budgetMs: 1 });
      const summary = await store.getRunSummary(run.id);
      assert(summary);
      assert.deepStrictEqual(project(summary), expectedProjection!);
      assert.deepStrictEqual([...scoreCalls.values()].sort(), [1, 1, 1, 1, 1, 1]);
    });

    await t.test('cancellation prevents further scoring', async () => {
      const { run, rubricVersion } = await seedRun('cancel');
      rememberFixtureCacheKeys(rubricVersion);
      const scoreCalls = new Map<string, number>();
      const token = randomUUID();
      assert.equal(await store.claimRunLease(run.id, token), true);
      assert.equal(
        await runTick(run.id, token, { ...makeDeps(rubricVersion, scoreCalls), budgetMs: 1 }),
        'chain'
      );
      await store.requestRunCancel(run.id);
      const callsBefore = [...scoreCalls.values()].reduce((sum, count) => sum + count, 0);
      assert.equal(
        await store.setRunStage(run.id, token, 'score', 'full_scoring', 'Zombie write'),
        false
      );
      const canceledToken = randomUUID();
      assert.equal(await store.claimRunLease(run.id, canceledToken), false);
      assert.equal(
        await runTick(run.id, canceledToken, { ...makeDeps(rubricVersion, scoreCalls), budgetMs: 60_000 }),
        'idle'
      );
      assert.equal([...scoreCalls.values()].reduce((sum, count) => sum + count, 0), callsBefore);
      assert.equal((await store.getRunSummary(run.id))?.status, 'canceled');
    });
  } finally {
    if (runIds.length) await query('delete from rosie_runs where id = any($1::uuid[])', [runIds]);
    if (rubricVersions.length) {
      await query('delete from rosie_rubrics where rubric_version = any($1::text[])', [rubricVersions]);
    }
    if (artifactKeys.length) {
      await query('delete from rosie_resume_artifacts where artifact_key = any($1::text[])', [[...new Set(artifactKeys)]]);
    }
    if (cacheKeys.length) {
      await query('delete from rosie_result_cache where cache_key = any($1::text[])', [[...new Set(cacheKeys)]]);
    }
    await pool.end();
  }
});
