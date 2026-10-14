import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { makeCalibrationVersion } from '../src/lib/cache';
import type {
  Candidate,
  CandidateReviewState,
  ScoringRubric,
  TriageDecision,
} from '../src/lib/types';

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

function candidate(id: string, overallScore: number): Candidate {
  return {
    id,
    name: `Candidate ${id}`,
    email: `${id}@example.com`,
    currentRole: 'Engineer',
    currentCompany: 'ExampleCo',
    scores: {
      criterionScores: [
        { criterionId: 'systems', score: overallScore, evidence: 'Production work' },
      ],
    },
    overallScore,
    tier: overallScore >= 9 ? 'top' : 'moderate',
    strengths: ['Systems'],
    gaps: [],
  };
}

function triage(bucket: TriageDecision['bucket']): TriageDecision {
  return {
    bucket,
    confidence: 0.91,
    needsFullScore: bucket !== 'likely_no',
    rationale: 'Resume evidence',
    currentRole: 'Engineer',
    currentCompany: 'ExampleCo',
  };
}

function state(
  candidateId: string,
  values: Partial<CandidateReviewState>
): CandidateReviewState {
  return {
    candidateId,
    candidateName: `Candidate ${candidateId}`,
    state: values.state || 'triaged_only',
    parseQuality: values.parseQuality || 'good',
    cacheHit: values.cacheHit,
    escalated: values.escalated,
    triageDecision: values.triageDecision || null,
    fullScore: values.fullScore || null,
    failure: values.failure || null,
    audited: values.audited || false,
    updatedAt: new Date().toISOString(),
  };
}

