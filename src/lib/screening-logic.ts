import {
  Candidate,
  CandidateArtifact,
  CriterionScore,
  ParseQuality,
  ScoringRubric,
  Tier,
  TriageDecision,
} from './types';

export const TRIAGE_CONFIDENCE_THRESHOLD = 0.9;

export function parseTriageEnabled(value: string | undefined): boolean {
  return (value || 'true').trim().toLowerCase() !== 'false';
}

export function parseAuditSampleRate(value: string | undefined): number {
  const parsed = Number.parseFloat(value || '0.1');
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0.1;
}

/**
 * Audit policy:
 * - Sample at least five likely-no candidates (or the whole bucket when smaller).
 * - A full score of 8.0+ is both an audit disagreement and a strong signal.
 * - Because those definitions intentionally coincide, any disagreement reopens the bucket;
 *   there is no separate disagreement-rate rule.
 * - An audit sample rate of zero disables auditing and leaves the likely-no bucket standing.
 */
export const AUDIT_MIN_SAMPLE = 5;
export const DEFAULT_AUDIT_SAMPLE_RATE = 0.1;
export const STRONG_SIGNAL_SCORE_THRESHOLD = 8;
export const AUDIT_DISAGREEMENT_SCORE_THRESHOLD = STRONG_SIGNAL_SCORE_THRESHOLD;
export const ROSIE_TRIAGE_ENABLED = parseTriageEnabled(process.env.ROSIE_TRIAGE_ENABLED);
export const ROSIE_AUDIT_SAMPLE_RATE = parseAuditSampleRate(
  process.env.ROSIE_AUDIT_SAMPLE_RATE
);

export function assessParseQuality(
  resumeText: string | null,
  resumeBase64: string | null
): ParseQuality {
  const textLength = resumeText?.trim().length || 0;

  if (textLength >= 1200) {
    return 'good';
  }

  if (textLength > 0 || resumeBase64) {
    return 'poor';
  }

  return 'missing';
}

export function shouldEscalateToFullScore(
  triageDecision: TriageDecision,
  parseQuality: ParseQuality
): boolean {
  if (parseQuality !== 'good') {
    return true;
  }

  if (triageDecision.needsFullScore) {
    return true;
  }

  if (triageDecision.bucket !== 'likely_no') {
    return true;
  }

  return triageDecision.confidence < TRIAGE_CONFIDENCE_THRESHOLD;
}

export function routeTriageResult(
  triageDecision: TriageDecision,
  parseQuality: ParseQuality
): { step: 'pending_score' | 'triaged_only'; escalated: boolean } {
  const escalated = shouldEscalateToFullScore(triageDecision, parseQuality);
  return { step: escalated ? 'pending_score' : 'triaged_only', escalated };
}

export function buildScoredCandidate(
  artifact: CandidateArtifact,
  rubric: ScoringRubric,
  result: {
    criterionScores: CriterionScore[];
    strengths: string[];
    gaps: string[];
    currentRole: string;
    currentCompany: string;
  }
): Candidate {
  let totalWeight = 0;
  const weightedSum = result.criterionScores.reduce((sum, score) => {
    const weight = rubric.criteria.find((item) => item.id === score.criterionId)?.weight ?? 0;
    totalWeight += weight;
    return sum + score.score * weight;
  }, 0);
  const overallScore = totalWeight === 0 ? 0 : weightedSum / totalWeight;
  const rounded = Math.round(Math.min(10, Math.max(0, overallScore)) * 10) / 10;
  const tier: Tier = rounded >= 9 ? 'top' : rounded >= 8 ? 'strong' : rounded >= 7 ? 'moderate' : 'below';

  return {
    id: artifact.id,
    greenhouseId: artifact.greenhouseId,
    greenhouseUrl: artifact.greenhouseUrl,
    name: artifact.name,
    email: artifact.email,
    currentRole: result.currentRole || artifact.title || 'Unknown',
    currentCompany: result.currentCompany || artifact.company || 'Unknown',
    scores: { criterionScores: result.criterionScores },
    overallScore: rounded,
    tier,
    strengths: result.strengths,
    gaps: result.gaps,
    resumeFilename: artifact.resumeFilename || undefined,
    applicationStatus: artifact.applicationStatus,
    currentStage: artifact.currentStage,
    appliedAt: artifact.appliedAt,
    source: artifact.source,
  };
}

export function shouldUsePdfInput(
  parseQuality: ParseQuality,
  isPdf: boolean,
  hasBase64: boolean,
  preferredBucket?: TriageDecision['bucket']
): boolean {
  if (!isPdf || !hasBase64) {
    return false;
  }

  if (parseQuality !== 'good') {
    return true;
  }

  return preferredBucket === 'top_signal';
}

export function selectAuditSampleIds(
  candidateIds: string[],
  opts: { random?: () => number; sampleRate?: number } = {}
): string[] {
  const sampleRate = opts.sampleRate ?? ROSIE_AUDIT_SAMPLE_RATE;
  if (candidateIds.length === 0 || sampleRate <= 0) {
    return [];
  }

  const ids = [...candidateIds].sort();
  if (ids.length <= AUDIT_MIN_SAMPLE) return ids;

  const sampleSize = Math.min(
    ids.length,
    Math.max(AUDIT_MIN_SAMPLE, Math.ceil(ids.length * sampleRate))
  );
  const random = opts.random ?? Math.random;
  for (let index = 0; index < sampleSize; index += 1) {
    const selected = index + Math.floor(random() * (ids.length - index));
    [ids[index], ids[selected]] = [ids[selected], ids[index]];
  }
  return ids.slice(0, sampleSize);
}

export function isAuditDisagreement(overallScore: number): boolean {
  return overallScore >= AUDIT_DISAGREEMENT_SCORE_THRESHOLD;
}

export function shouldEscalateLikelyNoBucket(input: {
  disagreements: number;
}): boolean {
  return input.disagreements > 0;
}
