import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import type {
  MessageBatchIndividualResponse,
  MessageBatchRequestCounts,
} from '@anthropic-ai/sdk/resources/messages/batches';
import {
  chunkStageItems,
  makeBatchCustomId,
  parseBatchCustomId,
  SCORE_BATCH_MAX_BASE64_BYTES,
} from '../src/lib/anthropic-batch-chunking';
import type { ScoringRubric } from '../src/lib/types';

test('batch chunking respects request and base64 boundaries', () => {
  const item = (artifact_byte_size = 0) => ({ artifact_byte_size });
  assert.deepStrictEqual(
    chunkStageItems('triage', Array.from({ length: 1001 }, () => item())).map((chunk) => chunk.length),
    [1000, 1]
  );
  assert.deepStrictEqual(
    chunkStageItems('score', Array.from({ length: 201 }, () => item())).map((chunk) => chunk.length),
    [200, 1]
  );
  const raw50MbAsBase64 = SCORE_BATCH_MAX_BASE64_BYTES * 3 / 4;
  assert.equal(chunkStageItems('score', [item(raw50MbAsBase64)]).length, 1);
  assert.deepStrictEqual(
    chunkStageItems('score', [item(raw50MbAsBase64), item(1)]).map((chunk) => chunk.length),
    [1, 1]
  );
});

test('Anthropic batch custom IDs are valid and round-trip opaque candidate IDs', () => {
  const localId = randomUUID();
  const candidateId = 'opaque_id_with_underscores';
  const customId = makeBatchCustomId(localId, candidateId);
  assert.match(customId, /^[a-zA-Z0-9_-]{1,64}$/);
  assert.equal(parseBatchCustomId(customId, localId), candidateId);
});

if (!process.env.DATABASE_URL) {
  try {
    loadEnvFile('.env.local');
  } catch {
    // The database scenarios skip below when no local database is configured.
  }
}
process.env.ROSIE_BATCH_THRESHOLD = '40';

const rubric: ScoringRubric = {
  criteria: [{
    id: 'systems',
    name: 'Systems',
    description: 'Builds reliable systems',
    weight: 100,
    scoringGuide: { high: 'Excellent', mid: 'Adequate', low: 'Limited' },
  }],
  tableStakes: ['TypeScript'],
};

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function params(): Anthropic.Messages.MessageCreateParamsNonStreaming {
  return {
    model: 'test-model',
    max_tokens: 1,
    messages: [{ role: 'user', content: 'test' }],
  };
}

function message(payload: unknown): Anthropic.Messages.Message {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 1, output_tokens: 1 },
  } as Anthropic.Messages.Message;
}

