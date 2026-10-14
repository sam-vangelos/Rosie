import { createHash } from 'node:crypto';

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, sortValue(nested)])
    );
  }

  return value;
}

export function stableSerialize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function stableHash(value: unknown): string {
  return createHash('sha256').update(stableSerialize(value)).digest('hex');
}

export function hashBuffer(buffer: Buffer | Uint8Array | ArrayBuffer): string {
  const source = buffer instanceof ArrayBuffer ? Buffer.from(buffer) : Buffer.from(buffer);
  return createHash('sha256').update(source).digest('hex');
}

export function makeCacheKey(namespace: string, value: unknown): string {
  return `${namespace}:${stableHash(value)}`;
}

type ResultCacheNamespace = 'triage-results' | 'score-results';

export async function getCachedJson<T>(
  namespace: ResultCacheNamespace,
  key: string
): Promise<T | null> {
  const { query } = await import('./db');
  const result = await query<{ payload: T }>(
    'select payload from rosie_result_cache where namespace = $1 and cache_key = $2',
    [namespace, key]
  );
  return result.rows[0]?.payload || null;
}

export async function setCachedJson<T>(
  namespace: ResultCacheNamespace,
  key: string,
  value: T
): Promise<void> {
  const { query } = await import('./db');
  await query(
    `
      insert into rosie_result_cache (namespace, cache_key, payload)
      values ($1, $2, $3)
      on conflict (namespace, cache_key) do nothing
    `,
    [namespace, key, value]
  );
}

export const VERSION_TAGS = {
  rubric: 'rubric-v2',
  calibration: 'calibration-v2',
  triage: 'triage-v2',
  score: 'score-v4',
  resume: 'resume-v1',
} as const;

export function makeRubricVersion(input: {
  jobDescription: string;
  intakeNotes: string;
  model: string;
  provider?: string;
}): string {
  return stableHash({
    version: VERSION_TAGS.rubric,
    ...input,
  });
}

export function makeCalibrationVersion(input: {
  rubricVersion: string;
  exemplarHashes: string[];
  model: string;
  provider?: string;
}): string {
  return stableHash({
    version: VERSION_TAGS.calibration,
    ...input,
    exemplarHashes: [...input.exemplarHashes].sort(),
  });
}

export function makeResumeArtifactKey(input: {
  candidateId: number;
  updatedAt: string;
  attachmentUrl: string | null;
  attachmentCreatedAt: string | null;
  parserVersion?: string;
}): string {
  return stableHash({
    version: VERSION_TAGS.resume,
    parserVersion: input.parserVersion || VERSION_TAGS.resume,
    candidateId: input.candidateId,
    updatedAt: input.updatedAt,
    attachmentUrl: input.attachmentUrl,
    attachmentCreatedAt: input.attachmentCreatedAt,
  });
}

export function makeScoreVersionKey(input: {
  resumeFingerprint: string;
  rubricVersion: string;
  calibrationVersion: string | null;
  model: string;
  inputMode: 'text' | 'pdf';
  promptVersion?: string;
  provider?: string;
}): string {
  return stableHash({
    version: input.promptVersion || VERSION_TAGS.score,
    ...input,
  });
}

export function makeTriageVersionKey(input: {
  resumeFingerprint: string;
  rubricVersion: string;
  calibrationVersion: string | null;
  model: string;
  promptVersion?: string;
  provider?: string;
}): string {
  return stableHash({
    version: input.promptVersion || VERSION_TAGS.triage,
    ...input,
  });
}
