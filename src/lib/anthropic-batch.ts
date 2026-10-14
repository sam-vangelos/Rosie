import type Anthropic from '@anthropic-ai/sdk';
import type {
  MessageBatch,
  MessageBatchIndividualResponse,
  MessageBatchRequestCounts,
} from '@anthropic-ai/sdk/resources/messages/batches';
import { pool, query } from './db';
import {
  ANTHROPIC_FULL_SCORE_MODEL,
  ANTHROPIC_TRIAGE_MODEL,
  finalizeScoreResult,
  finalizeTriageResult,
  getAnthropicClient,
  getOutputText,
  type ScoringResult,
} from './anthropic';
import { getResumeArtifact } from './artifact-store';
import {
  makeScoreVersionKey,
  makeTriageVersionKey,
  setCachedJson,
} from './cache';
import {
  buildScoredCandidate,
  routeTriageResult,
  shouldUsePdfInput,
} from './screening-logic';
import type {
  CandidateArtifact,
  IdealPatterns,
  ParseQuality,
  ScoringRubric,
  TriageDecision,
} from './types';
import {
  chunkStageItems,
  makeBatchCustomId,
  parseBatchCustomId,
  type BatchStage,
} from './anthropic-batch-chunking';
export {
  chunkStageItems,
  makeBatchCustomId,
  parseBatchCustomId,
  SCORE_BATCH_MAX_BASE64_BYTES,
  SCORE_BATCH_MAX_REQUESTS,
  TRIAGE_BATCH_MAX_REQUESTS,
} from './anthropic-batch-chunking';
export type { BatchStage } from './anthropic-batch-chunking';

export interface BatchCandidateItem {
  candidate_id: string;
  artifact_byte_size: number;
}

export interface AnthropicBatchesClient {
  create(input: {
    requests: Array<{
      custom_id: string;
      params: Anthropic.Messages.MessageCreateParamsNonStreaming;
    }>;
  }): Promise<Pick<MessageBatch, 'id'>>;
  retrieve(id: string): Promise<Pick<MessageBatch, 'processing_status' | 'request_counts' | 'ended_at'>>;
  results(id: string): Promise<AsyncIterable<MessageBatchIndividualResponse>>;
  cancel(id: string): Promise<unknown>;
}

interface BatchRow {
  id: string;
  run_id: string;
  stage: BatchStage;
  anthropic_batch_id: string | null;
  model: string | null;
  status: 'submitting' | 'submitted' | 'ended' | 'ingested' | 'expired' | 'canceled' | 'failed';
  request_count: number;
  request_counts: MessageBatchRequestCounts | null;
  created_at: Date | string;
  submitted_at: Date | string | null;
}

interface BatchRunRow {
  rubric_version: string;
  calibration_version: string | null;
  rubric: ScoringRubric;
  ideal_patterns: IdealPatterns | null;
}

interface BatchCandidateRow {
  candidate_id: string;
  candidate_name: string;
  metadata: Record<string, unknown>;
  artifact_key: string;
  resume_fingerprint: string;
  parse_quality: ParseQuality;
  triage_decision: TriageDecision | null;
  audited: boolean;
  attempt_count: number;
}

export function getDefaultBatchesClient(): AnthropicBatchesClient {
  return getAnthropicClient().messages.batches;
}

export async function submitStageBatches<T extends BatchCandidateItem>(
  runId: string,
  stage: BatchStage,
  items: T[],
  buildParams: (item: T) => Promise<Anthropic.Messages.MessageCreateParamsNonStreaming>,
  client: AnthropicBatchesClient = getDefaultBatchesClient()
): Promise<void> {
  for (const item of items) {
    if (item.candidate_id.length > 27) {
      throw new Error(`Candidate ID is too long for an Anthropic custom_id: ${item.candidate_id}`);
    }
  }

  for (const chunk of chunkStageItems(stage, items)) {
    const db = await pool.connect();
    let localId: string;
    try {
      await db.query('begin');
      const inserted = await db.query<{ id: string }>(
        `insert into rosie_anthropic_batches (run_id, stage, request_count)
         values ($1, $2, $3) returning id`,
        [runId, stage, chunk.length]
      );
      localId = inserted.rows[0].id;
      const pinned = await db.query(
        `update rosie_run_candidates set step = $4, batch_id = $3, updated_at = now()
         where run_id = $1 and candidate_id = any($2::text[])
           and step = $5 and batch_id is null`,
        [
          runId,
          chunk.map((item) => item.candidate_id),
          localId,
          `awaiting_batch_${stage}`,
          `pending_${stage}`,
        ]
      );
      if (pinned.rowCount !== chunk.length) {
        throw new Error(`Pinned ${pinned.rowCount || 0} of ${chunk.length} batch candidates`);
      }
      await db.query('commit');
    } catch (error) {
      await db.query('rollback');
      throw error;
    } finally {
      db.release();
    }

    const requests = [];
    for (const item of chunk) {
      requests.push({
        custom_id: makeBatchCustomId(localId, item.candidate_id),
        params: await buildParams(item),
      });
    }
    const remote = await client.create({ requests });
    await query(
      `update rosie_anthropic_batches set anthropic_batch_id = $2, model = $3,
         status = 'submitted', submitted_at = now(), last_polled_at = now()
       where id = $1 and status = 'submitting'`,
      [localId, remote.id, requests[0].params.model]
    );
    console.log(
      `[anthropic-batch] submitted run=${runId} stage=${stage} local=${localId} remote=${remote.id} requests=${chunk.length}`
    );
  }
}