test('Anthropic batch database scenarios', async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip('DATABASE_URL is unset');
    return;
  }

  const { pool, query } = await import('../src/lib/db');
  const store = await import('../src/lib/run-store');
  const {
    cancelRunBatches,
    pollRunBatches,
    submitStageBatches,
  } = await import('../src/lib/anthropic-batch');
  const { runTick } = await import('../src/lib/screening-engine');
  const {
    ANTHROPIC_FULL_SCORE_MODEL,
    ANTHROPIC_TRIAGE_MODEL,
  } = await import('../src/lib/anthropic');
  const {
    makeScoreVersionKey,
    makeTriageVersionKey,
  } = await import('../src/lib/cache');

  const runIds: string[] = [];
  const rubricVersions: string[] = [];
  const artifactKeys: string[] = [];
  const cacheKeys: string[] = [];

  async function seedRun(label: string) {
    const rubricVersion = `${label}-${randomUUID()}`;
    rubricVersions.push(rubricVersion);
    const { run } = await store.createRun({
      jobId: Date.now(),
      jobTitle: 'Batch Test Role',
      mode: 'all',
      rubricVersion,
      calibrationVersion: null,
      rubric,
      idealPatterns: null,
    });
    runIds.push(run.id);
    return { run, rubricVersion };
  }

  async function seedCandidates(
    runId: string,
    rubricVersion: string,
    ids: string[],
    step: 'pending_triage' | 'awaiting_batch_triage' = 'pending_triage'
  ) {
    await store.insertPendingCandidates(runId, ids.map((id) => ({
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
    })));
    const keys = ids.map((id) => `batch-artifact-${rubricVersion}-${id}`);
    const fingerprints = ids.map((id) => `batch-fingerprint-${rubricVersion}-${id}`);
    artifactKeys.push(...keys);
    await query(
      `insert into rosie_resume_artifacts (
         artifact_key, resume_fingerprint, resume_filename, resume_mime_type,
         resume_text, parse_quality, byte_size
       ) select * from unnest(
         $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::integer[]
       ) on conflict (artifact_key) do nothing`,
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
      `update rosie_run_candidates c set step = $5, artifact_key = x.artifact_key,
         resume_fingerprint = x.fingerprint, parse_quality = 'good', attempt_count = 0
       from unnest($2::text[], $3::text[], $4::text[]) x(candidate_id, artifact_key, fingerprint)
       where c.run_id = $1 and c.candidate_id = x.candidate_id`,
      [runId, ids, keys, fingerprints, step]
    );
    for (const fingerprint of fingerprints) {
      cacheKeys.push(makeTriageVersionKey({
        resumeFingerprint: fingerprint,
        rubricVersion,
        calibrationVersion: null,
        model: ANTHROPIC_TRIAGE_MODEL,
      }));
      cacheKeys.push(makeScoreVersionKey({
        resumeFingerprint: fingerprint,
        rubricVersion,
        calibrationVersion: null,
        model: ANTHROPIC_FULL_SCORE_MODEL,
        inputMode: 'text',
      }));
    }
  }

  try {
    await t.test('cancel with no batches does not construct the API client', async () => {
      const { run } = await seedRun('cancel-no-batches');
      delete process.env.ANTHROPIC_API_KEY;
      await assert.doesNotReject(cancelRunBatches(run.id));
    });

    await t.test('two-phase submit pins candidates before create resolves', async () => {
      const { run, rubricVersion } = await seedRun('two-phase');
      const ids = ['4101', '4102'];
      await seedCandidates(run.id, rubricVersion, ids);
      const createStarted = deferred();
      const createGate = deferred();
      const fake = {
        async create() {
          createStarted.resolve();
          await createGate.promise;
          return { id: 'msgbatch_two_phase' };
        },
        async retrieve() { throw new Error('not used'); },
        async results() { throw new Error('not used'); },
        async cancel() {},
      };
      const rows = await store.getCandidatesInStep(run.id, 'pending_triage', 10);
      const submitting = submitStageBatches(run.id, 'triage', rows, async () => params(), fake);
      await createStarted.promise;
      const before = await query<{ status: string; anthropic_batch_id: string | null; model: string | null }>(
        'select status, anthropic_batch_id, model from rosie_anthropic_batches where run_id = $1',
        [run.id]
      );
      assert.deepStrictEqual(before.rows, [{ status: 'submitting', anthropic_batch_id: null, model: null }]);
      assert.equal(await store.countCandidatesInStep(run.id, ['awaiting_batch_triage']), 2);
      createGate.resolve();
      await submitting;
      const after = await query<{ status: string; anthropic_batch_id: string; model: string | null }>(
        'select status, anthropic_batch_id, model from rosie_anthropic_batches where run_id = $1',
        [run.id]
      );
      // The submission-time model must be recorded on the batch row: ingestion
      // keys cached results from it, not from the currently configured model.
      assert.deepStrictEqual(after.rows, [{ status: 'submitted', anthropic_batch_id: 'msgbatch_two_phase', model: 'test-model' }]);
    });

    await t.test('tick waits, ingests mixed results, and retries failures synchronously once', async () => {
      const { run, rubricVersion } = await seedRun('round-trip');
      const ids = Array.from({ length: 40 }, (_, index) => String(4200 + index));
      await seedCandidates(run.id, rubricVersion, ids);
      await query(
        `update rosie_runs set stage = 'triage', status = 'triaging', last_updated_at = now()
         where id = $1`,
        [run.id]
      );

      const allResultsYielded = deferred();
      const finishResults = deferred();
      let requests: Array<{ custom_id: string }> = [];
      let retrieves = 0;
      const counts: MessageBatchRequestCounts = {
        processing: 0,
        succeeded: 38,
        errored: 1,
        canceled: 0,
        expired: 1,
      };
      const fake = {
        async create(input: { requests: Array<{ custom_id: string }> }) {
          requests = input.requests;
          assert.equal(
            requests.every(({ custom_id }) => /^[a-zA-Z0-9_-]{1,64}$/.test(custom_id)),
            true
          );
          return { id: 'msgbatch_round_trip' };
        },
        async retrieve() {
          retrieves += 1;
          return retrieves === 1
            ? {
                processing_status: 'in_progress' as const,
                request_counts: { ...counts, processing: 40, succeeded: 0, errored: 0, expired: 0 },
                ended_at: null,
              }
            : { processing_status: 'ended' as const, request_counts: counts, ended_at: new Date().toISOString() };
        },
        async results() {
          const source = [...requests].reverse();
          return (async function* (): AsyncGenerator<MessageBatchIndividualResponse> {
            for (const request of source) {
              const candidateId = parseBatchCustomId(
                request.custom_id,
                request.custom_id.slice(0, 36)
              );
              if (candidateId === '4204') continue;
              if (candidateId === '4202') {
                yield {
                  custom_id: request.custom_id,
                  result: { type: 'errored', error: { type: 'error', error: { type: 'api_error', message: 'fixture' } } },
                } as MessageBatchIndividualResponse;
              } else if (candidateId === '4203') {
                yield { custom_id: request.custom_id, result: { type: 'expired' } };
              } else {
                const likelyNo = Number(candidateId) >= 4201 && Number(candidateId) <= 4208;
                yield {
                  custom_id: request.custom_id,
                  result: {
                    type: 'succeeded',
                    message: message({
                      bucket: likelyNo ? 'likely_no' : 'top_signal',
                      confidence: likelyNo ? 0.96 : 0.8,
                      needsFullScore: !likelyNo,
                      rationale: 'Fixture batch triage',
                      currentRole: 'Engineer',
                      currentCompany: 'ExampleCo',
                    }),
                  },
                };
              }
            }
            allResultsYielded.resolve();
            await finishResults.promise;
          })();
        },
        async cancel() {},
      };
      const triageCalls = new Map<string, number>();
      const scoreCalls = new Map<string, number>();
      const deps = {
        batchClient: fake,
        budgetMs: 60_000,
        triage: async ({ candidateName }: { candidateName: string }) => {
          const id = candidateName.replace('Candidate ', '');
          triageCalls.set(id, (triageCalls.get(id) || 0) + 1);
          return {
            bucket: 'likely_no' as const,
            confidence: 0.96,
            needsFullScore: false,
            rationale: 'Fixture sync fallback',
            currentRole: 'Engineer',
            currentCompany: 'ExampleCo',
          };
        },
        score: async ({ candidateName }: { candidateName: string }) => {
          const id = candidateName.replace('Candidate ', '');
          scoreCalls.set(id, (scoreCalls.get(id) || 0) + 1);
          const likelyNo = Number(id) >= 4201 && Number(id) <= 4208;
          return {
            criterionScores: [{ criterionId: 'systems', score: likelyNo ? 5 : 8, evidence: 'Built systems' }],
            strengths: ['Systems'],
            gaps: [],
            currentRole: 'Engineer',
            currentCompany: 'ExampleCo',
            usage: {} as never,
          };
        },
      };

      const firstToken = randomUUID();
      assert.equal(await store.claimRunLease(run.id, firstToken), true);
      assert.equal(await runTick(run.id, firstToken, deps), 'idle');
      const waitingRun = await store.getRunForTick(run.id);
      assert.equal(waitingRun?.owner_token, null);
      assert.equal(await store.countCandidatesInStep(run.id, ['awaiting_batch_triage']), 40);

      const secondToken = randomUUID();
      assert.equal(await store.claimRunLease(run.id, secondToken), true);
      const secondTick = runTick(run.id, secondToken, deps);
      await allResultsYielded.promise;
      const fallbackRows = await query<{
        candidate_id: string;
        step: string;
        attempt_count: number;
        batch_id: string | null;
      }>(
        `select candidate_id, step, attempt_count, batch_id from rosie_run_candidates
         where run_id = $1 and candidate_id = any($2::text[]) order by candidate_id`,
        [run.id, ['4200', '4202', '4203']]
      );
      assert.deepStrictEqual(fallbackRows.rows, [
        { candidate_id: '4200', step: 'pending_score', attempt_count: 0, batch_id: null },
        { candidate_id: '4202', step: 'pending_triage', attempt_count: 1, batch_id: null },
        { candidate_id: '4203', step: 'pending_triage', attempt_count: 1, batch_id: null },
      ]);
      finishResults.resolve();
      assert.equal(await secondTick, 'done');
      assert.deepStrictEqual(
        [...triageCalls.entries()].sort(),
        [['4202', 1], ['4203', 1], ['4204', 1]]
      );
      assert.equal([...scoreCalls.values()].every((value) => value === 1), true);
      assert.equal((await store.getRunSummary(run.id))?.status, 'completed');
      assert.equal(await store.countCandidatesInStep(run.id, ['triaged_only']) > 0, true);
      assert.equal(await store.countCandidatesInStep(run.id, ['awaiting_batch_triage', 'awaiting_batch_score']), 0);
    });

    await t.test('stale submitting recovery fails the batch and requeues members', async () => {
      const { run, rubricVersion } = await seedRun('stale');
      const ids = ['4301', '4302'];
      await seedCandidates(run.id, rubricVersion, ids, 'awaiting_batch_triage');
      const batch = await query<{ id: string }>(
        `insert into rosie_anthropic_batches (
           run_id, stage, status, request_count, created_at
         ) values ($1, 'triage', 'submitting', 2, now() - interval '11 minutes') returning id`,
        [run.id]
      );
      await query(
        'update rosie_run_candidates set batch_id = $2 where run_id = $1',
        [run.id, batch.rows[0].id]
      );
      const fake = {
        async create() { throw new Error('not used'); },
        async retrieve() { throw new Error('not used'); },
        async results() { throw new Error('not used'); },
        async cancel() {},
      };
      assert.equal(await pollRunBatches(run.id, { client: fake }), 'drained');
      const recovered = await query<{ candidate_id: string; step: string; attempt_count: number }>(
        `select candidate_id, step, attempt_count from rosie_run_candidates
         where run_id = $1 order by candidate_id`,
        [run.id]
      );
      assert.deepStrictEqual(recovered.rows, ids.map((candidate_id) => ({
        candidate_id,
        step: 'pending_triage',
        attempt_count: 1,
      })));
      assert.equal((await query<{ status: string }>(
        'select status from rosie_anthropic_batches where id = $1',
        [batch.rows[0].id]
      )).rows[0].status, 'failed');
    });

    await t.test('expired batches requeue members once and become ingested', async () => {
      const { run, rubricVersion } = await seedRun('expired');
      const ids = ['4401', '4402'];
      await seedCandidates(run.id, rubricVersion, ids, 'awaiting_batch_triage');
      const batch = await query<{ id: string }>(
        `insert into rosie_anthropic_batches (
           run_id, stage, status, request_count, ended_at
         ) values ($1, 'triage', 'expired', 2, now()) returning id`,
        [run.id]
      );
      await query(
        'update rosie_run_candidates set batch_id = $2 where run_id = $1',
        [run.id, batch.rows[0].id]
      );
      const fake = {
        async create() { throw new Error('not used'); },
        async retrieve() { throw new Error('not used'); },
        async results() { throw new Error('not used'); },
        async cancel() {},
      };
      assert.equal(await pollRunBatches(run.id, { client: fake }), 'drained');
      assert.deepStrictEqual((await query<{
        candidate_id: string;
        step: string;
        attempt_count: number;
      }>(
        `select candidate_id, step, attempt_count from rosie_run_candidates
         where run_id = $1 order by candidate_id`,
        [run.id]
      )).rows, ids.map((candidate_id) => ({
        candidate_id,
        step: 'pending_triage',
        attempt_count: 1,
      })));
      assert.equal((await query<{ status: string }>(
        'select status from rosie_anthropic_batches where id = $1',
        [batch.rows[0].id]
      )).rows[0].status, 'ingested');
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
