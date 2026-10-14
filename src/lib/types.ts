import type { ProviderName } from './providers/types';

export type Tier = 'top' | 'strong' | 'moderate' | 'below';
export type ParseQuality = 'good' | 'poor' | 'missing';
export type TriageBucket = 'top_signal' | 'borderline' | 'likely_no';
export type CandidateReviewLifecycle = 'triaged_only' | 'fully_scored' | 'audited' | 'failed';
export type ScreeningRunStatus =
  | 'queued'
  | 'fetching'
  | 'processing'
  | 'triaging'
  | 'full_scoring'
  | 'auditing'
  | 'completed'
  | 'canceled'
  | 'failed';
export type ScreeningRunMode =
  | 'new_or_changed'
  | 'all'
  | 'retry_failed_only'
  | 'reopen_likely_no';
export type ScreeningRunTrigger = 'manual' | 'scheduled';

// ---- Discriminative Scoring Model ----

/** A single discriminative criterion that separates top candidates from the rest */
export interface DiscriminativeCriterion {
  id: string;
  name: string;
  description: string;
  weight: number; // 0-100, all criteria weights sum to 100
  scoringGuide: {
    high: string;   // 9-10: what excellence looks like
    mid: string;    // 6-8: what adequate looks like
    low: string;    // 1-5: what a gap looks like
  };
}

/** The scoring rubric — 3-5 discriminative criteria + table-stakes (not scored) */
export interface ScoringRubric {
  criteria: DiscriminativeCriterion[];
  tableStakes: string[];
  calibrationSummary?: string;
}

/** Per-criterion score with evidence extracted from the resume */
export interface CriterionScore {
  criterionId: string;
  score: number; // 0-10, one decimal
  evidence: string; // specific resume evidence supporting this score
}

/** All scores for a candidate — overallScore computed in code, not by the model */
export interface CandidateScores {
  criterionScores: CriterionScore[];
}

export interface Candidate {
  id: string;
  greenhouseId?: number;
  greenhouseUrl?: string;
  name: string;
  email: string;
  currentRole: string;
  currentCompany: string;
  scores: CandidateScores;
  overallScore: number;
  tier: Tier;
  strengths: string[];
  gaps: string[];
  resumeFilename?: string;
  applicationStatus?: string;
  currentStage?: string;
  appliedAt?: string;
  source?: string;
}

export interface CandidateArtifact {
  id: string;
  greenhouseId: number;
  greenhouseUrl: string;
  name: string;
  email: string;
  company: string;
  title: string;
  updatedAt: string;
  applicationStatus: string;
  currentStage: string;
  appliedAt: string;
  source: string;
  resumeFilename: string | null;
  resumeAttachmentUrl: string | null;
  resumeAttachmentCreatedAt: string | null;
  resumeMimeType: string | null;
  resumeBase64: string | null;
  resumeText: string | null;
  resumeFingerprint: string | null;
  parseQuality: ParseQuality;
  resumeCacheKey?: string;
}

export interface TriageDecision {
  bucket: TriageBucket;
  confidence: number;
  needsFullScore: boolean;
  rationale: string;
  currentRole: string;
  currentCompany: string;
}

export interface CandidateReviewState {
  candidateId: string;
  candidateName: string;
  state: CandidateReviewLifecycle;
  parseQuality: ParseQuality;
  cacheHit?: boolean;
  escalated?: boolean;
  triageDecision: TriageDecision | null;
  fullScore: Candidate | null;
  failure: string | null;
  audited: boolean;
  updatedAt: string;
}

export interface ScreeningRunCounts {
  total: number;
  processed: number;
  triagedLikelyNo: number;
  escalated: number;
  fullyScored: number;
  failed: number;
  audited: number;
  cached: number;
}

export interface ScreeningRunAuditSummary {
  sampled: number;
  disagreements: number;
  strongSignalsFound: number;
  escalatedLikelyNoBucket: boolean;
  details?: Array<{
    candidateId: string;
    triageBucket: TriageBucket;
    triageConfidence: number;
    overallScore: number;
    disagreement: boolean;
  }>;
}

export interface ScreeningRunFailure {
  candidateId: string;
  candidateName: string;
  message: string;
}

export interface ScreeningRunSummary {
  id: string;
  jobId: number;
  jobTitle: string;
  mode: ScreeningRunMode;
  provider: ProviderName;
  rubricVersion: string;
  calibrationVersion: string | null;
  status: ScreeningRunStatus;
  counts: ScreeningRunCounts;
  audit: ScreeningRunAuditSummary;
  failures: ScreeningRunFailure[];
  currentActivity: string | null;
  fullyScored: Candidate[];
  likelyNo: Array<{
    candidateId: string;
    name: string;
    currentRole: string;
    currentCompany: string;
    confidence: number;
    rationale: string;
    audited: boolean;
  }>;
  startedAt: string;
  finishedAt: string | null;
  lastUpdatedAt: string;
}

export interface ScreeningRunListSummary {
  id: string;
  jobId: number;
  jobTitle: string;
  mode: ScreeningRunMode;
  provider: ProviderName;
  status: ScreeningRunStatus;
  startedAt: string;
  finishedAt: string | null;
  counts: {
    total: number;
    processed: number;
    fullyScored: number;
    failed: number;
    triagedLikelyNo: number;
  };
  rubricVersion: string;
  calibrationVersion: string | null;
}

export interface ScreeningRunRubric {
  rubric: ScoringRubric;
  idealPatterns: IdealPatterns | null;
}

export interface RunsResponse {
  runs: ScreeningRunListSummary[];
}

export interface RunDetailResponse {
  run: ScreeningRunSummary;
  rubric: ScreeningRunRubric | null;
}

export interface SavedRubricSummary {
  rubricVersion: string;
  calibrationVersion: string | null;
  jobTitle: string;
  createdAt: string;
  criteriaNames: string[];
  calibrated: boolean;
  rubric: ScoringRubric;
  idealPatterns: IdealPatterns | null;
}

export interface RubricsResponse {
  rubrics: SavedRubricSummary[];
}

// ---- Calibration Patterns (unchanged) ----

export interface IdealPatterns {
  commonSkills: { skill: string; frequency: 'all' | 'most' | 'some' }[];
  careerPatterns: { pattern: string; frequency: 'all' | 'most' | 'some' }[];
  achievementSignals: { signal: string; examples: string[] }[];
}

// ---- Session ----

export interface ScreeningSession {
  jobTitle: string;
  jobDescription: string;
  intakeNotes: string;
  rubricIntakeNotes: string | null;
  greenhouseJobId?: number;
  rubric: ScoringRubric | null;
  rubricVersion?: string | null;
  idealPatterns: IdealPatterns | null;
  calibrationVersion?: string | null;
  candidates: Candidate[];
  status: 'setup' | 'calibrating' | 'scoring' | 'results';
}

// Greenhouse job for the job selector
export interface GreenhouseJob {
  id: number;
  name: string;
  status: string;
  department: string;
  office: string;
  openings: number;
  opened_at: string;
}
