export type Tier = 'top' | 'strong' | 'moderate' | 'below';

export interface CandidateScore {
  technical: number;
  experience: number;
  alignment: number;
  growth: number;
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
  scores: CandidateScore;
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

export interface RubricItem {
  requirement: string;
  weight: number;
  flexibility?: string;
}

export interface ScoringRubric {
  mustHaves: RubricItem[];
  niceToHaves: RubricItem[];
  hiddenPreferences: { preference: string; source: string }[];
  seniorityTarget: string;
}

export interface IdealPatterns {
  commonSkills: { skill: string; frequency: 'all' | 'most' | 'some' }[];
  careerPatterns: { pattern: string; frequency: 'all' | 'most' | 'some' }[];
  achievementSignals: { signal: string; examples: string[] }[];
}

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
