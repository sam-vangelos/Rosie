import { Buffer } from 'node:buffer';
import {
  bulkSetStep,
  countCandidatesInStep,
  getAuditedCandidateResults,
  getCandidatesInStep,
  getLatestComparableRun,
  getRunForTick,
  heartbeatRun,
  insertPendingCandidates,
  recordFetchFailure,
  releaseRunLease,
  setCandidateArtifactResult,
  setCandidateScoreResult,
  setCandidateTriageFailure,
  setCandidateTriageResult,
  setRunAudit,
  setRunStage,
  setRunStatus,
  setRunTotal,
  type CandidateStepRow,
  type ScreeningRunStage,
  type TickRunRow,
} from './run-store';
import type {
  CandidateArtifact,
  ScreeningRunMode,
  TriageDecision,
} from './types';
import { downloadAttachment } from './greenhouse';
import {
  listScreenableCandidatesForJob,
  type GreenhouseCandidateMetadata,
} from './greenhouse-candidates';
import {
  ROSIE_AUDIT_SAMPLE_RATE,
  ROSIE_TRIAGE_ENABLED,
  assessParseQuality,
  isAuditDisagreement,
  selectAuditSampleIds,
  shouldEscalateLikelyNoBucket,
  buildScoredCandidate,
  routeTriageResult,
  shouldUsePdfInput,
} from './screening-logic';
import {
  buildScoreMessageParams,
  buildTriageMessageParams,
  type ScoringResult,
} from './anthropic';
import {
  getDefaultBatchesClient,
  logBatchSavings,
  pollRunBatches,
  submitStageBatches,
  type AnthropicBatchesClient,
} from './anthropic-batch';
import {
  getCachedJson,
  hashBuffer,
  makeResumeArtifactKey,
  makeScoreVersionKey,
  makeTriageVersionKey,
  setCachedJson,
} from './cache';
import { getResumeArtifact, saveResumeArtifact } from './artifact-store';
import { getProvider } from './providers';
import type { ScreeningProvider } from './providers/types';

export const RESUME_TEXT_LIMIT = 50_000;
const QUEUE_BATCH_SIZE = 100;
const HEARTBEAT_INTERVAL_MS = 20_000;
const IN_FLIGHT_KEEPALIVE_INTERVAL_MS = 45_000;
export const ROSIE_BATCH_THRESHOLD = (() => {
  const value = Number.parseInt(process.env.ROSIE_BATCH_THRESHOLD || '40', 10);
  return Number.isFinite(value) && value > 0 ? value : 40;
})();

type PreparedCandidateArtifact = CandidateArtifact & {
  resumeFailure: string | null;
  hasBlob: boolean;
};

export interface TickDeps {
  listCandidates: typeof listScreenableCandidatesForJob;
  downloadResume: (
    metadata: GreenhouseCandidateMetadata
  ) => Promise<PreparedCandidateArtifact>;
  provider: ScreeningProvider;
  concurrency: { artifacts: number; triage: number; score: number };
  triage: ScreeningProvider['triage'];
  score: ScreeningProvider['score'];
  batchClient?: AnthropicBatchesClient;
  budgetMs: number;
  triageEnabled: boolean;
  auditSampleRate: number;
}

export function buildDefaultTickDeps(provider: ScreeningProvider): TickDeps {
  const configuredAgentConcurrency = Number.parseInt(
    process.env.ROSIE_AGENT_CONCURRENCY || '3',
    10
  );
  const agentConcurrency =
    Number.isFinite(configuredAgentConcurrency) && configuredAgentConcurrency > 0
      ? configuredAgentConcurrency
      : 3;

  return {
    provider,
    concurrency:
      provider.name === 'api'
        ? { artifacts: 6, triage: 6, score: 5 }
        : { artifacts: 6, triage: agentConcurrency, score: agentConcurrency },
    listCandidates: listScreenableCandidatesForJob,
    downloadResume: buildCandidateArtifact,
    triage: (input) => provider.triage(input),
    score: (input) => provider.score(input),
    budgetMs: 210_000,
    triageEnabled: ROSIE_TRIAGE_ENABLED,
    auditSampleRate: ROSIE_AUDIT_SAMPLE_RATE,
  };
}

const TRIAGE_DISABLED_DECISION: TriageDecision = {
  bucket: 'borderline',
  confidence: 1,
  needsFullScore: true,
  rationale: 'Triage disabled',
  currentRole: '',
  currentCompany: '',
};

