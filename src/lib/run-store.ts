import type { PoolClient } from 'pg';
import { pool, query } from './db';
import { getExecutableProviders } from './providers/config';
import type { ProviderName } from './providers/types';
import { SCORE_GROUP_DEFINITIONS } from './viewer-format';
import {
  Candidate,
  CandidateReviewState,
  IdealPatterns,
  ScreeningRunAuditSummary,
  ScreeningRunFailure,
  ScreeningRunMode,
  ScreeningRunListSummary,
  ScreeningRunStatus,
  ScreeningRunSummary,
  ScreeningRunRubric,
  ScreeningRunTrigger,
  ScoringRubric,
  TriageDecision,
  ParseQuality,
} from './types';

export type ScreeningRunStage =
  | 'fetch'
  | 'artifacts'
  | 'triage'
  | 'audit'
  | 'score'
  | 'finalize'
  | 'done';

export interface TickRunRow {
  id: string;
  job_id: string | number;
  job_title: string;
  mode: ScreeningRunMode;
  provider: ProviderName;
  rubric_version: string;
  calibration_version: string | null;
  status: ScreeningRunStatus;
  stage: ScreeningRunStage;
  cancel_requested: boolean;
  owner_token: string | null;
  leased_until: Date | string | null;
  audit: ScreeningRunAuditSummary;
  fetch_attempts: number;
  rubric: ScoringRubric;
  ideal_patterns: IdealPatterns | null;
}

export interface CandidateStepRow {
  candidate_id: string;
  candidate_name: string;
  metadata: Record<string, unknown>;
  artifact_key: string | null;
  resume_fingerprint: string | null;
  parse_quality: ParseQuality | null;
  triage_decision: TriageDecision | null;
  audited: boolean;
  escalated: boolean;
  attempt_count: number;
  batch_id: string | null;
  artifact_byte_size: number;
}

interface RunRow {
  id: string;
  job_id: string | number;
  job_title: string;
  mode: ScreeningRunMode;
  provider: ProviderName;
  rubric_version: string;
  calibration_version: string | null;
  status: ScreeningRunStatus;
  audit: ScreeningRunAuditSummary;
  current_activity: string | null;
  eligible_total: number;
  started_at: Date | string;
  finished_at: Date | string | null;
  last_updated_at: Date | string;
  processed: number;
  triaged_likely_no: number;
  escalated: number;
  fully_scored: number;
  failed: number;
  audited: number;
  cached: number;
}

interface RunListRow {
  id: string;
  job_id: string | number;
  job_title: string;
  mode: ScreeningRunMode;
  provider: ProviderName;
  status: ScreeningRunStatus;
  started_at: Date | string;
  finished_at: Date | string | null;
  eligible_total: number;
  processed: number;
  fully_scored: number;
  failed: number;
  triaged_likely_no: number;
  rubric_version: string;
  calibration_version: string | null;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function assembleSummary(
  row: RunRow,
  fullyScored: Candidate[] = [],
  likelyNo: ScreeningRunSummary['likelyNo'] = [],
  failures: ScreeningRunFailure[] = []
): ScreeningRunSummary {
  return {
    id: row.id,
    jobId: Number(row.job_id),
    jobTitle: row.job_title,
    mode: row.mode,
    provider: row.provider,
    rubricVersion: row.rubric_version,
    calibrationVersion: row.calibration_version,
    status: row.status,
    counts: {
      total: row.eligible_total,
      processed: row.processed,
      triagedLikelyNo: row.triaged_likely_no,
      escalated: row.escalated,
      fullyScored: row.fully_scored,
      failed: row.failed,
      audited: row.audited,
      cached: row.cached,
    },
    audit: row.audit,
    failures,
    currentActivity: row.current_activity,
    fullyScored,
    likelyNo,
    startedAt: toIso(row.started_at),
    finishedAt: row.finished_at ? toIso(row.finished_at) : null,
    lastUpdatedAt: toIso(row.last_updated_at),
  };
}

async function rollback(client: PoolClient): Promise<void> {
  await client.query('rollback');
}

export async function createRun(input: {
  jobId: number;
  jobTitle: string;
  mode: ScreeningRunMode;
  provider?: ProviderName;
  rubricVersion: string;
  calibrationVersion: string | null;
  rubric: ScoringRubric;
  idealPatterns: IdealPatterns | null;
  trigger?: ScreeningRunTrigger;
}): Promise<{ run: ScreeningRunSummary; rubric: ScreeningRunRubric }> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock($1::bigint)', [input.jobId]);
    const active = await client.query(
      `select 1 from rosie_runs
       where job_id = $1 and status not in ('completed', 'canceled', 'failed')
       limit 1`,
      [input.jobId]
    );
    if (active.rowCount) throw new RunAlreadyInProgressError();

