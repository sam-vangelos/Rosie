import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CockpitState,
  cockpitReducer,
  createInitialCockpitState,
  filterCandidates,
  progressPhaseForRunStatus,
} from '../src/lib/cockpit-session';
import type {
  Candidate,
  ScoringRubric,
  ScreeningRunStatus,
  ScreeningRunSummary,
} from '../src/lib/types';

const rubric: ScoringRubric = {
  criteria: [
    {
      id: 'systems',
      name: 'Systems',
      description: 'Builds reliable systems',
      weight: 100,
      scoringGuide: { high: 'Excellent', mid: 'Adequate', low: 'Limited' },
    },
  ],
  tableStakes: ['TypeScript'],
};

function candidate(id: string, tier: Candidate['tier'], overrides: Partial<Candidate> = {}): Candidate {
  return {
    id,
    name: `Candidate ${id}`,
    email: `${id}@example.com`,
    currentRole: 'Engineer',
    currentCompany: 'ExampleCo',
    scores: { criterionScores: [] },
    overallScore: 8,
    tier,
    strengths: [],
    gaps: [],
    ...overrides,
  };
}

function runSummary(overrides: Partial<ScreeningRunSummary> = {}): ScreeningRunSummary {
  return {
    id: 'run-1',
    jobId: 42,
    jobTitle: 'Staff Engineer',
    mode: 'new_or_changed',
    provider: 'claude-agent',
    rubricVersion: 'rv-1',
    calibrationVersion: 'cv-1',
    status: 'triaging',
    counts: {
      total: 10,
      processed: 4,
      triagedLikelyNo: 2,
      escalated: 1,
      fullyScored: 2,
      failed: 1,
      audited: 0,
      cached: 1,
    },
    audit: { sampled: 0, disagreements: 0, strongSignalsFound: 0, escalatedLikelyNoBucket: false },
    failures: [],
    currentActivity: 'Triaging 4 of 10',
    fullyScored: [candidate('c1', 'top')],
    likelyNo: [],
    startedAt: '2026-08-01T00:00:00.000Z',
    finishedAt: null,
    lastUpdatedAt: '2026-08-01T00:05:00.000Z',
    ...overrides,
  };
}

function withRubric(state: CockpitState): CockpitState {
  return cockpitReducer(state, {
    type: 'rubric_ready',
    rubric,
    rubricVersion: 'rv-1',
    calibrationVersion: null,
    idealPatterns: null,
    rubricIntakeNotes: null,
    outcome: 'idle',
  });
}

describe('progressPhaseForRunStatus', () => {
  it('maps run statuses onto the three progress phases', () => {
    assert.equal(progressPhaseForRunStatus('queued'), 'fetching-candidates');
    assert.equal(progressPhaseForRunStatus('fetching'), 'fetching-candidates');
    assert.equal(progressPhaseForRunStatus('processing'), 'processing-resumes');
    for (const status of ['triaging', 'full_scoring', 'auditing', 'completed'] as ScreeningRunStatus[]) {
      assert.equal(progressPhaseForRunStatus(status), 'scoring');
    }
  });
});

describe('cockpitReducer rubric flow', () => {
  it('rubric_ready moves to Calibrate and clears every result of the previous rubric', () => {
    let state = createInitialCockpitState();
    state = {
      ...state,
      selectedCandidates: new Set(['stale']),
      calibrationFiles: [new File(['x'], 'old.pdf')],
      calibrationError: 'stale error',
    };
    state = withRubric(state);

    assert.equal(state.currentStep, 2);
    assert.equal(state.session.status, 'calibrating');
    assert.equal(state.session.rubric, rubric);
    assert.equal(state.session.candidates.length, 0);
    assert.equal(state.selectedCandidates.size, 0);
    assert.equal(state.calibrationFiles.length, 0);
    assert.equal(state.calibrationError, null);
    assert.equal(state.activeRunId, null);
  });

  it('job_selected preserves intake grounding only when reselecting the same job', () => {
    let state = createInitialCockpitState();
    state = cockpitReducer(state, { type: 'job_selected', jobId: 42, jobName: 'Staff Engineer' });
    state = { ...state, session: { ...state.session, rubricIntakeNotes: 'must-haves' } };

    const sameJob = cockpitReducer(state, { type: 'job_selected', jobId: 42, jobName: 'Staff Engineer' });
    assert.equal(sameJob.session.rubricIntakeNotes, 'must-haves');

    const otherJob = cockpitReducer(state, { type: 'job_selected', jobId: 43, jobName: 'Platform Engineer' });
    assert.equal(otherJob.session.rubricIntakeNotes, null);
    assert.equal(otherJob.candidatePreview, null);
  });
});