function trimResumeText(text: string | null): string | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, RESUME_TEXT_LIMIT);
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  canStart: () => Promise<boolean>,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let cursor = 0;
  async function runWorker(): Promise<void> {
    while (true) {
      if (!(await canStart())) return;
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => runWorker())
  );
}

function createTickControl(runId: string, ownerToken: string, budgetMs: number) {
  const startedAt = Date.now();
  let lastHeartbeatAt = 0;
  let heartbeatInFlight: Promise<boolean> | null = null;
  let claimedUnits = 0;
  let stopped = false;

  async function heartbeat(activity?: string, force = false): Promise<boolean> {
    if (stopped) return false;
    if (heartbeatInFlight) return heartbeatInFlight;
    const now = Date.now();
    if (force || now - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
      lastHeartbeatAt = now;
      heartbeatInFlight = heartbeatRun(runId, ownerToken, activity).then((result) => {
        if (!result || result.cancelRequested) stopped = true;
        return !stopped;
      });
      try {
        return await heartbeatInFlight;
      } finally {
        heartbeatInFlight = null;
      }
    }
    return true;
  }

  return {
    heartbeat,
    async claimUnit(activity?: string): Promise<boolean> {
      if (!(await heartbeat(activity))) return false;
      if (claimedUnits > 0 && Date.now() - startedAt >= budgetMs) return false;
      claimedUnits += 1;
      return true;
    },
    expired: () => claimedUnits > 0 && Date.now() - startedAt >= budgetMs,
    stopped: () => stopped,
  };
}

async function withInFlightKeepalive<T>(
  control: ReturnType<typeof createTickControl>,
  activity: string,
  work: () => Promise<T>
): Promise<T> {
  let timer: ReturnType<typeof setInterval> | null = null;
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  timer = setInterval(() => {
    void control.heartbeat(activity).then((active) => {
      if (!active) stop();
    }, stop);
  }, IN_FLIGHT_KEEPALIVE_INTERVAL_MS);

  try {
    return await work();
  } finally {
    stop();
  }
}

async function buildCandidateArtifact(
  metadata: GreenhouseCandidateMetadata
): Promise<PreparedCandidateArtifact> {
  const resumeCacheKey = makeResumeArtifactKey({
    candidateId: metadata.id,
    updatedAt: metadata.updatedAt,
    attachmentUrl: metadata.resumeAttachmentUrl,
    attachmentCreatedAt: metadata.resumeAttachmentCreatedAt,
  });
  const cached = await getResumeArtifact(resumeCacheKey);
  if (cached && (cached.hasBlob || cached.resumeText)) {
    return {
      ...metadataToArtifact(metadata),
      resumeFilename: cached.resumeFilename,
      resumeMimeType: cached.resumeMimeType,
      resumeBase64: null,
      resumeText: cached.resumeText,
      resumeFingerprint: cached.resumeFingerprint,
      parseQuality: cached.parseQuality,
      resumeCacheKey,
      resumeFailure: null,
      hasBlob: cached.hasBlob,
    };
  }

  let resumeBase64: string | null = null;
  let resumeMimeType: string | null = null;
  let resumeText: string | null = null;
  let resumeFingerprint: string | null = null;
  let resumeFailure: string | null = null;

  if (metadata.resumeAttachmentUrl && metadata.resumeFilename) {
    const downloaded = await downloadAttachment(
      metadata.resumeAttachmentUrl,
      metadata.resumeFilename
    );
    if (downloaded.ok) {
      resumeBase64 = downloaded.base64;
      resumeMimeType = downloaded.mimeType;
      resumeText = trimResumeText(downloaded.extractedText);
      resumeFingerprint = hashBuffer(Buffer.from(downloaded.base64, 'base64'));
    } else {
      resumeFailure = downloaded.reason;
    }
  }
  if (!resumeFingerprint && resumeText) {
    resumeFingerprint = hashBuffer(Buffer.from(resumeText, 'utf8'));
  }

  const artifact: PreparedCandidateArtifact = {
    ...metadataToArtifact(metadata),
    resumeMimeType,
    resumeBase64,
    resumeText,
    resumeFingerprint,
    parseQuality: assessParseQuality(resumeText, resumeBase64),
    resumeCacheKey,
    resumeFailure,
    hasBlob: Boolean(resumeBase64),
  };
  return artifact;
}