    await client.query(
      `
        insert into rosie_rubrics (
          rubric_version, calibration_version, rubric, ideal_patterns, job_id, job_title
        ) values ($1, $2, $3, $4, $5, $6)
        on conflict (rubric_version, calibration_version) do nothing
      `,
      [
        input.rubricVersion,
        input.calibrationVersion,
        input.rubric,
        input.idealPatterns,
        input.jobId,
        input.jobTitle,
      ]
    );
    const rubricResult = await client.query<{
      id: string;
      rubric: ScoringRubric;
      ideal_patterns: IdealPatterns | null;
    }>(
      `select id, rubric, ideal_patterns from rosie_rubrics
       where rubric_version = $1 and calibration_version is not distinct from $2`,
      [input.rubricVersion, input.calibrationVersion]
    );
    if (!rubricResult.rowCount) throw new Error('Failed to save rubric');
    await client.query(
      `update rosie_rubrics set
         job_id = coalesce(job_id, $2),
         job_title = coalesce(job_title, $3)
       where id = $1`,
      [rubricResult.rows[0].id, input.jobId, input.jobTitle]
    );
    const runResult = await client.query<RunRow>(
      `
        insert into rosie_runs (
          job_id, job_title, mode, provider, rubric_id, rubric_version,
          calibration_version, trigger
        ) values ($1, $2, $3, $4, $5, $6, $7, $8)
        returning *,
          0::integer as processed,
          0::integer as triaged_likely_no,
          0::integer as escalated,
          0::integer as fully_scored,
          0::integer as failed,
          0::integer as audited,
          0::integer as cached
      `,
      [
        input.jobId,
        input.jobTitle,
        input.mode,
        input.provider || 'api',
        rubricResult.rows[0].id,
        input.rubricVersion,
        input.calibrationVersion,
        input.trigger || 'manual',
      ]
    );
    await client.query('commit');
    return {
      run: assembleSummary(runResult.rows[0]),
      rubric: {
        rubric: rubricResult.rows[0].rubric,
        idealPatterns: rubricResult.rows[0].ideal_patterns,
      },
    };
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
}

export class RunAlreadyInProgressError extends Error {
  constructor() {
    super('A screening run for this job is already in progress');
    this.name = 'RunAlreadyInProgressError';
  }
}