describe('cockpitReducer scoring lifecycle', () => {
  it('runs the started → created → progress → completed sequence', () => {
    let state = withRubric(createInitialCockpitState());

    state = cockpitReducer(state, { type: 'scoring_started' });
    assert.equal(state.currentStep, 3);
    assert.equal(state.session.status, 'scoring');
    assert.equal(state.isScoring, true);
    assert.equal(state.isFetchingCandidates, true);
    assert.equal(state.scoringProgress.current, 'Creating server-side screening run...');

    const run = runSummary();
    state = cockpitReducer(state, {
      type: 'run_created',
      run,
      rubric: { rubric, idealPatterns: null },
    });
    assert.equal(state.activeRunId, 'run-1');

    state = cockpitReducer(state, { type: 'run_progress', run });
    assert.equal(state.session.status, 'scoring');
    assert.equal(state.scoringProgress.completed, 4);
    assert.equal(state.scoringProgress.phase, 'scoring');
    assert.equal(state.isFetchingCandidates, false);
    assert.deepEqual(state.session.candidates.map((c) => c.id), ['c1']);

    state = cockpitReducer(state, {
      type: 'run_progress',
      run: runSummary({ status: 'completed', counts: { ...run.counts, processed: 10 } }),
    });
    assert.equal(state.currentStep, 4);
    assert.equal(state.session.status, 'results');
    assert.equal(state.isScoring, false);
    assert.equal(state.activeRunId, null);
  });

  it('a failed run lands back on Calibrate with the run activity as the error', () => {
    let state = withRubric(createInitialCockpitState());
    state = cockpitReducer(state, { type: 'scoring_started' });
    state = cockpitReducer(state, {
      type: 'run_progress',
      run: runSummary({ status: 'failed', currentActivity: 'Greenhouse fetch failed' }),
    });
    assert.equal(state.currentStep, 2);
    assert.equal(state.session.status, 'calibrating');
    assert.equal(state.error, 'Greenhouse fetch failed');
    assert.equal(state.isScoring, false);
    assert.equal(state.activeRunId, null);
  });

  it('scoring_canceled resets progress and returns to Calibrate', () => {
    let state = withRubric(createInitialCockpitState());
    state = cockpitReducer(state, { type: 'scoring_started' });
    state = cockpitReducer(state, { type: 'scoring_canceled' });
    assert.equal(state.currentStep, 2);
    assert.equal(state.session.status, 'calibrating');
    assert.deepEqual(state.scoringProgress, {
      completed: 0,
      total: 0,
      current: '',
      failed: 0,
      phase: 'fetching-candidates',
    });
  });
});

describe('cockpitReducer run_opened', () => {
  it('opens a completed run on Results with the run identity adopted', () => {
    const state = cockpitReducer(createInitialCockpitState(), {
      type: 'run_opened',
      run: runSummary({ status: 'completed' }),
      rubric: { rubric, idealPatterns: null },
    });
    assert.equal(state.currentStep, 4);
    assert.equal(state.session.status, 'results');
    assert.equal(state.selectedJobId, 42);
    assert.equal(state.provider, 'claude-agent');
    assert.equal(state.calibrationOutcome, 'calibrated');
    assert.equal(state.resumeBannerDismissed, true);
    assert.equal(state.isScoring, false);
  });

  it('opens an in-flight run on the Scoring step, still polling', () => {
    const state = cockpitReducer(createInitialCockpitState(), {
      type: 'run_opened',
      run: runSummary({ status: 'fetching' }),
      rubric: null,
    });
    assert.equal(state.currentStep, 3);
    assert.equal(state.session.status, 'scoring');
    assert.equal(state.isScoring, true);
    assert.equal(state.isFetchingCandidates, true);
    assert.equal(state.calibrationOutcome, 'calibrated');
  });

  it('ignores canceled and failed runs entirely', () => {
    const initial = createInitialCockpitState();
    for (const status of ['canceled', 'failed'] as ScreeningRunStatus[]) {
      const state = cockpitReducer(initial, {
        type: 'run_opened',
        run: runSummary({ status }),
        rubric: null,
      });
      assert.equal(state, initial);
    }
  });
});