function metadataToArtifact(metadata: GreenhouseCandidateMetadata): CandidateArtifact {
  return {
    id: String(metadata.id),
    greenhouseId: metadata.id,
    greenhouseUrl: metadata.greenhouseUrl,
    name: metadata.name,
    email: metadata.email,
    company: metadata.company,
    title: metadata.title,
    updatedAt: metadata.updatedAt,
    applicationStatus: metadata.applicationStatus,
    currentStage: metadata.currentStage,
    appliedAt: metadata.appliedAt,
    source: metadata.source,
    resumeFilename: metadata.resumeFilename,
    resumeAttachmentUrl: metadata.resumeAttachmentUrl,
    resumeAttachmentCreatedAt: metadata.resumeAttachmentCreatedAt,
    resumeMimeType: null,
    resumeBase64: null,
    resumeText: null,
    resumeFingerprint: null,
    parseQuality: 'missing',
  };
}

async function saveArtifact(
  artifact: PreparedCandidateArtifact,
  artifactKey: string
): Promise<void> {
  if (!artifact.resumeFingerprint) return;
  await saveResumeArtifact({
    artifactKey,
    resumeFilename: artifact.resumeFilename,
    resumeMimeType: artifact.resumeMimeType,
    resumeBase64: artifact.resumeBase64,
    resumeText: artifact.resumeText,
    resumeFingerprint: artifact.resumeFingerprint,
    parseQuality: artifact.parseQuality,
  });
}

async function hydrateArtifact(
  row: CandidateStepRow,
  withBytes = false
): Promise<PreparedCandidateArtifact> {
  if (!row.artifact_key) throw new Error('Resume artifact is missing');
  const stored = await getResumeArtifact(row.artifact_key, { withBytes });
  if (!stored) throw new Error('Resume artifact is missing');
  const metadata = row.metadata as unknown as GreenhouseCandidateMetadata;
  return {
    ...metadataToArtifact(metadata),
    id: row.candidate_id,
    name: row.candidate_name,
    resumeFilename: stored.resumeFilename,
    resumeMimeType: stored.resumeMimeType,
    resumeBase64: stored.resumeBase64,
    resumeText: stored.resumeText,
    resumeFingerprint: row.resume_fingerprint || stored.resumeFingerprint,
    parseQuality: row.parse_quality || stored.parseQuality,
    resumeCacheKey: row.artifact_key,
    resumeFailure: null,
    hasBlob: stored.hasBlob,
  };
}


function shouldCandidateEnterRun(input: {
  candidateId: string;
  mode: ScreeningRunMode;
  previousFailedIds: Set<string>;
  previousLikelyNoIds: Set<string>;
}): boolean {
  if (input.mode === 'retry_failed_only') {
    return input.previousFailedIds.has(input.candidateId);
  }
  if (input.mode === 'reopen_likely_no') {
    return input.previousLikelyNoIds.has(input.candidateId);
  }
  return true;
}

function scoreCacheKey(
  row: CandidateStepRow,
  run: TickRunRow,
  artifact: PreparedCandidateArtifact,
  provider: ScreeningProvider,
  preferredBucket?: TriageDecision['bucket']
): string | null {
  if (!row.resume_fingerprint) return null;
  return makeScoreVersionKey({
    resumeFingerprint: row.resume_fingerprint,
    rubricVersion: run.rubric_version,
    calibrationVersion: run.calibration_version,
    model: provider.models.full,
    provider: provider.name === 'api' ? undefined : provider.name,
    inputMode: shouldUsePdfInput(
      artifact.parseQuality,
      artifact.resumeMimeType === 'application/pdf',
      artifact.hasBlob,
      preferredBucket
    )
      ? 'pdf'
      : 'text',
  });
}