export async function getRunSummary(id: string): Promise<ScreeningRunSummary | null> {
  const runResult = await query<RunRow>(
    `
      select r.*,
        coalesce(c.processed, 0)::integer as processed,
        coalesce(c.triaged_likely_no, 0)::integer as triaged_likely_no,
        coalesce(c.escalated, 0)::integer as escalated,
        coalesce(c.fully_scored, 0)::integer as fully_scored,
        coalesce(c.failed, 0)::integer as failed,
        coalesce(c.audited, 0)::integer as audited,
        coalesce(c.cached, 0)::integer as cached
      from rosie_runs r
      left join lateral (
        select
          (count(*) filter (
            where step in ('triaged_only', 'fully_scored', 'audited', 'failed')
          ))::integer as processed,
          (count(*) filter (
            where step = 'triaged_only' and triage_decision->>'bucket' = 'likely_no'
          ))::integer as triaged_likely_no,
          (count(*) filter (where escalated))::integer as escalated,
          (count(*) filter (where full_score is not null))::integer as fully_scored,
          (count(*) filter (where step = 'failed'))::integer as failed,
          (count(*) filter (where step = 'audited'))::integer as audited,
          (count(*) filter (where cache_hit))::integer as cached
        from rosie_run_candidates
        where run_id = r.id
      ) c on true
      where r.id = $1
    `,
    [id]
  );

  if (!runResult.rowCount) return null;

  const [fullyScoredResult, likelyNoResult, failuresResult] = await Promise.all([
    query<{ full_score: Candidate }>(
      `
        select candidate_id, full_score
        from rosie_run_candidates
        where run_id = $1 and full_score is not null
        order by (full_score->>'overallScore')::numeric desc, candidate_id
      `,
      [id]
    ),
    query<{
      candidate_id: string;
      candidate_name: string;
      triage_decision: TriageDecision;
      audited: boolean;
    }>(
      `
        select candidate_id, candidate_name, triage_decision, audited
        from rosie_run_candidates
        where run_id = $1
          and step = 'triaged_only'
          and triage_decision->>'bucket' = 'likely_no'
        order by updated_at, candidate_id
      `,
      [id]
    ),
    query<{ candidate_id: string; candidate_name: string; failure: string }>(
      `
        select candidate_id, candidate_name, failure
        from rosie_run_candidates
        where run_id = $1 and step = 'failed'
        order by updated_at, candidate_id
      `,
      [id]
    ),
  ]);

  return assembleSummary(
    runResult.rows[0],
    fullyScoredResult.rows.map((row) => row.full_score),
    likelyNoResult.rows.map((row) => ({
      candidateId: row.candidate_id,
      name: row.candidate_name,
      currentRole: row.triage_decision.currentRole || '',
      currentCompany: row.triage_decision.currentCompany || '',
      confidence: row.triage_decision.confidence || 0,
      rationale: row.triage_decision.rationale || '',
      audited: row.audited,
    })),
    failuresResult.rows.map((row) => ({
      candidateId: row.candidate_id,
      candidateName: row.candidate_name,
      message: row.failure,
    }))
  );
}

export interface RunScoreDistribution {
  top: number;
  strong: number;
  moderate: number;
  below: number;
  best: number | null;
}

/**
 * Tier counts and the best score for many runs in one query. The viewer's run
 * list needs only these aggregates; loading full summaries to derive them costs ~4 queries
 * and every candidate's score payload per row.
 */
export async function getRunScoreDistributions(
  runIds: string[]
): Promise<Map<string, RunScoreDistribution>> {
  if (!runIds.length) return new Map();

  const result = await query<{
    run_id: string;
    top: number;
    strong: number;
    moderate: number;
    below: number;
    best: number | null;
  }>(
    `
      select run_id,
        (count(*) filter (where overall_score >= $2))::integer as top,
        (count(*) filter (
          where overall_score >= $3 and overall_score < $2
        ))::integer as strong,
        (count(*) filter (
          where overall_score >= $4 and overall_score < $3
        ))::integer as moderate,
        (count(*) filter (where overall_score < $4))::integer as below,
        max(overall_score)::double precision as best
      from (
        select run_id, (full_score->>'overallScore')::double precision as overall_score
        from rosie_run_candidates
        where run_id = any($1::uuid[])
          and full_score is not null
          and full_score->>'overallScore' ~ '^-?[0-9]+(\\.[0-9]+)?$'
      ) numeric_scores
      group by run_id
    `,
    [
      runIds,
      SCORE_GROUP_DEFINITIONS.find((group) => group.id === 'top')!.min,
      SCORE_GROUP_DEFINITIONS.find((group) => group.id === 'strong')!.min,
      SCORE_GROUP_DEFINITIONS.find((group) => group.id === 'moderate')!.min,
    ]
  );

  return new Map(
    result.rows.map((row) => [
      row.run_id,
      {
        top: row.top,
        strong: row.strong,
        moderate: row.moderate,
        below: row.below,
        best: row.best,
      },
    ])
  );
}

