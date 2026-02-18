export type Tier = 'top' | 'strong' | 'moderate' | 'below';

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

/** All scores for a candidate — overallScore computed in code, not by Claude */
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
  yearsExperience: number;
  scores: CandidateScores;
  overallScore: number;
  tier: Tier;
  strengths: string[];
  gaps: string[];
  reasoning: string;
  resumeFilename?: string;
  applicationStatus?: string;
  currentStage?: string;
  appliedAt?: string;
  source?: string;
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
  greenhouseJobId?: number;
  rubric: ScoringRubric | null;
  idealPatterns: IdealPatterns | null;
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
