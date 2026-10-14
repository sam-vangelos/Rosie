import type { ScreeningRunStatus, Tier } from './types';

export interface ScoreGroupDefinition {
  id: Tier;
  label: string;
  range: string;
  min: number;
}

export const SCORE_GROUP_DEFINITIONS = [
  { id: 'top', label: 'Top', range: '9.0–10', min: 9 },
  { id: 'strong', label: 'Strong', range: '8.0–8.9', min: 8 },
  { id: 'moderate', label: 'Moderate', range: '7.0–7.9', min: 7 },
  { id: 'below', label: 'Below', range: 'under 7.0', min: 0 },
] as const satisfies readonly ScoreGroupDefinition[];

export const REVIEW_THRESHOLD = SCORE_GROUP_DEFINITIONS.find(
  (group) => group.id === 'moderate'
)!.min;

export interface RankedCandidate<T> {
  candidate: T;
  rank: number;
}

export interface RankedCandidateGroup<T> extends ScoreGroupDefinition {
  candidates: RankedCandidate<T>[];
}

const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  api: 'Claude API',
  'claude-agent': 'Claude agent',
  'codex-agent': 'Codex agent',
};

const STATUS_LABELS = {
  queued: 'Queued',
  fetching: 'Fetching',
  processing: 'Processing',
  triaging: 'Triaging',
  full_scoring: 'Full scoring',
  auditing: 'Auditing',
  completed: 'Completed',
  canceled: 'Canceled',
  failed: 'Failed',
} as const satisfies Record<ScreeningRunStatus, string>;

const IN_PROGRESS_STATUSES = new Set<ScreeningRunStatus>([
  'queued',
  'fetching',
  'processing',
  'triaging',
  'full_scoring',
  'auditing',
]);