function buildRunListQuery(
  jobIds: number[] | null,
  limit: number
): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  let jobFilter = '';
  if (jobIds) {
    params.push(jobIds);
    jobFilter = `where r.job_id = any($${params.length}::bigint[])`;
  }
  params.push(limit);
  const limitParameter = `$${params.length}`;

  return {
    text: `
        select r.id, r.job_id, r.job_title, r.mode, r.provider, r.status, r.started_at,
          r.finished_at, r.eligible_total, r.rubric_version, r.calibration_version,
          coalesce(c.processed, 0)::integer as processed,
          coalesce(c.fully_scored, 0)::integer as fully_scored,
          coalesce(c.failed, 0)::integer as failed,
          coalesce(c.triaged_likely_no, 0)::integer as triaged_likely_no
        from rosie_runs r
        left join lateral (
          select
            (count(*) filter (
              where step in ('triaged_only', 'fully_scored', 'audited', 'failed')
            ))::integer as processed,
            (count(*) filter (where full_score is not null))::integer as fully_scored,
            (count(*) filter (where step = 'failed'))::integer as failed,
            (count(*) filter (
              where step = 'triaged_only' and triage_decision->>'bucket' = 'likely_no'
            ))::integer as triaged_likely_no
          from rosie_run_candidates
          where run_id = r.id
        ) c on true
        ${jobFilter}
        order by coalesce(r.finished_at, r.started_at) desc, r.id desc
        limit ${limitParameter}
      `,
    params,
  };
}

function mapRunListRow(row: RunListRow): ScreeningRunListSummary {
  return {
    id: row.id,
    jobId: Number(row.job_id),
    jobTitle: row.job_title,
    mode: row.mode,
    provider: row.provider,
    status: row.status,
    startedAt: toIso(row.started_at),
    finishedAt: row.finished_at ? toIso(row.finished_at) : null,
    counts: {
      total: row.eligible_total,
      processed: row.processed,
      fullyScored: row.fully_scored,
      failed: row.failed,
      triagedLikelyNo: row.triaged_likely_no,
    },
    rubricVersion: row.rubric_version,
    calibrationVersion: row.calibration_version,
  };
}

async function queryRunSummaries(
  jobIds: number[] | null,
  limit: number
): Promise<ScreeningRunListSummary[]> {
  const statement = buildRunListQuery(jobIds, limit);
  const result = await query<RunListRow>(statement.text, statement.params);
  return result.rows.map(mapRunListRow);
}

export async function listRunSummaries(
  limit = 20
): Promise<ScreeningRunListSummary[]> {
  return queryRunSummaries(null, limit);
}

export async function listRunSummariesForJobs(
  jobIds: number[],
  limit = 20
): Promise<ScreeningRunListSummary[]> {
  if (!jobIds.length) return [];
  return queryRunSummaries(jobIds, limit);
}

export async function setRunStatus(
  id: string,
  status: ScreeningRunStatus,
  currentActivity?: string | null,
  ownerToken?: string
): Promise<boolean> {
  const result = await query(
    `
      update rosie_runs set
        status = $2,
        current_activity = case when $3::boolean then $4 else current_activity end,
        finished_at = case
          when $2 in ('completed', 'canceled', 'failed') then now()
          else finished_at
        end,
        last_updated_at = now()
      where id = $1
        and (
          $5::uuid is null
          or (owner_token = $5 and status not in ('completed', 'canceled', 'failed'))
        )
    `,
    [id, status, currentActivity !== undefined, currentActivity ?? null, ownerToken || null]
  );
  return Boolean(result.rowCount);
}

export async function setRunTotal(
  id: string,
  total: number,
  ownerToken?: string
): Promise<boolean> {
  const result = await query(
    `update rosie_runs set eligible_total = $2, last_updated_at = now()
     where id = $1
       and ($3::uuid is null or (
         owner_token = $3 and status not in ('completed', 'canceled', 'failed')
       ))`,
    [id, total, ownerToken || null]
  );
  return Boolean(result.rowCount);
}

export async function setRunActivity(
  id: string,
  currentActivity: string | null
): Promise<void> {
  await query(
    'update rosie_runs set current_activity = $2, last_updated_at = now() where id = $1',
    [id, currentActivity]
  );
}

export async function addRunFailure(
  id: string,
  failure: ScreeningRunFailure
): Promise<void> {
  await query(
    `
      insert into rosie_run_candidates (
        run_id, candidate_id, candidate_name, step, failure
      ) values ($1, $2, $3, 'failed', $4)
      on conflict (run_id, candidate_id) do update set
        candidate_name = excluded.candidate_name,
        step = 'failed',
        failure = excluded.failure,
        updated_at = now()
    `,
    [id, failure.candidateId, failure.candidateName, failure.message]
  );
}