describe('cockpitReducer calibration', () => {
  it('accepts only resume file types and caps the list at ten', () => {
    let state = createInitialCockpitState();
    const files = [
      new File(['x'], 'resume.pdf'),
      new File(['x'], 'resume.docx'),
      new File(['x'], 'malware.exe'),
      new File(['x'], 'notes.txt'),
    ];
    state = cockpitReducer(state, { type: 'calibration_files_added', files });
    assert.deepEqual(state.calibrationFiles.map((f) => f.name), [
      'resume.pdf',
      'resume.docx',
      'notes.txt',
    ]);

    const bulk = Array.from({ length: 12 }, (_, i) => new File(['x'], `r${i}.pdf`));
    state = cockpitReducer(state, { type: 'calibration_files_added', files: bulk });
    assert.equal(state.calibrationFiles.length, 10);
  });

  it('a calibrated rubric flips the outcome; a patterns-only result keeps the rubric and explains', () => {
    const base = withRubric(createInitialCockpitState());
    const patterns = { commonSkills: [], careerPatterns: [], achievementSignals: [] };
    const basis = { targetStage: 'Onsite', exemplars: [] };

    const calibrated = cockpitReducer(base, {
      type: 'calibration_completed',
      response: {
        ...basis,
        patterns,
        calibratedRubric: { ...rubric, calibrationSummary: 'Raised the bar' },
        calibrationVersion: 'cv-2',
      },
    });
    assert.equal(calibrated.calibrationOutcome, 'calibrated');
    assert.equal(calibrated.session.calibrationVersion, 'cv-2');
    assert.equal(calibrated.session.rubric?.calibrationSummary, 'Raised the bar');

    const patternsOnly = cockpitReducer(base, {
      type: 'calibration_completed',
      response: { ...basis, patterns, calibratedRubric: null, calibrationVersion: null },
    });
    assert.equal(patternsOnly.calibrationOutcome, 'patterns_only');
    assert.equal(patternsOnly.session.rubric, rubric);
    assert.match(patternsOnly.calibrationError || '', /rubric calibration failed/);

    const skipped = cockpitReducer(base, {
      type: 'calibration_completed',
      response: { ...basis, skipped: true, reason: 'Too few exemplars' },
    });
    assert.equal(skipped.calibrationBasis?.reason, 'Too few exemplars');
    assert.equal(skipped.session.idealPatterns, null);
    assert.equal(skipped.calibrationOutcome, 'idle');
  });
});

describe('cockpitReducer navigation', () => {
  it('step_back never moves forward', () => {
    const state = withRubric(createInitialCockpitState());
    assert.equal(cockpitReducer(state, { type: 'step_back', step: 3 }), state);
    const back = cockpitReducer(state, { type: 'step_back', step: 1 });
    assert.equal(back.currentStep, 1);
    assert.equal(back.session.status, 'setup');
  });

  it('confirming the start-over dialog resets the session but keeps the provider choice', () => {
    let state = withRubric(createInitialCockpitState());
    state = cockpitReducer(state, { type: 'provider_changed', provider: 'codex-agent' });
    state = cockpitReducer(state, { type: 'nav_requested', nav: { step: 1, status: 'setup' } });
    state = cockpitReducer(state, { type: 'nav_confirmed' });

    assert.equal(state.currentStep, 1);
    assert.equal(state.session.status, 'setup');
    assert.equal(state.session.rubric, null);
    assert.equal(state.provider, 'codex-agent');
    assert.equal(state.pendingNav, null);
  });

  it('confirming a back-to-calibrate navigation keeps results in memory', () => {
    let state = withRubric(createInitialCockpitState());
    state = cockpitReducer(state, {
      type: 'run_opened',
      run: runSummary({ status: 'completed' }),
      rubric: { rubric, idealPatterns: null },
    });
    state = cockpitReducer(state, { type: 'nav_requested', nav: { step: 2, status: 'calibrating' } });
    state = cockpitReducer(state, { type: 'nav_confirmed' });
    assert.equal(state.currentStep, 2);
    assert.equal(state.session.status, 'calibrating');
    assert.equal(state.session.candidates.length, 1);
  });
});

describe('selection and search', () => {
  it('toggles individual candidates and applies tier bulk selection', () => {
    let state = createInitialCockpitState();
    state = cockpitReducer(state, { type: 'selection_toggled', id: 'c1' });
    assert.deepEqual([...state.selectedCandidates], ['c1']);
    state = cockpitReducer(state, { type: 'selection_toggled', id: 'c1' });
    assert.equal(state.selectedCandidates.size, 0);

    state = cockpitReducer(state, { type: 'selection_bulk', action: 'select', ids: ['a', 'b'] });
    assert.deepEqual([...state.selectedCandidates].sort(), ['a', 'b']);
    state = cockpitReducer(state, { type: 'selection_bulk', action: 'deselect', ids: ['a'] });
    assert.deepEqual([...state.selectedCandidates], ['b']);
  });

  it('filterCandidates matches name, role, and company case-insensitively in rank order', () => {
    const candidates = [
      candidate('c1', 'top', { name: 'Ada Lovelace' }),
      candidate('c2', 'strong', { currentRole: 'Data Engineer' }),
      candidate('c3', 'moderate', { currentCompany: 'Adacorp' }),
      candidate('c4', 'below', { name: 'Grace Hopper' }),
    ];
    assert.deepEqual(filterCandidates(candidates, 'ada').map((c) => c.id), ['c1', 'c3']);
    assert.deepEqual(filterCandidates(candidates, 'ENGINEER').map((c) => c.id), ['c1', 'c2', 'c3', 'c4']);
    assert.equal(filterCandidates(candidates, '  ').length, 4);
  });
});
