import {
  Candidate,
  IdealPatterns,
  ScoringRubric,
  ScreeningRunListSummary,
  ScreeningRunRubric,
  ScreeningRunStatus,
  ScreeningRunSummary,
  ScreeningSession,
} from './types';
import type { ProviderName } from './providers/types';
import { applyTierSelection } from './selection';

export const terminalRunStatuses = new Set<ScreeningRunStatus>([
  'completed',
  'canceled',
  'failed',
]);

export function isTerminalRun(run: ScreeningRunListSummary): boolean {
  return terminalRunStatuses.has(run.status);
}

export type ScoringPhase = 'fetching-candidates' | 'processing-resumes' | 'scoring';

export function progressPhaseForRunStatus(status: ScreeningRunStatus): ScoringPhase {
  if (status === 'queued' || status === 'fetching') return 'fetching-candidates';
  if (status === 'processing') return 'processing-resumes';
  return 'scoring';
}

export interface CalibrationBasis {
  targetStage: string;
  exemplars: Array<{ name: string; stage: string; status: string }>;
  reason?: string;
}

export interface CompletedCalibrationResponse extends CalibrationBasis {
  skipped?: false;
  patterns: IdealPatterns;
  calibratedRubric: ScoringRubric | null;
  calibrationVersion: string | null;
}

export type CalibrationResponse =
  | CompletedCalibrationResponse
  | (CalibrationBasis & { skipped: true; reason: string });

export type CalibrationOutcome =
  | 'idle'
  | 'intake_grounded'
  | 'patterns_only'
  | 'calibrated';

export interface ScoringProgressState {
  completed: number;
  total: number;
  current: string;
  failed: number;
  phase: ScoringPhase;
}

const initialScoringProgress: ScoringProgressState = {
  completed: 0,
  total: 0,
  current: '',
  failed: 0,
  phase: 'fetching-candidates',
};

export function createInitialSession(): ScreeningSession {
  return {
    jobTitle: '',
    jobDescription: '',
    intakeNotes: '',
    rubricIntakeNotes: null,
    rubric: null,
    rubricVersion: null,
    idealPatterns: null,
    calibrationVersion: null,
    candidates: [],
    status: 'setup',
  };
}

export interface PendingNav {
  step: number;
  status: ScreeningSession['status'];
}

/**
 * Every piece of state that more than one workflow step reads or writes.
 * Purely step-local UI state (drag hover, search-box text for the job list,
 * disclosure toggles) stays in the step components; purely request-local
 * loading flags stay with the code issuing the request.
 */
export interface CockpitState {
  session: ScreeningSession;
  currentStep: number;
  selectedJobId: number | null;
  provider: ProviderName;
  selectedCandidates: Set<string>;
  candidateSearchQuery: string;
  scoringProgress: ScoringProgressState;
  activeRunId: string | null;
  activeRun: ScreeningRunSummary | null;
  isScoring: boolean;
  isFetchingCandidates: boolean;
  calibrationFiles: File[];
  calibrationOutcome: CalibrationOutcome;
  calibrationError: string | null;
  calibrationBasis: CalibrationBasis | null;
  candidatePreview: { total: number; withResumes: number } | null;
  resumeBannerDismissed: boolean;
  pendingNav: PendingNav | null;
  error: string | null;
}

export function createInitialCockpitState(): CockpitState {
  return {
    session: createInitialSession(),
    currentStep: 1,
    selectedJobId: null,
    provider: 'api',
    selectedCandidates: new Set(),
    candidateSearchQuery: '',
    scoringProgress: initialScoringProgress,
    activeRunId: null,
    activeRun: null,
    isScoring: false,
    isFetchingCandidates: false,
    calibrationFiles: [],
    calibrationOutcome: 'idle',
    calibrationError: null,
    calibrationBasis: null,
    candidatePreview: null,
    resumeBannerDismissed: false,
    pendingNav: null,
    error: null,
  };
}