export async function setRunAuditSummary(
  id: string,
  updater: (current: ScreeningRunAuditSummary) => ScreeningRunAuditSummary
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await client.query<{ audit: ScreeningRunAuditSummary }>(
      'select audit from rosie_runs where id = $1 for update',
      [id]
    );
    if (result.rowCount) {
      await client.query(
        'update rosie_runs set audit = $2, last_updated_at = now() where id = $1',
        [id, updater(result.rows[0].audit)]
      );
    }
    await client.query('commit');
  } catch (error) {
    await rollback(client);
    throw error;
  } finally {
    client.release();
  }
}

export async function upsertCandidateState(
  id: string,
  state: CandidateReviewState
): Promise<void> {
  await query(
    `
      insert into rosie_run_candidates (
        run_id, candidate_id, candidate_name, step, parse_quality, audited,
        escalated, cache_hit, triage_decision, full_score, failure, updated_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
      on conflict (run_id, candidate_id) do update set
        candidate_name = excluded.candidate_name,
        step = excluded.step,
        parse_quality = excluded.parse_quality,
        audited = excluded.audited,
        escalated = excluded.escalated,
        cache_hit = excluded.cache_hit,
        triage_decision = excluded.triage_decision,
        full_score = excluded.full_score,
        failure = excluded.failure,
        updated_at = now()
    `,
    [
      id,
      state.candidateId,
      state.candidateName,
      state.state,
      state.parseQuality,
      state.audited,
      state.escalated || false,
      state.cacheHit || false,
      state.triageDecision,
      state.fullScore,
      state.failure,
    ]
  );
}

export async function requestRunCancel(id: string): Promise<ScreeningRunSummary | null> {
  const result = await query<{ id: string }>(
    `
      update rosie_runs set
        cancel_requested = true,
        status = case
          when status not in ('completed', 'failed') then 'canceled'
          else status
        end,
        current_activity = case
          when status not in ('completed', 'failed') then 'Cancel requested'
          else current_activity
        end,
        finished_at = case
          when status not in ('completed', 'failed') then now()
          else finished_at
        end,
        last_updated_at = now()
      where id = $1
      returning id
    `,
    [id]
  );
  if (!result.rowCount) return null;
  return getRunSummary(id);
}

export async function isRunCancellationRequested(id: string): Promise<boolean> {
  const result = await query<{ cancel_requested: boolean }>(
    'select cancel_requested from rosie_runs where id = $1',
    [id]
  );
  return result.rows[0]?.cancel_requested || false;
}

export async function getLatestComparableRun(input: {
  jobId: number;
  rubricVersion: string;
  calibrationVersion?: string | null;
  excludeRunId?: string;
  provider?: ProviderName;
}): Promise<ScreeningRunSummary | null> {
  const result = await query<{ id: string }>(
    `
      select id
      from rosie_runs
      where job_id = $1
        and rubric_version = $2
        and calibration_version is not distinct from $3
        and status = 'completed'
        and ($4::uuid is null or id <> $4)
        and provider = $5
      order by created_at desc, id desc
      limit 1
    `,
    [
      input.jobId,
      input.rubricVersion,
      input.calibrationVersion || null,
      input.excludeRunId || null,
      input.provider || 'api',
    ]
  );
  if (!result.rowCount) return null;
  return getRunSummary(result.rows[0].id);
}

export async function claimRunLease(
  runId: string,
  ownerToken: string,
  leaseSeconds = 360,
  executableProviders = getExecutableProviders()
): Promise<boolean> {
  const result = await query(
    `
      update rosie_runs set
        owner_token = $2,
        leased_until = now() + make_interval(secs => $3),
        claim_count = claim_count + 1,
        last_updated_at = now()
      where id = $1
        and status not in ('completed', 'canceled', 'failed')
        and (owner_token = $2 or leased_until is null or leased_until < now())
        and provider = any($4::text[])
    `,
    [runId, ownerToken, leaseSeconds, executableProviders]
  );
  return Boolean(result.rowCount);
}

export async function heartbeatRun(
  runId: string,
  ownerToken: string,
  activity?: string
): Promise<{ cancelRequested: boolean } | null> {
  const result = await query<{ cancel_requested: boolean }>(
    `
      update rosie_runs set
        leased_until = now() + interval '360 seconds',
        current_activity = case
          when $3::boolean and not cancel_requested then $4
          else current_activity
        end,
        last_updated_at = now()
      where id = $1 and owner_token = $2 and leased_until >= now()
      returning cancel_requested
    `,
    [runId, ownerToken, activity !== undefined, activity ?? null]
  );
  return result.rows[0]
    ? { cancelRequested: result.rows[0].cancel_requested }
    : null;
}

