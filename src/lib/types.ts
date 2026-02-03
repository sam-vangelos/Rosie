export type Tier = 'top' | 'strong' | 'moderate' | 'below';

export interface CandidateScore {
  technical: number;
  experience: number;
  alignment: number;
  growth: number;
}

export interface Candidate {
  id: string;
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
  rubric: ScoringRubric | null;
  idealPatterns: IdealPatterns | null;
  candidates: Candidate[];
  status: 'setup' | 'calibrating' | 'scoring' | 'results';
}