async function getBatchCandidate(
  batch: BatchRow,
  candidateId: string
): Promise<BatchCandidateRow | null> {
  const expected = `awaiting_batch_${batch.stage}`;
  const result = await query<BatchCandidateRow>(
    `select candidate_id, candidate_name, metadata, artifact_key,
       resume_fingerprint, parse_quality, triage_decision, audited, attempt_count
     from rosie_run_candidates
     where run_id = $1 and candidate_id = $2 and batch_id = $3 and step = $4`,
    [batch.run_id, candidateId, batch.id, expected]
  );
  return result.rows[0] || null;
}

async function hydrateCandidate(row: BatchCandidateRow): Promise<CandidateArtifact & { hasBlob: boolean }> {
  const stored = await getResumeArtifact(row.artifact_key);
  if (!stored) throw new Error(`Resume artifact is missing for ${row.candidate_id}`);
  const metadata = row.metadata as unknown as CandidateArtifact;
  return {
    ...metadata,
    id: row.candidate_id,
    name: row.candidate_name,
    resumeFilename: stored.resumeFilename,
    resumeMimeType: stored.resumeMimeType,
    resumeBase64: null,
    resumeText: stored.resumeText,
    resumeFingerprint: row.resume_fingerprint,
    parseQuality: row.parse_quality,
    hasBlob: stored.hasBlob,
  };
}

async function requeueBatchMembers(batch: BatchRow, failure?: string): Promise<number> {
  const result = await query(
    `update rosie_run_candidates set step = $3, batch_id = null,
       attempt_count = attempt_count + 1, failure = $4, updated_at = now()
     where run_id = $1 and batch_id = $2 and step = $5`,
    [
      batch.run_id,
      batch.id,
      `pending_${batch.stage}`,
      failure || null,
      `awaiting_batch_${batch.stage}`,
    ]
  );
  return result.rowCount || 0;
}

async function markBatchIngested(batchId: string): Promise<void> {
  await query(
    `update rosie_anthropic_batches set status = 'ingested', ingested_at = now()
     where id = $1 and status in ('ended', 'expired')`,
    [batchId]
  );
}

async function failBatchItem(
  batch: BatchRow,
  candidateId: string,
  kind: 'errored' | 'expired' | 'canceled',
  message: string
): Promise<void> {
  const expected = `awaiting_batch_${batch.stage}`;
  const pending = `pending_${batch.stage}`;
  if (kind === 'errored') {
    await query(
      `update rosie_run_candidates set
         step = case when attempt_count + 1 < 2 then $5 else 'failed' end,
         batch_id = null, attempt_count = attempt_count + 1,
         failure = $6, updated_at = now()
       where run_id = $1 and candidate_id = $2 and batch_id = $3 and step = $4`,
      [batch.run_id, candidateId, batch.id, expected, pending, message]
    );
    return;
  }
  await query(
    `update rosie_run_candidates set step = $5, batch_id = null,
       attempt_count = attempt_count + 1, failure = $6, updated_at = now()
     where run_id = $1 and candidate_id = $2 and batch_id = $3 and step = $4`,
    [batch.run_id, candidateId, batch.id, expected, pending, message]
  );
}