export async function releaseRunLease(runId: string, ownerToken: string): Promise<void> {
  await query(
    `update rosie_runs set owner_token = null, leased_until = null
     where id = $1 and owner_token = $2`,
    [runId, ownerToken]
  );
}

export async function getRunForTick(runId: string): Promise<TickRunRow | null> {
  const result = await query<TickRunRow>(
    `
      select r.id, r.job_id, r.job_title, r.mode, r.provider, r.rubric_version,
        r.calibration_version, r.status, r.stage, r.cancel_requested,
        r.owner_token, r.leased_until, r.audit, r.fetch_attempts,
        b.rubric, b.ideal_patterns
      from rosie_runs r
      join rosie_rubrics b on b.id = r.rubric_id
      where r.id = $1
    `,
    [runId]
  );
  return result.rows[0] || null;
}

export async function setRunStage(
  runId: string,
  ownerToken: string,
  stage: ScreeningRunStage,
  status: ScreeningRunStatus,
  activity: string | null
): Promise<boolean> {
  const result = await query(
    `
      update rosie_runs set
        stage = $3,
        status = $4,
        current_activity = $5,
        finished_at = case
          when $4 in ('completed', 'canceled', 'failed') then now()
          else finished_at
        end,
        last_updated_at = now()
      where id = $1 and owner_token = $2
        and status not in ('completed', 'canceled', 'failed')
    `,
    [runId, ownerToken, stage, status, activity]
  );
  return Boolean(result.rowCount);
}

export async function recordFetchFailure(
  runId: string,
  ownerToken: string,
  message: string
): Promise<number | null> {
  const result = await query<{ fetch_attempts: number }>(
    `
      update rosie_runs set
        fetch_attempts = fetch_attempts + 1,
        current_activity = $3,
        last_updated_at = now()
      where id = $1 and owner_token = $2
        and status not in ('completed', 'canceled', 'failed')
      returning fetch_attempts
    `,
    [runId, ownerToken, message]
  );
  return result.rows[0]?.fetch_attempts ?? null;
}

export async function setRunAudit(
  runId: string,
  ownerToken: string,
  audit: ScreeningRunAuditSummary
): Promise<boolean> {
  const result = await query(
    `update rosie_runs set audit = $3, last_updated_at = now()
     where id = $1 and owner_token = $2
       and status not in ('completed', 'canceled', 'failed')`,
    [runId, ownerToken, audit]
  );
  return Boolean(result.rowCount);
}

export async function getCandidatesInStep(
  runId: string,
  step: string,
  limit: number
): Promise<CandidateStepRow[]> {
  const result = await query<CandidateStepRow>(
    `
      select c.candidate_id, c.candidate_name, c.metadata, c.artifact_key,
        c.resume_fingerprint, c.parse_quality, c.triage_decision, c.audited,
        c.escalated, c.attempt_count, c.batch_id,
        coalesce(a.byte_size, 0)::integer as artifact_byte_size
      from rosie_run_candidates c
      left join rosie_resume_artifacts a on a.artifact_key = c.artifact_key
      where c.run_id = $1 and c.step = $2
      order by c.candidate_id
      limit $3
    `,
    [runId, step, limit]
  );
  return result.rows;
}

export async function countCandidatesInStep(
  runId: string,
  steps: string[]
): Promise<number> {
  if (!steps.length) return 0;
  const result = await query<{ count: string }>(
    `select count(*) from rosie_run_candidates
     where run_id = $1 and step = any($2::text[])`,
    [runId, steps]
  );
  return Number(result.rows[0]?.count || 0);
}