export type CockpitAction =
  | { type: 'job_selected'; jobId: number; jobName: string | null }
  | { type: 'job_description_loaded'; text: string }
  | { type: 'session_field_set'; field: 'jobDescription' | 'intakeNotes'; value: string }
  | { type: 'provider_changed'; provider: ProviderName }
  | {
      type: 'rubric_ready';
      rubric: ScoringRubric;
      rubricVersion: string | null;
      calibrationVersion: string | null;
      idealPatterns: IdealPatterns | null;
      rubricIntakeNotes: string | null;
      outcome: CalibrationOutcome;
    }
  | { type: 'run_opened'; run: ScreeningRunSummary; rubric: ScreeningRunRubric | null }
  | { type: 'scoring_started' }
  | { type: 'run_created'; run: ScreeningRunSummary; rubric: ScreeningRunRubric }
  | { type: 'run_create_failed'; message: string }
  | { type: 'run_progress'; run: ScreeningRunSummary }
  | { type: 'poll_failed'; message: string }
  | { type: 'scoring_canceled' }
  | { type: 'calibration_files_added'; files: File[] }
  | { type: 'calibration_file_removed'; index: number }
  | { type: 'calibration_started' }
  | { type: 'calibration_completed'; response: CalibrationResponse }
  | { type: 'calibration_failed'; message: string }
  | { type: 'calibration_retrained' }
  | { type: 'intake_grounding_chosen' }
  | { type: 'intake_grounding_cleared' }
  | { type: 'preview_loaded'; preview: { total: number; withResumes: number } }
  | { type: 'selection_toggled'; id: string }
  | { type: 'selection_bulk'; action: 'select' | 'deselect'; ids: string[] }
  | { type: 'search_changed'; query: string }
  | { type: 'step_back'; step: number }
  | { type: 'nav_requested'; nav: PendingNav }
  | { type: 'nav_canceled' }
  | { type: 'nav_confirmed' }
  | { type: 'error_set'; message: string }
  | { type: 'error_dismissed' }
  | { type: 'banner_dismissed' }
  | { type: 'banner_reset' };

const CALIBRATION_FILE_EXTENSIONS = ['.pdf', '.docx', '.doc', '.txt'];
const CALIBRATION_MAX_FILES = 10;

function acceptCalibrationFiles(existing: File[], added: File[]): File[] {
  const accepted = added.filter((file) => {
    const name = file.name.toLowerCase();
    return CALIBRATION_FILE_EXTENSIONS.some((ext) => name.endsWith(ext));
  });
  return [...existing, ...accepted].slice(0, CALIBRATION_MAX_FILES);
}

function progressForRun(run: ScreeningRunSummary): ScoringProgressState {
  return {
    completed: run.counts.processed,
    total: run.counts.total,
    current: run.currentActivity || '',
    failed: run.counts.failed,
    phase: progressPhaseForRunStatus(run.status),
  };
}