async function ingestSuccess(
  batch: BatchRow,
  run: BatchRunRow,
  row: BatchCandidateRow,
  message: Anthropic.Messages.Message
): Promise<void> {
  const artifact = await hydrateCandidate(row);
  if (batch.stage === 'triage') {
    const decision = finalizeTriageResult(
      getOutputText(message, `batchTriage:${row.candidate_id}`),
      row.candidate_name
    );
    // Key on the model the batch was submitted with, not the currently
    // configured one — a config change between submission and ingestion must
    // not file results under a model that never produced them. The fallback
    // covers rows created before migration 004 recorded it.
    const cacheKey = makeTriageVersionKey({
      resumeFingerprint: row.resume_fingerprint,
      rubricVersion: run.rubric_version,
      calibrationVersion: run.calibration_version,
      model: batch.model ?? ANTHROPIC_TRIAGE_MODEL,
    });
    await setCachedJson('triage-results', cacheKey, decision);
    const route = routeTriageResult(decision, row.parse_quality);
    await query(
      `update rosie_run_candidates set step = $4, triage_decision = $5,
         escalated = $6, batch_id = null, attempt_count = 0,
         failure = null, updated_at = now()
       where run_id = $1 and candidate_id = $2 and batch_id = $3
         and step = 'awaiting_batch_triage'`,
      [batch.run_id, row.candidate_id, batch.id, route.step, decision, route.escalated]
    );
    return;
  }

  const result = finalizeScoreResult(
    getOutputText(message, `batchScore:${row.candidate_id}`),
    run.rubric,
    row.candidate_name
  );
  const candidate = buildScoredCandidate(artifact, run.rubric, result);
  const useFileInput = shouldUsePdfInput(
    artifact.parseQuality,
    artifact.resumeMimeType === 'application/pdf',
    artifact.hasBlob,
    row.triage_decision?.bucket
  );
  const cacheKey = makeScoreVersionKey({
    resumeFingerprint: row.resume_fingerprint,
    rubricVersion: run.rubric_version,
    calibrationVersion: run.calibration_version,
    model: batch.model ?? ANTHROPIC_FULL_SCORE_MODEL,
    inputMode: useFileInput ? 'pdf' : 'text',
  });
  const scoringResult: ScoringResult = {
    criterionScores: result.criterionScores,
    strengths: result.strengths,
    gaps: result.gaps,
    currentRole: result.currentRole,
    currentCompany: result.currentCompany,
  };
  await setCachedJson('score-results', cacheKey, scoringResult);
  await query(
    `update rosie_run_candidates set step = $4, full_score = $5,
       attempt_count = 0, failure = null, updated_at = now()
     where run_id = $1 and candidate_id = $2 and batch_id = $3
       and step = 'awaiting_batch_score'`,
    [batch.run_id, row.candidate_id, batch.id, row.audited ? 'audited' : 'fully_scored', candidate]
  );
}

async function ingestBatch(
  batch: BatchRow,
  run: BatchRunRow,
  client: AnthropicBatchesClient
): Promise<void> {
  if (!batch.anthropic_batch_id) throw new Error(`Batch ${batch.id} has no Anthropic ID`);
  const counts = { succeeded: 0, errored: 0, expired: 0, canceled: 0 };
  const results = await client.results(batch.anthropic_batch_id);
  for await (const item of results) {
    const candidateId = parseBatchCustomId(item.custom_id, batch.id);
    const row = await getBatchCandidate(batch, candidateId);
    if (!row) continue;

    if (item.result.type === 'succeeded') {
      try {
        await ingestSuccess(batch, run, row, item.result.message);
        counts.succeeded += 1;
      } catch (error) {
        counts.errored += 1;
        const message = error instanceof Error ? error.message : 'Invalid Anthropic batch result';
        await failBatchItem(batch, candidateId, 'errored', message);
      }
    } else {
      counts[item.result.type] += 1;
      const message = item.result.type === 'errored'
        ? JSON.stringify(item.result.error)
        : `Anthropic batch request ${item.result.type}`;
      await failBatchItem(batch, candidateId, item.result.type, message);
    }
  }
  await requeueBatchMembers(batch, 'Anthropic batch result missing');
  await markBatchIngested(batch.id);
  console.log(
    `[anthropic-batch] ingested run=${batch.run_id} stage=${batch.stage} local=${batch.id} succeeded=${counts.succeeded} errored=${counts.errored} expired=${counts.expired} canceled=${counts.canceled}`
  );
}

export async function expireStaleBatches(): Promise<number> {
  const result = await query<{ id: string }>(
    `update rosie_anthropic_batches set status = 'expired', ended_at = now()
     where status = 'submitted' and submitted_at < now() - interval '25 hours'
     returning id`
  );
  if (result.rowCount) {
    console.error(`[anthropic-batch] watchdog expired ${result.rowCount} batches older than 25h`);
  }
  return result.rowCount || 0;
}