export async function bulkSetStep(
  runId: string,
  candidateIds: string[],
  updates: {
    step: string;
    audited?: boolean;
    escalated?: boolean;
    triageDecision?: TriageDecision | null;
  }
): Promise<void> {
  if (!candidateIds.length) return;
  await query(
    `
      update rosie_run_candidates set
        step = $3,
        audited = case when $4::boolean then $5 else audited end,
        escalated = case when $6::boolean then $7 else escalated end,
        triage_decision = case when $8::boolean then $9::jsonb else triage_decision end,
        updated_at = now()
      where run_id = $1 and candidate_id = any($2::text[])
    `,
    [
      runId,
      candidateIds,
      updates.step,
      updates.audited !== undefined,
      updates.audited ?? false,
      updates.escalated !== undefined,
      updates.escalated ?? false,
      updates.triageDecision !== undefined,
      updates.triageDecision ? JSON.stringify(updates.triageDecision) : null,
    ]
  );
}

export async function insertPendingCandidates(
  runId: string,
  rows: Array<{ candidateId: string; candidateName: string; metadata: unknown }>
): Promise<void> {
  for (let start = 0; start < rows.length; start += 500) {
    const chunk = rows.slice(start, start + 500);
    const params: unknown[] = [runId];
    const values = chunk.map((row, index) => {
      const offset = index * 3 + 2;
      params.push(row.candidateId, row.candidateName, row.metadata);
      return `($1, $${offset}, $${offset + 1}, $${offset + 2}::jsonb)`;
    });
    await query(
      `
        insert into rosie_run_candidates (
          run_id, candidate_id, candidate_name, metadata
        ) values ${values.join(', ')}
        on conflict (run_id, candidate_id) do nothing
      `,
      params
    );
  }
}

export async function setCandidateArtifactResult(
  runId: string,
  candidateId: string,
  input:
    | {
        artifactKey: string;
        resumeFingerprint: string;
        parseQuality: ParseQuality;
      }
    | { failure: string; parseQuality: ParseQuality }
): Promise<void> {
  if ('failure' in input) {
    await query(
      `
        update rosie_run_candidates set
          step = 'failed', parse_quality = $3, failure = $4,
          attempt_count = attempt_count + 1, updated_at = now()
        where run_id = $1 and candidate_id = $2 and step = 'pending_artifact'
      `,
      [runId, candidateId, input.parseQuality, input.failure]
    );
    return;
  }
  await query(
    `
      update rosie_run_candidates set
        step = 'pending_triage', artifact_key = $3, resume_fingerprint = $4,
        parse_quality = $5, failure = null,
        attempt_count = 0, updated_at = now()
      where run_id = $1 and candidate_id = $2 and step = 'pending_artifact'
    `,
    [runId, candidateId, input.artifactKey, input.resumeFingerprint, input.parseQuality]
  );
}

export async function setCandidateTriageResult(
  runId: string,
  candidateId: string,
  input: {
    step: 'pending_score' | 'triaged_only' | 'fully_scored';
    triageDecision: TriageDecision | null;
    escalated?: boolean;
    cachedCandidate?: Candidate;
  }
): Promise<void> {
  await query(
    `
      update rosie_run_candidates set
        step = $3, triage_decision = $4, escalated = $5,
        full_score = $6, cache_hit = $7,
        attempt_count = 0, updated_at = now()
      where run_id = $1 and candidate_id = $2 and step = 'pending_triage'
    `,
    [
      runId,
      candidateId,
      input.step,
      input.triageDecision,
      input.escalated ?? false,
      input.cachedCandidate ?? null,
      Boolean(input.cachedCandidate),
    ]
  );
}

export async function setCandidateTriageFailure(
  runId: string,
  candidateId: string,
  failure: string
): Promise<void> {
  await query(
    `update rosie_run_candidates set
       step = case when attempt_count + 1 >= 2 then 'failed' else 'pending_triage' end,
       failure = $3, attempt_count = attempt_count + 1, updated_at = now()
     where run_id = $1 and candidate_id = $2 and step = 'pending_triage'`,
    [runId, candidateId, failure]
  );
}