async function scoreRows(
  run: TickRunRow,
  rows: CandidateStepRow[],
  expectedStep: 'pending_score' | 'pending_audit_score',
  deps: TickDeps,
  control: ReturnType<typeof createTickControl>,
  activityPrefix: string
): Promise<void> {
  await mapWithConcurrency(
    rows,
    deps.concurrency.score,
    () => control.claimUnit(activityPrefix),
    async (row, index) => {
      const activity = `${activityPrefix} ${index + 1} of ${rows.length}: ${row.candidate_name}`;
      try {
        let artifact = await hydrateArtifact(row);
        const useFileInput = shouldUsePdfInput(
          artifact.parseQuality,
          artifact.resumeMimeType === 'application/pdf',
          artifact.hasBlob,
          row.triage_decision?.bucket
        );
        if (useFileInput) artifact = await hydrateArtifact(row, true);
        const cacheKey = scoreCacheKey(
          row,
          run,
          artifact,
          deps.provider,
          row.triage_decision?.bucket
        );
        if (cacheKey) {
          const cached = await getCachedJson<ScoringResult>('score-results', cacheKey);
          if (cached) {
            if (!(await control.heartbeat(activity))) return;
            await setCandidateScoreResult(run.id, row.candidate_id, expectedStep, {
              candidate: buildScoredCandidate(artifact, run.rubric, cached),
              cacheHit: true,
              finalStep: row.audited ? 'audited' : 'fully_scored',
            });
            return;
          }
        }

        const result = await withInFlightKeepalive(control, activity, () =>
          deps.score({
            rubric: run.rubric,
            idealPatterns: run.ideal_patterns,
            candidateId: row.candidate_id,
            candidateName: artifact.name,
            resumeBase64: artifact.resumeBase64,
            resumeText: artifact.resumeText,
            resumeMimeType: artifact.resumeMimeType || 'application/pdf',
            useFileInput,
            parseQuality: artifact.parseQuality,
            preferredBucket: row.triage_decision?.bucket,
          })
        );
        if (!(await control.heartbeat(activity))) return;
        const candidate = buildScoredCandidate(artifact, run.rubric, result);
        if (cacheKey) {
          const scoringResult: ScoringResult = {
            criterionScores: result.criterionScores,
            strengths: result.strengths,
            gaps: result.gaps,
            currentRole: result.currentRole,
            currentCompany: result.currentCompany,
          };
          await setCachedJson('score-results', cacheKey, scoringResult);
        }
        await setCandidateScoreResult(run.id, row.candidate_id, expectedStep, {
          candidate,
          cacheHit: false,
          finalStep: row.audited ? 'audited' : 'fully_scored',
        });
      } catch (error) {
        if (control.stopped()) return;
        const message = error instanceof Error ? error.message : 'Failed to score candidate';
        await setCandidateScoreResult(run.id, row.candidate_id, expectedStep, { failure: message });
      }
    }
  );
}

async function resolveTriageShortCircuits(
  run: TickRunRow,
  rows: CandidateStepRow[],
  control: ReturnType<typeof createTickControl>,
  provider: ScreeningProvider
): Promise<CandidateStepRow[]> {
  const remaining: CandidateStepRow[] = [];
  for (const row of rows) {
    if (!(await control.heartbeat('Preparing triage queue'))) break;
    const artifact = await hydrateArtifact(row);
    const cachedFullScoreKey = scoreCacheKey(row, run, artifact, provider);
    if (cachedFullScoreKey) {
      const cached = await getCachedJson<ScoringResult>('score-results', cachedFullScoreKey);
      if (cached) {
        await setCandidateTriageResult(run.id, row.candidate_id, {
          step: 'fully_scored',
          triageDecision: null,
          cachedCandidate: buildScoredCandidate(artifact, run.rubric, cached),
        });
        continue;
      }
    }

    if (run.mode === 'reopen_likely_no' || artifact.parseQuality !== 'good') {
      const decision: TriageDecision | null = artifact.parseQuality === 'good'
        ? null
        : {
            bucket: 'borderline',
            confidence: 0.6,
            needsFullScore: true,
            rationale: 'Low parse quality; escalated to full score',
            currentRole: artifact.title || '',
            currentCompany: artifact.company || '',
          };
      await setCandidateTriageResult(run.id, row.candidate_id, {
        step: 'pending_score',
        triageDecision: decision,
        escalated: true,
      });
      continue;
    }

    const cacheKey = row.resume_fingerprint && makeTriageVersionKey({
      resumeFingerprint: row.resume_fingerprint,
      rubricVersion: run.rubric_version,
      calibrationVersion: run.calibration_version,
      model: provider.models.triage,
      provider: provider.name === 'api' ? undefined : provider.name,
    });
    const cached = cacheKey
      ? await getCachedJson<TriageDecision>('triage-results', cacheKey)
      : null;
    if (cached) {
      const route = routeTriageResult(cached, artifact.parseQuality);
      await setCandidateTriageResult(run.id, row.candidate_id, {
        ...route,
        triageDecision: cached,
      });
      continue;
    }
    remaining.push(row);
  }
  return remaining;
}