test('Postgres run store persists lifecycle state and derives summaries', async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip('DATABASE_URL is unset');
    return;
  }

  const store = await import('../src/lib/run-store');
  const rubricStore = await import('../src/lib/rubric-store');
  const { pool, query } = await import('../src/lib/db');
  const rubricVersion = `db-test-${randomUUID()}`;
  const foreignRubricVersion = `db-test-foreign-${randomUUID()}`;
  const raceRubricVersion = `db-test-race-${randomUUID()}`;
  const patternsRubricVersion = `db-test-patterns-${randomUUID()}`;
  const jobId = Date.now();
  const runIds: string[] = [];

  try {
    const idealPatterns = {
      commonSkills: [],
      careerPatterns: [],
      achievementSignals: [],
    };
    const patternsOnlyVersion = makeCalibrationVersion({
      rubricVersion: patternsRubricVersion,
      exemplarHashes: ['example-resume'],
      model: 'test-model',
    });
    const { buildPatternsOnlyCalibrationPayload } = await import(
      '../src/lib/calibration-exemplars'
    );
    const patternsOnlyPayload = buildPatternsOnlyCalibrationPayload({
      patterns: idealPatterns,
      calibrationVersion: patternsOnlyVersion,
      calibrationFailed: true,
      filesProcessed: ['example.txt'],
      totalFiles: 1,
    });
    assert.notEqual(patternsOnlyPayload.calibrationVersion, null);
    await rubricStore.saveRubricRecord({
      rubricVersion: patternsRubricVersion,
      calibrationVersion: patternsOnlyVersion,
      rubric,
      idealPatterns,
    });
    assert.deepStrictEqual(
      await rubricStore.getRubricRecord(patternsRubricVersion, patternsOnlyVersion),
      { rubric, ideal_patterns: idealPatterns }
    );
    await rubricStore.saveRubricRecord({
      rubricVersion,
      calibrationVersion: 'calibration-a',
      rubric,
      idealPatterns,
    });
    assert.deepStrictEqual(
      (await rubricStore.getRubricRecord(rubricVersion, 'calibration-a'))?.ideal_patterns,
      idealPatterns
    );
    const conflictingSave = await rubricStore.saveRubricRecord({
      rubricVersion,
      calibrationVersion: 'calibration-a',
      rubric: {
        ...rubric,
        criteria: rubric.criteria.map((criterion) => ({
          ...criterion,
          name: 'Conflicting Save',
        })),
      },
      idealPatterns: null,
    });
    assert.deepStrictEqual(conflictingSave, {
      rubric,
      ideal_patterns: idealPatterns,
    });

    const { run } = await store.createRun({
      jobId,
      jobTitle: 'DB Test Role',
      mode: 'new_or_changed',
      rubricVersion,
      calibrationVersion: 'calibration-a',
      rubric,
      idealPatterns,
    });
    runIds.push(run.id);
    assert.equal(run.status, 'queued');

    await store.setRunTotal(run.id, 4);
    await query(
      `
        insert into rosie_run_candidates (run_id, candidate_id, candidate_name)
        values ($1, 'high', 'Candidate high')
      `,
      [run.id]
    );
    assert.equal((await store.getRunSummary(run.id))?.counts.processed, 0);

    await store.upsertCandidateState(
      run.id,
      state('high', {
        state: 'fully_scored',
        fullScore: candidate('high', 9.4),
        cacheHit: true,
        escalated: true,
      })
    );
    await store.upsertCandidateState(
      run.id,
      state('audit', {
        state: 'audited',
        triageDecision: triage('borderline'),
        fullScore: candidate('audit', 9.4),
        audited: true,
      })
    );
    await store.upsertCandidateState(
      run.id,
      state('failed', {
        state: 'failed',
        parseQuality: 'missing',
        failure: 'Resume unavailable',
      })
    );
    await store.upsertCandidateState(
      run.id,
      state('likely-no', {
        state: 'triaged_only',
        triageDecision: triage('likely_no'),
      })
    );

    const summary = await store.getRunSummary(run.id);
    assert(summary);
    assert.deepStrictEqual(summary.counts, {
      total: 4,
      processed: 4,
      triagedLikelyNo: 1,
      escalated: 1,
      fullyScored: 2,
      failed: 1,
      audited: 1,
      cached: 1,
    });
    assert.deepStrictEqual(summary.fullyScored.map((item) => item.id), ['audit', 'high']);
    assert.equal(summary.likelyNo[0]?.candidateId, 'likely-no');
    assert.equal(summary.likelyNo[0]?.name, 'Candidate likely-no');
    assert.deepStrictEqual(summary.failures[0], {
      candidateId: 'failed',
      candidateName: 'Candidate failed',
      message: 'Resume unavailable',
    });

    // A candidate triaged and escalated is mid-flight, not processed. Counting
    // it as processed made the progress banner read "16 of 16" the moment
    // triage finished while scoring had not started — observed live on run
    // 386d15d0. Only terminal steps count.
    await query(
      `
        insert into rosie_run_candidates (run_id, candidate_id, candidate_name, step, triage_decision, escalated)
        values ($1, 'escalated-inflight', 'Candidate escalated', 'pending_score', $2, true)
      `,
      [run.id, JSON.stringify(triage('top_signal'))]
    );
    await store.setRunTotal(run.id, 5);
    const midFlight = await store.getRunSummary(run.id);
    assert.equal(
      midFlight?.counts.processed,
      4,
      'a triaged candidate awaiting full score must not count as processed'
    );
    assert.equal(midFlight?.counts.total, 5);
    const midFlightList = (await store.listRunSummaries(50)).find(
      (item) => item.id === run.id
    );
    assert.equal(
      midFlightList?.counts.processed,
      4,
      'the list query must count processed identically to the detail query'
    );
    await query(
      `delete from rosie_run_candidates where run_id = $1 and candidate_id = 'escalated-inflight'`,
      [run.id]
    );
    await store.setRunTotal(run.id, 4);

    assert.equal(await store.isRunCancellationRequested(run.id), false);
    assert.equal((await store.requestRunCancel(run.id))?.status, 'canceled');
    assert.equal(await store.isRunCancellationRequested(run.id), true);

    const changedRubric: ScoringRubric = {
      ...rubric,
      criteria: rubric.criteria.map((criterion) => ({
        ...criterion,
        name: 'Mutated Systems',
      })),
    };
    const { run: immutableRun, rubric: storedRubric } = await store.createRun({
      jobId,
      jobTitle: 'DB Test Role',
      mode: 'all',
      rubricVersion,
      calibrationVersion: 'calibration-a',
      rubric: changedRubric,
      idealPatterns: null,
    });
    runIds.push(immutableRun.id);
    assert.deepStrictEqual(storedRubric.rubric, rubric);
    assert.deepStrictEqual((await rubricStore.getRunRubric(immutableRun.id))?.rubric, rubric);
    await assert.rejects(
      store.createRun({
        jobId,
        jobTitle: 'DB Test Role',
        mode: 'all',
        rubricVersion,
        calibrationVersion: 'calibration-a',
        rubric,
        idealPatterns,
      }),
      store.RunAlreadyInProgressError
    );
    await store.setRunStatus(immutableRun.id, 'completed');

    const { run: comparable } = await store.createRun({
      jobId,
      jobTitle: 'DB Test Role',
      mode: 'all',
      rubricVersion,
      calibrationVersion: 'calibration-a',
      rubric,
      idealPatterns,
    });
    runIds.push(comparable.id);
    await store.setRunStatus(comparable.id, 'completed');

    const { run: differentCalibration } = await store.createRun({
      jobId,
      jobTitle: 'DB Test Role',
      mode: 'all',
      rubricVersion,
      calibrationVersion: 'calibration-b',
      rubric,
      idealPatterns: null,
    });
    runIds.push(differentCalibration.id);
    await store.setRunStatus(differentCalibration.id, 'completed');

    const { run: uncalibrated } = await store.createRun({
      jobId,
      jobTitle: 'DB Test Role',
      mode: 'all',
      rubricVersion,
      calibrationVersion: null,
      rubric,
      idealPatterns: null,
    });
    runIds.push(uncalibrated.id);

    const { run: foreignJob } = await store.createRun({
      jobId: jobId + 1,
      jobTitle: 'Different DB Test Role',
      mode: 'all',
      rubricVersion: foreignRubricVersion,
      calibrationVersion: null,
      rubric,
      idealPatterns: null,
    });
    runIds.push(foreignJob.id);

    for (const [id, createdAt] of [
      [run.id, '2999-01-01T00:00:00Z'],
      [comparable.id, '2999-01-02T00:00:00Z'],
      [differentCalibration.id, '2999-01-03T00:00:00Z'],
      [uncalibrated.id, '2999-01-04T00:00:00Z'],
    ]) {
      await query(
        `update rosie_runs set
          started_at = $2,
          finished_at = case when finished_at is null then null else $2::timestamptz end
        where id = $1`,
        [id, createdAt]
      );
    }

    const listedRuns = await store.listRunSummaries(4);
    assert.deepStrictEqual(
      listedRuns.map((item) => item.id),
      [uncalibrated.id, differentCalibration.id, comparable.id, run.id]
    );
    assert.deepStrictEqual(listedRuns[3].counts, {
      total: 4,
      processed: 4,
      fullyScored: 2,
      failed: 1,
      triagedLikelyNo: 1,
    });
    assert.equal('fullyScored' in listedRuns[3], false);
    assert.deepStrictEqual(
      (await store.listRunSummariesForJobs([jobId + 1], 4)).map(
        (item) => item.id
      ),
      [foreignJob.id]
    );
    assert.deepStrictEqual(
      await store.listRunSummariesForJobs([], 4),
      []
    );

    await query(
      `insert into rosie_run_candidates (
        run_id, candidate_id, candidate_name, step
      ) values ($1, 'pending-retry', 'Candidate pending-retry', 'pending_triage')`,
      [uncalibrated.id]
    );
    await store.setCandidateTriageFailure(
      uncalibrated.id,
      'pending-retry',
      'Transient triage failure'
    );
    assert.equal(
      (await store.getRunSummary(uncalibrated.id))?.counts.processed,
      0
    );
    assert.equal(
      (
        await store.listRunSummariesForJobs([jobId], 4)
      ).find((item) => item.id === uncalibrated.id)?.counts.processed,
      0
    );

    assert.deepStrictEqual(await store.getRunScoreDistributions([]), new Map());
    await store.upsertCandidateState(
      uncalibrated.id,
      state('boundary-top', {
        state: 'fully_scored',
        fullScore: candidate('boundary-top', 9),
      })
    );
    await store.upsertCandidateState(
      uncalibrated.id,
      state('boundary-strong', {
        state: 'fully_scored',
        fullScore: candidate('boundary-strong', 8),
      })
    );
    await store.upsertCandidateState(
      uncalibrated.id,
      state('boundary-moderate', {
        state: 'fully_scored',
        fullScore: candidate('boundary-moderate', 7),
      })
    );
    await store.upsertCandidateState(
      uncalibrated.id,
      state('boundary-below', {
        state: 'fully_scored',
        fullScore: candidate('boundary-below', 6.9),
      })
    );
    await query(
      `insert into rosie_run_candidates (
        run_id, candidate_id, candidate_name, step, full_score
      ) values (
        $1, 'malformed-score', 'Candidate malformed-score', 'fully_scored',
        jsonb_build_object('overallScore', 'not-a-number')
      )`,
      [uncalibrated.id]
    );

    const distributions = await store.getRunScoreDistributions([
      uncalibrated.id,
    ]);
    assert.deepStrictEqual(distributions.get(uncalibrated.id), {
      top: 1,
      strong: 1,
      moderate: 1,
      below: 1,
      best: 9,
    });
    assert.equal(typeof distributions.get(uncalibrated.id)?.best, 'number');

    await query(
      `update rosie_rubrics set created_at = case
        when calibration_version is null then '2999-01-03T00:00:00Z'::timestamptz
        when calibration_version = 'calibration-b' then '2999-01-02T00:00:00Z'::timestamptz
        else '2999-01-01T00:00:00Z'::timestamptz
      end where rubric_version = $1`,
      [rubricVersion]
    );
    const savedRubrics = await rubricStore.listRubricsForJob(jobId);
    assert.deepStrictEqual(
      savedRubrics.map((item) => [item.calibrationVersion, item.calibrated]),
      [[null, false], ['calibration-b', true], ['calibration-a', true]]
    );
    assert.deepStrictEqual(savedRubrics[0].criteriaNames, ['Systems']);
    assert.deepStrictEqual(
      (await rubricStore.listRubricsForJob(jobId + 1)).map((item) => item.rubricVersion),
      [foreignRubricVersion]
    );

    assert.equal(
      (
        await store.getLatestComparableRun({
          jobId,
          rubricVersion,
          calibrationVersion: 'calibration-a',
        })
      )?.id,
      comparable.id
    );
    assert.equal(
      (
        await store.getLatestComparableRun({
          jobId,
          rubricVersion,
          calibrationVersion: 'calibration-a',
          excludeRunId: comparable.id,
        })
      )?.id,
      immutableRun.id
    );

    const racing = await Promise.allSettled([
      store.createRun({
        jobId: jobId + 2,
        jobTitle: 'Race Test Role',
        mode: 'all',
        rubricVersion: raceRubricVersion,
        calibrationVersion: null,
        rubric,
        idealPatterns: null,
      }),
      store.createRun({
        jobId: jobId + 2,
        jobTitle: 'Race Test Role',
        mode: 'all',
        rubricVersion: raceRubricVersion,
        calibrationVersion: null,
        rubric,
        idealPatterns: null,
      }),
    ]);
    const created = racing.filter((result) => result.status === 'fulfilled');
    const rejected = racing.filter((result) => result.status === 'rejected');
    assert.equal(created.length, 1);
    assert.equal(rejected.length, 1);
    if (created[0].status === 'fulfilled') runIds.push(created[0].value.run.id);
    if (rejected[0].status === 'rejected') {
      assert(rejected[0].reason instanceof store.RunAlreadyInProgressError);
    }
  } finally {
    if (runIds.length) {
      await query('delete from rosie_runs where id = any($1::uuid[])', [runIds]);
    }
    await query('delete from rosie_rubrics where rubric_version = any($1::text[])', [
      [rubricVersion, foreignRubricVersion, raceRubricVersion, patternsRubricVersion],
    ]);
    await pool.end();
  }
});