export function humanizeProvider(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

export function humanizeStatus(status: ScreeningRunStatus): string {
  return STATUS_LABELS[status];
}

export function isInProgressStatus(status: ScreeningRunStatus): boolean {
  return IN_PROGRESS_STATUSES.has(status);
}

export function tierFromScore(score: number): Tier {
  return (
    SCORE_GROUP_DEFINITIONS.filter((group) => group.id !== 'below').find(
      (group) => score >= group.min
    )?.id ?? 'below'
  );
}

export function pluralize(
  count: number,
  singular: string,
  plural = `${singular}s`
): string {
  return count === 1 ? singular : plural;
}

export function formatRunListEmptyState(requisitionCount: number | null): {
  heading: string;
  description: string;
} {
  if (requisitionCount === null) {
    return {
      heading: 'No screening runs yet',
      description:
        'Start a screening run in the Rosie cockpit and its results will appear here.',
    };
  }

  if (requisitionCount === 0) {
    return {
      heading: 'No assigned requisitions',
      description:
        'Rosie shows runs only for jobs where Greenhouse lists you as a recruiter. Ask the recruiting lead to add you to the job’s hiring team.',
    };
  }

  return {
    heading: 'No screening runs yet',
    description:
      'Rosie has not screened candidates for your requisitions yet. Ask a Rosie operator to start a run.',
  };
}

function titleCaseNamePart(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1).toLowerCase()}`;
}

export function displayNameFromEmail(email: string): string {
  const normalizedEmail = email.trim();
  const separator = normalizedEmail.indexOf('@');
  if (separator <= 0) return normalizedEmail;

  const localPart = normalizedEmail.slice(0, separator);
  const match = /^([a-z]+)\.([a-z]+)$/i.exec(localPart);
  if (!match) return normalizedEmail;

  return `${titleCaseNamePart(match[1])} ${titleCaseNamePart(match[2])}`;
}

export interface RunVerdictDistribution {
  top: number;
  strong: number;
  moderate: number;
  below: number;
  best: number | null;
}

export interface RunVerdictInput {
  status: ScreeningRunStatus;
  counts: {
    total: number;
    processed: number;
    fullyScored: number;
    failed: number;
    triagedLikelyNo: number;
  };
  distribution: RunVerdictDistribution | null;
}

export type FormattedRunVerdict =
  | {
      kind: 'status';
      primary: string;
      secondary: string | null;
    }
  | {
      kind: 'text';
      primary: string;
      secondary: string | null;
      tone: 'review' | 'default' | 'danger' | 'muted';
    };

export function formatRunVerdict({
  status,
  counts,
  distribution,
}: RunVerdictInput): FormattedRunVerdict {
  if (isInProgressStatus(status)) {
    return {
      kind: 'status',
      primary: humanizeStatus(status),
      secondary: `${counts.processed} of ${counts.total}`,
    };
  }

  if (status === 'failed' || status === 'canceled') {
    return {
      kind: 'status',
      primary: humanizeStatus(status),
      secondary: null,
    };
  }

  const scoredCount = distribution
    ? SCORE_GROUP_DEFINITIONS.reduce(
        (total, group) => total + distribution[group.id],
        0
      )
    : 0;
  const atOrAboveThreshold = distribution
    ? SCORE_GROUP_DEFINITIONS.filter(
        (group) => group.id !== 'below' && group.min >= REVIEW_THRESHOLD
      ).reduce((total, group) => total + distribution[group.id], 0)
    : 0;

  if (scoredCount > 0 && atOrAboveThreshold > 0) {
    return {
      kind: 'text',
      primary: `${atOrAboveThreshold} at or above ${REVIEW_THRESHOLD.toFixed(1)}`,
      secondary: `of ${counts.total} screened`,
      tone: 'review',
    };
  }

  if (scoredCount > 0 && distribution?.best != null) {
    return {
      kind: 'text',
      primary: `best ${distribution.best.toFixed(1)}`,
      secondary: `of ${counts.total} screened`,
      tone: 'default',
    };
  }

  if (counts.failed > 0) {
    return {
      kind: 'text',
      primary: `All ${counts.failed} ${pluralize(
        counts.failed,
        'candidate'
      )} failed to process`,
      secondary: null,
      tone: 'danger',
    };
  }

  if (counts.triagedLikelyNo > 0) {
    return {
      kind: 'text',
      primary: `${counts.total} screened, none advanced to scoring`,
      secondary: null,
      tone: 'default',
    };
  }

  return {
    kind: 'text',
    primary: 'No candidates',
    secondary: null,
    tone: 'muted',
  };
}

export function groupCandidatesByScore<T extends { overallScore: number }>(
  candidates: readonly T[]
): RankedCandidateGroup<T>[] {
  const candidatesByTier: Record<Tier, RankedCandidate<T>[]> = {
    top: [],
    strong: [],
    moderate: [],
    below: [],
  };

  candidates.forEach((candidate, index) => {
    candidatesByTier[tierFromScore(candidate.overallScore)].push({
      candidate,
      rank: index + 1,
    });
  });

  return SCORE_GROUP_DEFINITIONS.flatMap((definition) => {
    const groupedCandidates = candidatesByTier[definition.id];
    return groupedCandidates.length > 0
      ? [{ ...definition, candidates: groupedCandidates }]
      : [];
  });
}

type DateInput = string | number | Date;

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

function roundedRelativeValue(deltaSeconds: number, unitSeconds: number): number {
  const magnitude = Math.max(1, Math.round(Math.abs(deltaSeconds) / unitSeconds));
  return deltaSeconds < 0 ? -magnitude : magnitude;
}

export function formatRelativeDate(value: DateInput, now: DateInput): string {
  const date = toDate(value);
  const reference = toDate(now);

  if (Number.isNaN(date.getTime()) || Number.isNaN(reference.getTime())) {
    return typeof value === 'string' ? value : '';
  }

  const deltaSeconds = (date.getTime() - reference.getTime()) / 1_000;
  const absoluteSeconds = Math.abs(deltaSeconds);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  if (absoluteSeconds < 60) {
    return formatter.format(Math.round(deltaSeconds), 'second');
  }
  if (absoluteSeconds < 60 * 60) {
    return formatter.format(roundedRelativeValue(deltaSeconds, 60), 'minute');
  }
  if (absoluteSeconds < 60 * 60 * 24) {
    return formatter.format(
      roundedRelativeValue(deltaSeconds, 60 * 60),
      'hour'
    );
  }
  if (absoluteSeconds < 60 * 60 * 24 * 7) {
    return formatter.format(
      roundedRelativeValue(deltaSeconds, 60 * 60 * 24),
      'day'
    );
  }
  if (absoluteSeconds < 60 * 60 * 24 * 30) {
    return formatter.format(
      roundedRelativeValue(deltaSeconds, 60 * 60 * 24 * 7),
      'week'
    );
  }
  if (absoluteSeconds < 60 * 60 * 24 * 365) {
    return formatter.format(
      roundedRelativeValue(deltaSeconds, 60 * 60 * 24 * 30),
      'month'
    );
  }
  return formatter.format(
    roundedRelativeValue(deltaSeconds, 60 * 60 * 24 * 365),
    'year'
  );
}