async function triageRowsSync(
  run: TickRunRow,
  rows: CandidateStepRow[],
  deps: TickDeps,
  control: ReturnType<typeof createTickControl>
): Promise<void> {
  await mapWithConcurrency(
    rows,
    deps.concurrency.triage,
    () => control.claimUnit('Running fast triage'),
    async (row, index) => {
      const activity = `Triage ${index + 1} of ${rows.length}: ${row.candidate_name}`;
      try {
        const artifact = await hydrateArtifact(row);
        const decision = await withInFlightKeepalive(control, activity, () =>
          deps.triage({
            rubric: run.rubric,
            candidateId: row.candidate_id,
            candidateName: artifact.name,
            resumeText: artifact.resumeText || '',
            idealPatterns: run.ideal_patterns,
          })
        );
        if (!(await control.heartbeat(activity))) return;
        const cacheKey = row.resume_fingerprint && makeTriageVersionKey({
          resumeFingerprint: row.resume_fingerprint,
          rubricVersion: run.rubric_version,
          calibrationVersion: run.calibration_version,
          model: deps.provider.models.triage,
          provider: deps.provider.name === 'api' ? undefined : deps.provider.name,
        });
        if (cacheKey) await setCachedJson('triage-results', cacheKey, decision);
        const route = routeTriageResult(decision, artifact.parseQuality);
        await setCandidateTriageResult(run.id, row.candidate_id, {
          ...route,
          triageDecision: decision,
        });
      } catch (error) {
        if (control.stopped()) return;
        await setCandidateTriageFailure(
          run.id,
          row.candidate_id,
          error instanceof Error ? error.message : 'Failed to triage candidate'
        );
      }
    }
  );
}

async function resolveScoreCacheHits(
  run: TickRunRow,
  rows: CandidateStepRow[],
  control: ReturnType<typeof createTickControl>,
  provider: ScreeningProvider
): Promise<CandidateStepRow[]> {
  const remaining: CandidateStepRow[] = [];
  for (const row of rows) {
    if (!(await control.heartbeat('Preparing full-score queue'))) break;
    const artifact = await hydrateArtifact(row);
    const cacheKey = scoreCacheKey(
      row,
      run,
      artifact,
      provider,
      row.triage_decision?.bucket
    );
    const cached = cacheKey
      ? await getCachedJson<ScoringResult>('score-results', cacheKey)
      : null;
    if (cached) {
      await setCandidateScoreResult(run.id, row.candidate_id, 'pending_score', {
        candidate: buildScoredCandidate(artifact, run.rubric, cached),
        cacheHit: true,
        finalStep: row.audited ? 'audited' : 'fully_scored',
      });
    } else {
      remaining.push(row);
    }
  }
  return remaining;
}

async function pollOrWait(
  runId: string,
  stage: 'triage' | 'score',
  deps: TickDeps,
  ownerToken: string
): Promise<boolean> {
  if (!(await countCandidatesInStep(runId, [`awaiting_batch_${stage}`]))) return false;
  if (await pollRunBatches(runId, { client: deps.batchClient }) === 'drained') return false;
  await releaseRunLease(runId, ownerToken);
  return true;
}

async function advance(
  run: TickRunRow,
  ownerToken: string,
  stage: ScreeningRunStage,
  status: TickRunRow['status'],
  activity: string
): Promise<boolean> {
  if (!(await setRunStage(run.id, ownerToken, stage, status, activity))) return false;
  run.stage = stage;
  run.status = status;
  return true;
}