export function cockpitReducer(state: CockpitState, action: CockpitAction): CockpitState {
  switch (action.type) {
    case 'job_selected': {
      const next: CockpitState = {
        ...state,
        candidatePreview: null,
        selectedJobId: action.jobId,
      };
      if (action.jobName === null) return next;
      return {
        ...next,
        session: {
          ...state.session,
          jobTitle: action.jobName,
          greenhouseJobId: action.jobId,
          rubricIntakeNotes:
            state.session.greenhouseJobId === action.jobId
              ? state.session.rubricIntakeNotes
              : null,
        },
      };
    }

    case 'job_description_loaded':
      return {
        ...state,
        session: { ...state.session, jobDescription: action.text },
      };

    case 'session_field_set':
      return {
        ...state,
        session: { ...state.session, [action.field]: action.value },
      };

    case 'provider_changed':
      return { ...state, provider: action.provider };

    case 'rubric_ready':
      return {
        ...state,
        session: {
          ...state.session,
          rubric: action.rubric,
          rubricVersion: action.rubricVersion,
          calibrationVersion: action.calibrationVersion,
          idealPatterns: action.idealPatterns,
          rubricIntakeNotes: action.rubricIntakeNotes,
          candidates: [],
          status: 'calibrating',
        },
        activeRun: null,
        activeRunId: null,
        selectedCandidates: new Set(),
        calibrationFiles: [],
        calibrationOutcome: action.outcome,
        calibrationError: null,
        calibrationBasis: null,
        currentStep: 2,
      };

    case 'run_opened': {
      const { run, rubric } = action;
      const inProgress = !terminalRunStatuses.has(run.status);
      if (!inProgress && run.status !== 'completed') return state;
      return {
        ...state,
        session: {
          ...state.session,
          jobTitle: run.jobTitle,
          greenhouseJobId: run.jobId,
          rubric: rubric?.rubric || null,
          rubricVersion: run.rubricVersion,
          calibrationVersion: run.calibrationVersion,
          idealPatterns: rubric?.idealPatterns || null,
          rubricIntakeNotes: null,
          candidates: run.fullyScored,
          status: inProgress ? 'scoring' : 'results',
        },
        selectedJobId: run.jobId,
        provider: run.provider,
        activeRunId: run.id,
        activeRun: run,
        selectedCandidates: new Set(),
        candidateSearchQuery: '',
        calibrationFiles: [],
        calibrationError: null,
        calibrationBasis: null,
        calibrationOutcome: run.calibrationVersion
          ? 'calibrated'
          : rubric?.idealPatterns
            ? 'patterns_only'
            : 'idle',
        resumeBannerDismissed: true,
        isScoring: inProgress,
        isFetchingCandidates:
          inProgress && (run.status === 'queued' || run.status === 'fetching'),
        scoringProgress: progressForRun(run),
        currentStep: inProgress ? 3 : 4,
      };
    }

    case 'scoring_started':
      return {
        ...state,
        currentStep: 3,
        session: { ...state.session, status: 'scoring', candidates: [] },
        activeRun: null,
        activeRunId: null,
        isScoring: true,
        isFetchingCandidates: true,
        selectedCandidates: new Set(),
        error: null,
        scoringProgress: {
          ...initialScoringProgress,
          current: 'Creating server-side screening run...',
        },
      };

    case 'run_created':
      return {
        ...state,
        session: {
          ...state.session,
          rubric: action.rubric.rubric,
          idealPatterns: action.rubric.idealPatterns,
        },
        activeRun: action.run,
        activeRunId: action.run.id,
      };

    case 'run_create_failed':
      return {
        ...state,
        isScoring: false,
        isFetchingCandidates: false,
        currentStep: 2,
        session: { ...state.session, status: 'calibrating' },
        error: action.message,
      };

    case 'run_progress': {
      const { run } = action;
      const next: CockpitState = {
        ...state,
        activeRun: run,
        session: {
          ...state.session,
          candidates: run.fullyScored,
          status:
            run.status === 'completed'
              ? 'results'
              : run.status === 'failed'
                ? 'calibrating'
                : 'scoring',
        },
        scoringProgress: progressForRun(run),
        isFetchingCandidates: run.status === 'queued' || run.status === 'fetching',
      };
      if (run.status === 'completed') {
        return { ...next, isScoring: false, currentStep: 4, activeRunId: null };
      }
      if (run.status === 'failed') {
        return {
          ...next,
          isScoring: false,
          activeRunId: null,
          currentStep: 2,
          error: run.currentActivity || 'Scoring run failed',
        };
      }
      if (run.status === 'canceled') {
        return { ...next, isScoring: false, activeRunId: null };
      }
      return next;
    }

    case 'poll_failed':
      return {
        ...state,
        isScoring: false,
        activeRunId: null,
        currentStep: 2,
        session: { ...state.session, status: 'calibrating' },
        error: action.message,
      };

    case 'scoring_canceled':
      return {
        ...state,
        activeRun: null,
        activeRunId: null,
        isScoring: false,
        isFetchingCandidates: false,
        currentStep: 2,
        session: { ...state.session, status: 'calibrating', candidates: [] },
        scoringProgress: initialScoringProgress,
      };

    case 'calibration_files_added':
      return {
        ...state,
        calibrationFiles: acceptCalibrationFiles(state.calibrationFiles, action.files),
        calibrationError: null,
      };

    case 'calibration_file_removed':
      return {
        ...state,
        calibrationFiles: state.calibrationFiles.filter((_, i) => i !== action.index),
      };

    case 'calibration_started':
      return { ...state, calibrationError: null, calibrationBasis: null };

    case 'calibration_completed': {
      const { response } = action;
      if (response.skipped) return { ...state, calibrationBasis: response };
      return {
        ...state,
        calibrationBasis: response,
        session: {
          ...state.session,
          idealPatterns: response.patterns,
          rubric: response.calibratedRubric || state.session.rubric,
          calibrationVersion:
            response.calibrationVersion || state.session.calibrationVersion || null,
          candidates: [],
        },
        activeRun: null,
        activeRunId: null,
        selectedCandidates: new Set(),
        calibrationOutcome: response.calibratedRubric ? 'calibrated' : 'patterns_only',
        calibrationError: response.calibratedRubric
          ? state.calibrationError
          : 'Pattern extraction succeeded, but rubric calibration failed. ' +
            'Scoring will use the original rubric without calibration adjustments.',
      };
    }

    case 'calibration_failed':
      return { ...state, calibrationError: action.message };

    case 'calibration_retrained':
      return {
        ...state,
        session: { ...state.session, idealPatterns: null, calibrationVersion: null },
        calibrationFiles: [],
        calibrationOutcome: 'idle',
        calibrationError: null,
        calibrationBasis: null,
      };

    case 'intake_grounding_chosen':
      return {
        ...state,
        calibrationBasis: null,
        calibrationError: null,
        calibrationOutcome: 'intake_grounded',
      };

    case 'intake_grounding_cleared':
      return { ...state, calibrationOutcome: 'idle' };

    case 'preview_loaded':
      return { ...state, candidatePreview: action.preview };

    case 'selection_toggled': {
      const next = new Set(state.selectedCandidates);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return { ...state, selectedCandidates: next };
    }

    case 'selection_bulk':
      return {
        ...state,
        selectedCandidates: applyTierSelection(
          state.selectedCandidates,
          action.action,
          action.ids
        ),
      };

    case 'search_changed':
      return { ...state, candidateSearchQuery: action.query };

    case 'step_back': {
      if (action.step >= state.currentStep) return state;
      let session = state.session;
      if (action.step === 1) session = { ...session, status: 'setup' };
      if (action.step === 2) session = { ...session, status: 'calibrating' };
      return { ...state, currentStep: action.step, session };
    }

    case 'nav_requested':
      return { ...state, pendingNav: action.nav };

    case 'nav_canceled':
      return { ...state, pendingNav: null };

    case 'nav_confirmed': {
      if (!state.pendingNav) return state;
      if (state.pendingNav.step === 1) {
        return {
          ...state,
          session: createInitialSession(),
          currentStep: 1,
          selectedCandidates: new Set(),
          selectedJobId: null,
          scoringProgress: initialScoringProgress,
          candidateSearchQuery: '',
          calibrationOutcome: 'idle',
          calibrationFiles: [],
          calibrationError: null,
          calibrationBasis: null,
          candidatePreview: null,
          activeRun: null,
          activeRunId: null,
          pendingNav: null,
        };
      }
      return {
        ...state,
        currentStep: state.pendingNav.step || 2,
        session: { ...state.session, status: state.pendingNav.status || 'calibrating' },
        pendingNav: null,
      };
    }

    case 'error_set':
      return { ...state, error: action.message };

    case 'error_dismissed':
      return { ...state, error: null };

    case 'banner_dismissed':
      return { ...state, resumeBannerDismissed: true };

    case 'banner_reset':
      return { ...state, resumeBannerDismissed: false };
  }
}

/** Candidates matching the results search box, in original rank order. */
export function filterCandidates(candidates: Candidate[], query: string): Candidate[] {
  if (!query.trim()) return candidates;
  const lowered = query.toLowerCase();
  return candidates.filter(
    (c) =>
      c.name.toLowerCase().includes(lowered) ||
      c.currentRole?.toLowerCase().includes(lowered) ||
      c.currentCompany?.toLowerCase().includes(lowered)
  );
}