export async function setCandidateScoreResult(
  runId: string,
  candidateId: string,
  expectedStep: 'pending_score' | 'pending_audit_score',
  input:
    | { candidate: Candidate; cacheHit: boolean; finalStep: 'fully_scored' | 'audited' }
    | { failure: string }
): Promise<void> {
  if ('failure' in input) {
    await query(
      `
        update rosie_run_candidates set
          step = case when attempt_count + 1 >= 2 then 'failed' else $3 end,
          failure = $4, attempt_count = attempt_count + 1,
          updated_at = now()
        where run_id = $1 and candidate_id = $2 and step = $3
      `,
      [runId, candidateId, expectedStep, input.failure]
    );
    return;
  }
  await query(
    `
      update rosie_run_candidates set
        step = $4, full_score = $5, cache_hit = $6, failure = null,
        attempt_count = 0, updated_at = now()
      where run_id = $1 and candidate_id = $2 and step = $3
    `,
    [runId, candidateId, expectedStep, input.finalStep, input.candidate, input.cacheHit]
  );
}

export async function getAuditedCandidateResults(runId: string): Promise<Array<{
  candidate_id: string;
  triage_decision: TriageDecision;
  full_score: Candidate;
}>> {
  const result = await query<{
    candidate_id: string;
    triage_decision: TriageDecision;
    full_score: Candidate;
  }>(
    `select candidate_id, triage_decision, full_score from rosie_run_candidates
     where run_id = $1 and audited and full_score is not null
     order by candidate_id`,
    [runId]
  );
  return result.rows;
}

export async function failWatchdogTimedOutRuns(): Promise<number> {
  const result = await query(
    `
      update rosie_runs set status = 'failed', error = 'watchdog timeout',
        current_activity = 'watchdog timeout', finished_at = now(),
        owner_token = null, leased_until = null, last_updated_at = now()
      where status not in ('completed', 'canceled', 'failed')
        and started_at < now() - interval '48 hours'
    `
  );
  return result.rowCount || 0;
}

export async function getWatchdogRunIds(
  limit = 5,
  executableProviders = getExecutableProviders()
): Promise<string[]> {
  const result = await query<{ id: string }>(
    `
      select id from rosie_runs
      where status not in ('completed', 'canceled', 'failed')
        and (leased_until is null or leased_until < now())
        and last_updated_at < now() - interval '30 seconds'
        and provider = any($2::text[])
      order by last_updated_at, id
      limit $1
    `,
    [limit, executableProviders]
  );
  return result.rows.map((row) => row.id);
}

export interface RefreshableJobTemplate {
  jobId: number;
  jobTitle: string;
  provider: ProviderName;
  rubricVersion: string;
  calibrationVersion: string | null;
  rubric: ScoringRubric;
  idealPatterns: IdealPatterns | null;
}

/**
 * One template per job: the newest completed MANUAL run. Scheduled runs are
 * deliberately excluded as templates — otherwise the first scheduled run would
 * become its own successor's template and a one-off experiment (odd provider,
 * test rubric) could self-perpetuate forever. Recalibrating and running once
 * by hand is how the template advances.
 */
export async function getRefreshableJobTemplates(): Promise<RefreshableJobTemplate[]> {
  const result = await query<{
    job_id: string | number;
    job_title: string;
    provider: ProviderName;
    rubric_version: string;
    calibration_version: string | null;
    rubric: ScoringRubric;
    ideal_patterns: IdealPatterns | null;
  }>(
    `
      select distinct on (r.job_id)
        r.job_id, r.job_title, r.provider, r.rubric_version,
        r.calibration_version, b.rubric, b.ideal_patterns
      from rosie_runs r
      join rosie_rubrics b on b.id = r.rubric_id
      where r.status = 'completed' and r.trigger = 'manual'
      order by r.job_id, coalesce(r.finished_at, r.started_at) desc, r.id desc
    `
  );
  return result.rows.map((row) => ({
    jobId: Number(row.job_id),
    jobTitle: row.job_title,
    provider: row.provider,
    rubricVersion: row.rubric_version,
    calibrationVersion: row.calibration_version,
    rubric: row.rubric,
    idealPatterns: row.ideal_patterns,
  }));
}

export async function shouldNudgeRun(
  runId: string,
  executableProviders = getExecutableProviders()
): Promise<boolean> {
  const result = await query<{ nudge: boolean }>(
    `
      select (
        status not in ('completed', 'canceled', 'failed')
        and (leased_until is null or leased_until < now())
        and last_updated_at < now() - interval '15 seconds'
      ) as nudge
      from rosie_runs
      where id = $1 and provider = any($2::text[])
    `,
    [runId, executableProviders]
  );
  return result.rows[0]?.nudge || false;
}