export async function runTick(
  runId: string,
  ownerToken: string,
  injected: Partial<TickDeps> = {}
): Promise<'chain' | 'idle' | 'done'> {
  const run = await getRunForTick(runId);
  if (
    !run ||
    run.owner_token !== ownerToken ||
    !run.leased_until ||
    ['completed', 'canceled', 'failed'].includes(run.status)
  ) {
    return 'idle';
  }
  const deps: TickDeps = {
    ...buildDefaultTickDeps(getProvider(run.provider)),
    ...injected,
  };

  const control = createTickControl(runId, ownerToken, deps.budgetMs);
  if (!(await control.heartbeat(undefined, true))) return 'idle';

  while (true) {
    if (control.stopped()) return 'idle';

    switch (run.stage) {
      case 'fetch': {
        if (!(await control.claimUnit('Fetching candidates from Greenhouse'))) return 'chain';
        if (!(await setRunStage(
          run.id,
          ownerToken,
          'fetch',
          'fetching',
          'Fetching candidates from Greenhouse'
        ))) return 'idle';
        try {
          const previousRun = await getLatestComparableRun({
            jobId: Number(run.job_id),
            rubricVersion: run.rubric_version,
            calibrationVersion: run.calibration_version,
            excludeRunId: run.id,
            provider: run.provider,
          });
          const previousFailedIds = new Set(
            previousRun?.failures.map((failure) => failure.candidateId) || []
          );
          const previousLikelyNoIds = new Set(
            previousRun?.likelyNo.map((candidate) => candidate.candidateId) || []
          );
          const listed = await deps.listCandidates(Number(run.job_id));
          if (!(await control.heartbeat('Fetched candidates from Greenhouse'))) return 'idle';
          const eligible = listed.candidates.filter((candidate) =>
            shouldCandidateEnterRun({
              candidateId: String(candidate.id),
              mode: run.mode,
              previousFailedIds,
              previousLikelyNoIds,
            })
          );
          await insertPendingCandidates(
            run.id,
            eligible.map((candidate) => ({
              candidateId: String(candidate.id),
              candidateName: candidate.name,
              metadata: candidate,
            }))
          );
          if (!(await setRunTotal(run.id, eligible.length, ownerToken))) return 'idle';
          if (eligible.length === 0) {
            if (!(await advance(run, ownerToken, 'finalize', 'fetching', 'No candidates matched this run mode'))) {
              return 'idle';
            }
            continue;
          }
          if (!(await advance(run, ownerToken, 'artifacts', 'processing', 'Downloading and parsing resumes'))) {
            return 'idle';
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Greenhouse fetch failed';
          const attempts = await recordFetchFailure(
            run.id,
            ownerToken,
            `Greenhouse fetch failed: ${message}`
          );
          if (attempts === null) return 'idle';
          if (attempts > 10) {
            await setRunStatus(run.id, 'failed', `Greenhouse fetch failed: ${message}`, ownerToken);
            await releaseRunLease(run.id, ownerToken);
            return 'done';
          }
          await releaseRunLease(run.id, ownerToken);
          return 'idle';
        }
        if (control.expired()) return 'chain';
        continue;
      }

      case 'artifacts': {
        const rows = await getCandidatesInStep(run.id, 'pending_artifact', QUEUE_BATCH_SIZE);
        if (!rows.length) {
          if (!(await advance(run, ownerToken, 'triage', 'triaging', 'Running fast triage'))) return 'idle';
          if (control.expired()) return 'chain';
          continue;
        }
        await mapWithConcurrency(
          rows,
          deps.concurrency.artifacts,
          () => control.claimUnit('Downloading and parsing resumes'),
          async (row, index) => {
            const metadata = row.metadata as unknown as GreenhouseCandidateMetadata;
            const activity = `Preparing ${index + 1} of ${rows.length}: ${row.candidate_name}`;
            try {
              const artifact = await deps.downloadResume(metadata);
              if (!(await control.heartbeat(activity))) return;
              const artifactKey = artifact.resumeCacheKey || makeResumeArtifactKey({
                candidateId: metadata.id,
                updatedAt: metadata.updatedAt,
                attachmentUrl: metadata.resumeAttachmentUrl,
                attachmentCreatedAt: metadata.resumeAttachmentCreatedAt,
              });
              if (!artifact.resumeFailure && artifact.resumeFingerprint) {
                await saveArtifact(artifact, artifactKey);
              }
              const hasBytes = artifact.hasBlob || Boolean(artifact.resumeBase64);
              if (hasBytes && !artifact.resumeText && artifact.resumeMimeType !== 'application/pdf') {
                const format = artifact.resumeMimeType
                  || artifact.resumeFilename?.split('.').pop()?.toLowerCase()
                  || 'unknown';
                await setCandidateArtifactResult(run.id, row.candidate_id, {
                  failure: `Resume text extraction failed (${format})`,
                  parseQuality: artifact.parseQuality,
                });
              } else if ((!hasBytes && !artifact.resumeText) || !artifact.resumeFingerprint) {
                const failure = artifact.resumeFilename
                  ? artifact.resumeFailure || 'Resume download or parsing failed'
                  : 'No resume available';
                await setCandidateArtifactResult(run.id, row.candidate_id, {
                  failure,
                  parseQuality: artifact.parseQuality,
                });
              } else {
                await setCandidateArtifactResult(run.id, row.candidate_id, {
                  artifactKey,
                  resumeFingerprint: artifact.resumeFingerprint,
                  parseQuality: artifact.parseQuality,
                });
              }
            } catch (error) {
              if (control.stopped()) return;
              await setCandidateArtifactResult(run.id, row.candidate_id, {
                failure: error instanceof Error ? error.message : 'Resume download or parsing failed',
                parseQuality: 'missing',
              });
            }
          }
        );
        if (control.stopped()) return 'idle';
        if (control.expired() && await countCandidatesInStep(run.id, ['pending_artifact'])) return 'chain';
        continue;
      }

      case 'triage': {
        if (!deps.triageEnabled) {
          const rows = await getCandidatesInStep(run.id, 'pending_triage', 100_000);
          await bulkSetStep(run.id, rows.map((row) => row.candidate_id), {
            step: 'pending_score',
            escalated: false,
            triageDecision: TRIAGE_DISABLED_DECISION,
          });
          if (!(await advance(run, ownerToken, 'audit', 'auditing', 'Triage disabled'))) return 'idle';
          if (control.expired()) return 'chain';
          continue;
        }
        if (await pollOrWait(run.id, 'triage', deps, ownerToken)) return 'idle';
        let rows = await getCandidatesInStep(run.id, 'pending_triage', 100_000);
        if (!rows.length) {
          if (!(await advance(run, ownerToken, 'audit', 'auditing', 'Auditing likely-no sample'))) return 'idle';
          if (control.expired()) return 'chain';
          continue;
        }
        rows = await resolveTriageShortCircuits(run, rows, control, deps.provider);
        if (control.stopped()) return 'idle';
        const retries = rows.filter((row) => row.attempt_count > 0);
        if (retries.length) {
          await triageRowsSync(run, retries.slice(0, QUEUE_BATCH_SIZE), deps, control);
          if (control.stopped()) return 'idle';
          if (control.expired()) return 'chain';
          continue;
        }
        const fresh = rows.filter((row) => row.attempt_count === 0);
        if (fresh.length >= ROSIE_BATCH_THRESHOLD && deps.provider.supportsBatch) {
          await submitStageBatches(
            run.id,
            'triage',
            fresh,
            async (row) => {
              const artifact = await hydrateArtifact(row);
              return buildTriageMessageParams({
                rubric: run.rubric,
                candidateId: row.candidate_id,
                candidateName: artifact.name,
                resumeText: artifact.resumeText || '',
                idealPatterns: run.ideal_patterns,
              });
            },
            deps.batchClient || getDefaultBatchesClient()
          );
          if (await pollOrWait(run.id, 'triage', deps, ownerToken)) return 'idle';
          continue;
        }
        await triageRowsSync(run, fresh, deps, control);
        if (control.stopped()) return 'idle';
        if (control.expired() && await countCandidatesInStep(run.id, ['pending_triage'])) return 'chain';
        continue;
      }

      case 'audit': {
        if (!deps.triageEnabled || deps.auditSampleRate === 0) {
          if (!(await advance(run, ownerToken, 'score', 'full_scoring', 'Running full scoring'))) return 'idle';
          if (control.expired()) return 'chain';
          continue;
        }
        let pending = await getCandidatesInStep(run.id, 'pending_audit_score', QUEUE_BATCH_SIZE);
        if (run.audit.sampled === 0) {
          const likelyNo = (await getCandidatesInStep(run.id, 'triaged_only', 100_000))
            .filter((row) => row.triage_decision?.bucket === 'likely_no');
          if (!pending.length && likelyNo.length) {
            const auditIds = selectAuditSampleIds(
              likelyNo.map((row) => row.candidate_id),
              { sampleRate: deps.auditSampleRate }
            );
            await bulkSetStep(run.id, auditIds, {
              step: 'pending_audit_score',
              audited: true,
            });
            run.audit = { ...run.audit, sampled: auditIds.length };
            if (!(await setRunAudit(run.id, ownerToken, run.audit))) return 'idle';
            pending = await getCandidatesInStep(run.id, 'pending_audit_score', QUEUE_BATCH_SIZE);
          } else if (pending.length) {
            run.audit = {
              ...run.audit,
              sampled: await countCandidatesInStep(run.id, ['pending_audit_score']),
            };
            if (!(await setRunAudit(run.id, ownerToken, run.audit))) return 'idle';
          } else {
            if (!(await advance(run, ownerToken, 'score', 'full_scoring', 'Running full scoring'))) return 'idle';
            if (control.expired()) return 'chain';
            continue;
          }
        }

        if (pending.length) {
          // Audit samples are intentionally always synchronous; they are small.
          await scoreRows(run, pending, 'pending_audit_score', deps, control, 'Audit');
          if (control.stopped()) return 'idle';
          if (control.expired() && await countCandidatesInStep(run.id, ['pending_audit_score'])) {
            return 'chain';
          }
          continue;
        }

        const audited = await getAuditedCandidateResults(run.id);
        const details = audited.map((row) => ({
          candidateId: row.candidate_id,
          triageBucket: row.triage_decision.bucket,
          triageConfidence: row.triage_decision.confidence,
          overallScore: row.full_score.overallScore,
          disagreement: isAuditDisagreement(row.full_score.overallScore),
        }));
        const disagreements = details.filter((detail) => detail.disagreement).length;
        const strongSignalsFound = disagreements;
        const escalatedLikelyNoBucket = shouldEscalateLikelyNoBucket({
          disagreements,
        });
        run.audit = {
          sampled: run.audit.sampled,
          disagreements,
          strongSignalsFound,
          escalatedLikelyNoBucket,
          details,
        };
        if (!(await setRunAudit(run.id, ownerToken, run.audit))) return 'idle';
        if (escalatedLikelyNoBucket) {
          const remaining = (await getCandidatesInStep(run.id, 'triaged_only', 100_000))
            .filter((row) => row.triage_decision?.bucket === 'likely_no')
            .map((row) => row.candidate_id);
          await bulkSetStep(run.id, remaining, {
            step: 'pending_score',
            escalated: true,
          });
        }
        if (!(await advance(run, ownerToken, 'score', 'full_scoring', 'Running full scoring'))) return 'idle';
        if (control.expired()) return 'chain';
        continue;
      }

      case 'score': {
        if (await pollOrWait(run.id, 'score', deps, ownerToken)) return 'idle';
        let rows = await getCandidatesInStep(run.id, 'pending_score', 100_000);
        if (!rows.length) {
          if (!(await advance(run, ownerToken, 'finalize', 'full_scoring', 'Finalizing run'))) return 'idle';
          continue;
        }
        rows = await resolveScoreCacheHits(run, rows, control, deps.provider);
        if (control.stopped()) return 'idle';
        const retries = rows.filter((row) => row.attempt_count > 0);
        if (retries.length) {
          await scoreRows(
            run,
            retries.slice(0, QUEUE_BATCH_SIZE),
            'pending_score',
            deps,
            control,
            'Full score retry'
          );
          if (control.stopped()) return 'idle';
          if (control.expired()) return 'chain';
          continue;
        }
        const fresh = rows.filter((row) => row.attempt_count === 0);
        if (fresh.length >= ROSIE_BATCH_THRESHOLD && deps.provider.supportsBatch) {
          await submitStageBatches(
            run.id,
            'score',
            fresh,
            async (row) => {
              let artifact = await hydrateArtifact(row);
              const useFileInput = shouldUsePdfInput(
                artifact.parseQuality,
                artifact.resumeMimeType === 'application/pdf',
                artifact.hasBlob,
                row.triage_decision?.bucket
              );
              if (useFileInput) artifact = await hydrateArtifact(row, true);
              return buildScoreMessageParams({
                rubric: run.rubric,
                idealPatterns: run.ideal_patterns,
                candidateId: row.candidate_id,
                candidateName: artifact.name,
                resumeBase64: artifact.resumeBase64,
                resumeText: artifact.resumeText,
                resumeMimeType: artifact.resumeMimeType || 'application/pdf',
                useFileInput,
                parseQuality: artifact.parseQuality,
                preferredBucket: row.triage_decision?.bucket,
              });
            },
            deps.batchClient || getDefaultBatchesClient()
          );
          if (await pollOrWait(run.id, 'score', deps, ownerToken)) return 'idle';
          continue;
        }
        await scoreRows(run, fresh, 'pending_score', deps, control, 'Full score');
        if (control.stopped()) return 'idle';
        if (control.expired() && await countCandidatesInStep(run.id, ['pending_score'])) return 'chain';
        continue;
      }

      case 'finalize':
        await logBatchSavings(run.id);
        if (!(await setRunStage(run.id, ownerToken, 'done', 'completed', 'Run complete'))) return 'idle';
        await releaseRunLease(run.id, ownerToken);
        return 'done';

      case 'done':
        await releaseRunLease(run.id, ownerToken);
        return 'done';
    }
  }
}