export async function pollRunBatches(
  runId: string,
  deps: { client?: AnthropicBatchesClient } = {}
): Promise<'processing' | 'drained'> {
  const client = deps.client || getDefaultBatchesClient();
  await expireStaleBatches();
  const runResult = await query<BatchRunRow>(
    `select r.rubric_version, r.calibration_version, b.rubric, b.ideal_patterns
     from rosie_runs r join rosie_rubrics b on b.id = r.rubric_id where r.id = $1`,
    [runId]
  );
  const run = runResult.rows[0];
  if (!run) return 'drained';
  const rows = await query<BatchRow>(
    `select * from rosie_anthropic_batches
     where run_id = $1 and status in ('submitting', 'submitted', 'ended', 'expired')
     order by created_at, id`,
    [runId]
  );
  let processing = false;

  for (const batch of rows.rows) {
    if (batch.status === 'expired') {
      await requeueBatchMembers(batch, 'Anthropic batch expired');
      await markBatchIngested(batch.id);
      continue;
    }
    if (batch.status === 'submitting') {
      if (Date.now() - new Date(batch.created_at).getTime() > 10 * 60 * 1000) {
        await query(
          `update rosie_anthropic_batches set status = 'failed', ended_at = now()
           where id = $1 and status = 'submitting'`,
          [batch.id]
        );
        const requeued = await requeueBatchMembers(batch, 'Stale batch submission recovered');
        console.error(
          `[anthropic-batch] STALE SUBMITTING RECOVERY run=${runId} batch=${batch.id} requeued=${requeued}; remote batch may be orphaned`
        );
      } else {
        processing = true;
      }
      continue;
    }
    if (batch.status === 'submitted') {
      if (!batch.anthropic_batch_id) {
        processing = true;
        continue;
      }
      const remote = await client.retrieve(batch.anthropic_batch_id);
      await query(
        `update rosie_anthropic_batches set processing_status = $2,
           request_counts = $3, last_polled_at = now(),
           status = case when $2 = 'ended' then 'ended' else status end,
           ended_at = case when $2 = 'ended' then coalesce($4::timestamptz, now()) else ended_at end
         where id = $1`,
        [batch.id, remote.processing_status, remote.request_counts, remote.ended_at]
      );
      const done = batch.request_count - remote.request_counts.processing;
      await query(
        `update rosie_runs set current_activity = $2, last_updated_at = now()
         where id = $1 and status not in ('completed', 'canceled', 'failed')`,
        [runId, `Waiting on Anthropic batch — ${done}/${batch.request_count} done`]
      );
      if (remote.processing_status !== 'ended') {
        processing = true;
        continue;
      }
      batch.status = 'ended';
      batch.request_counts = remote.request_counts;
      console.log(
        `[anthropic-batch] ended run=${runId} stage=${batch.stage} local=${batch.id} counts=${JSON.stringify(remote.request_counts)}`
      );
    }
    if (batch.status === 'ended') {
      await ingestBatch(batch, run, client);
    }
  }
  return processing ? 'processing' : 'drained';
}

export async function cancelRunBatches(
  runId: string,
  client?: AnthropicBatchesClient
): Promise<void> {
  const rows = await query<{ anthropic_batch_id: string | null }>(
    `update rosie_anthropic_batches set status = 'canceled', ended_at = now()
     where run_id = $1 and status in ('submitting', 'submitted', 'ended')
     returning anthropic_batch_id`,
    [runId]
  );
  const ids = rows.rows.flatMap(({ anthropic_batch_id }) =>
    anthropic_batch_id ? [anthropic_batch_id] : []
  );
  if (ids.length === 0) return;

  const batchesClient = client || getDefaultBatchesClient();
  await Promise.all(ids.map(async (id) => {
    try {
      await batchesClient.cancel(id);
    } catch (error) {
      console.error(`[anthropic-batch] cancel failed run=${runId} remote=${id}:`, error);
    }
  }));
}

export async function logBatchSavings(runId: string): Promise<void> {
  const result = await query<{ count: string }>(
    `select count(*) from rosie_run_candidates c
     join rosie_anthropic_batches b on b.id = c.batch_id and b.stage = 'score'
     where c.run_id = $1 and c.full_score is not null`,
    [runId]
  );
  const batchScored = Number(result.rows[0]?.count || 0);
  console.log(
    `[anthropic-batch] run=${runId} batch_scored=${batchScored} estimated_savings=${batchScored} × 0.5 × nominal per-candidate cost`
  );
}
