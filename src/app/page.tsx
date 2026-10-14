'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  GreenhouseJob,
  RubricsResponse,
  RunDetailResponse,
  RunsResponse,
  SavedRubricSummary,
  ScoringRubric,
  ScreeningRunListSummary,
  ScreeningRunMode,
  ScreeningRunRubric,
  ScreeningRunSummary,
} from '@/lib/types';
import type { ProviderName } from '@/lib/providers/types';
import {
  CalibrationResponse,
  cockpitReducer,
  createInitialCockpitState,
  isTerminalRun,
  terminalRunStatuses,
} from '@/lib/cockpit-session';
import { cn, qualifyIntakeNotes } from '@/lib/utils';
import { StepIndicator } from '@/components/StepIndicator';
import { SetupStep } from '@/components/cockpit/SetupStep';
import { CalibrateStep } from '@/components/cockpit/CalibrateStep';
import { ScoringStep } from '@/components/cockpit/ScoringStep';
import { ResultsStep } from '@/components/cockpit/ResultsStep';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { AlertTriangle, Loader2, X } from 'lucide-react';

const steps = [
  { label: 'Setup', description: 'JD + intake notes' },
  { label: 'Calibrate', description: 'Few-shot training' },
  { label: 'Score', description: 'AI evaluation' },
  { label: 'Results', description: 'Review & act' },
];

async function parseJsonResponse<T>(
  res: Response,
  fallbackError: string
): Promise<T> {
  const responseText = await res.text();
  if (!res.ok) {
    let errorMessage = fallbackError;
    try {
      const parsed = JSON.parse(responseText);
      errorMessage = parsed.error || errorMessage;
    } catch {
      if (responseText) errorMessage = `Server error: ${responseText.slice(0, 200)}`;
    }
    throw new Error(errorMessage);
  }
  try {
    return JSON.parse(responseText) as T;
  } catch {
    throw new Error(`Invalid response from server: ${responseText.slice(0, 200)}`);
  }
}

export default function Home() {
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);

  // Resolve the IAP identity, or the automatic local-development identity.
  useEffect(() => {
    let redirectingViewer = false;
    fetch('/api/auth/check')
      .then(async (res) => {
        if (!res.ok) return;
        const identity = (await res.json()) as { role?: string };
        if (identity.role === 'viewer') {
          redirectingViewer = true;
          router.replace('/runs');
          return;
        }
        setIsAuthenticated(true);
      })
      .catch(() => {})
      .finally(() => {
        if (!redirectingViewer) setAuthChecking(false);
      });
  }, [router]);

  const [state, dispatch] = useReducer(
    cockpitReducer,
    undefined,
    createInitialCockpitState
  );

  // Data the cockpit loads for its own chrome, outside the session machine.
  const [ghJobs, setGhJobs] = useState<GreenhouseJob[]>([]);
  const [ghJobsLoading, setGhJobsLoading] = useState(false);
  const [recentRuns, setRecentRuns] = useState<ScreeningRunListSummary[]>([]);
  const [providers, setProviders] = useState<ProviderName[]>(['api']);
  const [savedRubrics, setSavedRubrics] = useState<SavedRubricSummary[]>([]);

  // Request-local loading flags.
  const [isGeneratingRubric, setIsGeneratingRubric] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [isFetchingPreview, setIsFetchingPreview] = useState(false);
  const scoringPollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [actionMessage, setActionMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const notify = (message: { type: 'success' | 'error'; text: string }, ms = 3000) => {
    setActionMessage(message);
    setTimeout(() => setActionMessage(null), ms);
  };

  useEffect(() => {
    if (!isAuthenticated) {
      setRecentRuns([]);
      dispatch({ type: 'banner_reset' });
      return;
    }

    let disposed = false;
    fetch('/api/runs', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Run history request failed: ${res.status}`);
        return (await res.json()) as RunsResponse;
      })
      .then((data) => {
        if (!disposed) setRecentRuns(data.runs);
      })
      .catch((fetchError) => console.warn('Unable to load run history:', fetchError));

    return () => {
      disposed = true;
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      setProviders(['api']);
      dispatch({ type: 'provider_changed', provider: 'api' });
      return;
    }

    let disposed = false;
    fetch('/api/providers', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Provider request failed: ${res.status}`);
        return (await res.json()) as { providers: ProviderName[] };
      })
      .then((data) => {
        if (!disposed) setProviders(data.providers);
      })
      .catch((fetchError) => console.warn('Unable to load providers:', fetchError));

    return () => {
      disposed = true;
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || state.selectedJobId === null) {
      setSavedRubrics([]);
      return;
    }

    let disposed = false;
    setSavedRubrics([]);
    fetch(`/api/rubrics?jobId=${state.selectedJobId}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Saved rubrics request failed: ${res.status}`);
        return (await res.json()) as RubricsResponse;
      })
      .then((data) => {
        if (!disposed) setSavedRubrics(data.rubrics);
      })
      .catch((fetchError) => console.warn('Unable to load saved rubrics:', fetchError));

    return () => {
      disposed = true;
    };
  }, [isAuthenticated, state.selectedJobId]);

  // ---- Greenhouse Job Fetching ----
  const fetchGreenhouseJobs = async () => {
    setGhJobsLoading(true);
    dispatch({ type: 'error_dismissed' });
    try {
      const res = await fetch('/api/greenhouse/jobs');
      if (!res.ok) throw new Error('Failed to fetch jobs from Greenhouse');
      const data = await res.json();
      setGhJobs(data.jobs);
    } catch (err) {
      dispatch({
        type: 'error_set',
        message: err instanceof Error ? err.message : 'Failed to connect to Greenhouse',
      });
    } finally {
      setGhJobsLoading(false);
    }
  };

  const handleSelectJob = async (jobId: number) => {
    const job = ghJobs.find((j) => j.id === jobId);
    dispatch({ type: 'job_selected', jobId, jobName: job?.name ?? null });

    try {
      const res = await fetch('/api/greenhouse/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      if (res.ok) {
        const data = await res.json();
        dispatch({
          type: 'job_description_loaded',
          text: `${data.title}\n\n${data.content}`,
        });
      }
    } catch {
      // Job post fetch failed - user can paste JD manually
    }
  };

  // ---- Rubric Generation ----
  const handleGenerateRubric = async () => {
    setIsGeneratingRubric(true);
    dispatch({ type: 'error_dismissed' });
    try {
      const res = await fetch('/api/rubric/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobDescription: state.session.jobDescription,
          intakeNotes: state.session.intakeNotes,
          provider: state.provider,
        }),
      });
      const data = await parseJsonResponse<{
        rubric: ScoringRubric;
        rubricVersion?: string | null;
      }>(res, 'Failed to generate rubric');
      dispatch({
        type: 'rubric_ready',
        rubric: data.rubric,
        rubricVersion: data.rubricVersion || state.session.rubricVersion || null,
        calibrationVersion: null,
        idealPatterns: null,
        rubricIntakeNotes: qualifyIntakeNotes(state.session.intakeNotes),
        outcome: 'idle',
      });
    } catch (err) {
      dispatch({
        type: 'error_set',
        message: err instanceof Error ? err.message : 'Rubric generation failed',
      });
    } finally {
      setIsGeneratingRubric(false);
    }
  };

  const handleUseSavedRubric = (savedRubric: SavedRubricSummary) => {
    dispatch({
      type: 'rubric_ready',
      rubric: savedRubric.rubric,
      rubricVersion: savedRubric.rubricVersion,
      calibrationVersion: savedRubric.calibrationVersion,
      idealPatterns: savedRubric.idealPatterns,
      rubricIntakeNotes: null,
      outcome: savedRubric.calibrated
        ? 'calibrated'
        : savedRubric.idealPatterns
          ? 'patterns_only'
          : 'idle',
    });
  };

  const handleOpenRun = async (runId: string) => {
    try {
      const res = await fetch(`/api/runs/${runId}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Run request failed: ${res.status}`);
      const data = (await res.json()) as RunDetailResponse;
      dispatch({ type: 'run_opened', run: data.run, rubric: data.rubric || null });
    } catch (fetchError) {
      console.warn('Unable to open screening run:', fetchError);
    }
  };

  const handleStartScoring = async (mode: ScreeningRunMode = 'new_or_changed') => {
    if (!state.session.greenhouseJobId || !state.session.rubric) return;

    dispatch({ type: 'scoring_started' });

    try {
      const res = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: state.session.greenhouseJobId,
          jobTitle: state.session.jobTitle,
          rubric: state.session.rubric,
          rubricVersion: state.session.rubricVersion,
          calibrationVersion: state.session.calibrationVersion,
          idealPatterns: state.session.idealPatterns,
          mode,
          provider: state.provider,
          groundedByIntakeNotes:
            state.calibrationOutcome === 'intake_grounded' &&
            Boolean(state.session.rubricIntakeNotes),
        }),
      });
      const data = await parseJsonResponse<{
        run: ScreeningRunSummary;
        rubric: ScreeningRunRubric;
      }>(res, 'Failed to create scoring run');
      dispatch({ type: 'run_created', run: data.run, rubric: data.rubric });
    } catch (err) {
      dispatch({
        type: 'run_create_failed',
        message: err instanceof Error ? err.message : 'Failed to start scoring run',
      });
    }
  };

  const handleCancelScoring = async () => {
    if (!state.activeRunId) return;

    try {
      await fetch(`/api/runs/${state.activeRunId}/cancel`, { method: 'POST' });
    } catch {
      // best effort
    }

    if (scoringPollTimeoutRef.current) {
      clearTimeout(scoringPollTimeoutRef.current);
      scoringPollTimeoutRef.current = null;
    }

    dispatch({ type: 'scoring_canceled' });
    notify({ type: 'success', text: 'Scoring canceled' }, 4000);
  };

  // ---- Calibration ----
  const handleUploadCalibration = async () => {
    if (state.calibrationFiles.length === 0) return;

    setIsCalibrating(true);
    dispatch({ type: 'calibration_started' });
    try {
      const formData = new FormData();
      state.calibrationFiles.forEach((file) => formData.append('resumes', file));
      // Pass rubric + JD so the calibrate route can refine the rubric
      if (state.session.rubric) {
        formData.append('rubric', JSON.stringify(state.session.rubric));
      }
      if (state.session.jobDescription) {
        formData.append('jobDescription', state.session.jobDescription);
      }

      const res = await fetch('/api/calibrate', {
        method: 'POST',
        body: formData,
      });
      const data = await parseJsonResponse<CalibrationResponse>(
        res,
        'Failed to process resumes'
      );
      dispatch({ type: 'calibration_completed', response: data });
    } catch (err) {
      dispatch({
        type: 'calibration_failed',
        message: err instanceof Error ? err.message : 'Calibration failed',
      });
    } finally {
      setIsCalibrating(false);
    }
  };

  const handleAutoCalibration = async () => {
    if (!state.session.greenhouseJobId || !state.session.rubric) return;

    setIsCalibrating(true);
    dispatch({ type: 'calibration_started' });
    try {
      const res = await fetch('/api/calibrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: state.session.greenhouseJobId,
          rubric: state.session.rubric,
          jobDescription: state.session.jobDescription,
          provider: state.provider,
        }),
      });
      const data = await parseJsonResponse<CalibrationResponse>(
        res,
        'Failed to auto-calibrate'
      );
      dispatch({ type: 'calibration_completed', response: data });
    } catch (err) {
      dispatch({
        type: 'calibration_failed',
        message: err instanceof Error ? err.message : 'Auto-calibration failed',
      });
    } finally {
      setIsCalibrating(false);
    }
  };

  // ---- Candidate Preview (count only, no resumes) ----
  // Fetch candidate preview when entering Step 2
  useEffect(() => {
    const jobId = state.session.greenhouseJobId;
    if (state.currentStep !== 2 || !jobId || state.candidatePreview) return;

    let disposed = false;
    setIsFetchingPreview(true);
    fetch('/api/greenhouse/candidates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId }),
    })
      .then(async (res) => {
        if (!res.ok || disposed) return;
        const data = await res.json();
        if (disposed) return;
        dispatch({
          type: 'preview_loaded',
          preview: { total: data.total, withResumes: data.withResumes },
        });
      })
      .catch(() => {
        // non-critical — preview is nice-to-have
      })
      .finally(() => {
        if (!disposed) setIsFetchingPreview(false);
      });

    return () => {
      disposed = true;
    };
  }, [state.currentStep, state.session.greenhouseJobId, state.candidatePreview]);

  // ---- Scoring run polling ----
  useEffect(() => {
    if (!state.activeRunId || !state.isScoring) {
      if (scoringPollTimeoutRef.current) {
        clearTimeout(scoringPollTimeoutRef.current);
        scoringPollTimeoutRef.current = null;
      }
      return;
    }

    const runId = state.activeRunId;
    let disposed = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/runs/${runId}`, { cache: 'no-store' });
        if (!res.ok) {
          throw new Error('Failed to fetch screening run');
        }

        const data = (await res.json()) as { run: ScreeningRunSummary };
        if (disposed) return;

        dispatch({ type: 'run_progress', run: data.run });
        if (terminalRunStatuses.has(data.run.status)) return;

        scoringPollTimeoutRef.current = setTimeout(poll, 1500);
      } catch (err) {
        if (disposed) return;
        dispatch({
          type: 'poll_failed',
          message: err instanceof Error ? err.message : 'Failed to poll screening run',
        });
      }
    };

    poll();

    return () => {
      disposed = true;
      if (scoringPollTimeoutRef.current) {
        clearTimeout(scoringPollTimeoutRef.current);
        scoringPollTimeoutRef.current = null;
      }
    };
  }, [state.activeRunId, state.isScoring]);

  const resumableRun = state.resumeBannerDismissed
    ? undefined
    : recentRuns.find((run) => !isTerminalRun(run));
  const savedRubric = savedRubrics[0];

  // Loading state while checking identity.
  if (authChecking && !isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // IAP normally intercepts unauthenticated production traffic before this.
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-sm text-muted-foreground">
          Rosie could not verify access.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-chart-4 to-chart-1 flex items-center justify-center shrink-0">
                <span className="text-white font-bold text-lg">R</span>
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground">Rosie</h1>
                <p className="text-xs text-muted-foreground">Few-Shot Resume Scoring</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <StepIndicator
                currentStep={state.currentStep}
                steps={steps}
                onStepClick={(step) => dispatch({ type: 'step_back', step })}
              />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Toast Notification */}
        {actionMessage && (
          <div
            className={cn(
              'fixed top-20 right-4 left-4 sm:left-auto px-4 py-3 rounded-lg shadow-lg z-50 flex items-center gap-3 max-w-sm sm:max-w-none ml-auto',
              actionMessage.type === 'success'
                ? 'bg-tier-top text-white'
                : 'bg-destructive text-white',
            )}
          >
            <span>{actionMessage.text}</span>
            <button
              onClick={() => setActionMessage(null)}
              className="text-white/80 hover:text-white"
            >
              <X className="size-4" />
            </button>
          </div>
        )}

        {/* Discard Results Confirmation */}
        <Dialog
          open={!!state.pendingNav}
          onOpenChange={(open) => !open && dispatch({ type: 'nav_canceled' })}
        >
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Discard Scoring Results?</DialogTitle>
              <DialogDescription>
                {state.pendingNav?.step === 1
                  ? 'Starting a new session will discard all scored candidates. This cannot be undone.'
                  : 'Going back will discard your current scoring results. You can re-score after making changes.'}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => dispatch({ type: 'nav_canceled' })}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => dispatch({ type: 'nav_confirmed' })}
              >
                Discard Results
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {resumableRun && (
          <Card className="mb-6 py-0">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex-1 text-sm text-foreground">
                A screening run for {resumableRun.jobTitle} is in progress —{' '}
                <button
                  className="font-medium text-chart-1 hover:underline"
                  onClick={() => void handleOpenRun(resumableRun.id)}
                >
                  View progress
                </button>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 text-muted-foreground"
                onClick={() => dispatch({ type: 'banner_dismissed' })}
                aria-label="Dismiss in-progress run"
              >
                <X className="size-4" />
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Error Banner */}
        {state.error && (
          <div className="mb-6 p-4 bg-destructive/10 border border-destructive/30 rounded-lg flex items-start gap-3">
            <AlertTriangle className="size-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-destructive font-medium">Error</p>
              <p className="text-sm text-muted-foreground mt-0.5">{state.error}</p>
            </div>
            <button
              onClick={() => dispatch({ type: 'error_dismissed' })}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        )}

        {state.currentStep === 1 && (
          <SetupStep
            state={state}
            dispatch={dispatch}
            ghJobs={ghJobs}
            ghJobsLoading={ghJobsLoading}
            onLoadJobs={() => void fetchGreenhouseJobs()}
            onSelectJob={(jobId) => void handleSelectJob(jobId)}
            recentRuns={recentRuns}
            onOpenRun={(runId) => void handleOpenRun(runId)}
            savedRubric={savedRubric}
            onUseSavedRubric={handleUseSavedRubric}
            providers={providers}
            isGeneratingRubric={isGeneratingRubric}
            onGenerateRubric={() => void handleGenerateRubric()}
          />
        )}

        {state.currentStep === 2 && (
          <CalibrateStep
            state={state}
            dispatch={dispatch}
            providers={providers}
            isCalibrating={isCalibrating}
            isFetchingPreview={isFetchingPreview}
            onAutoCalibrate={() => void handleAutoCalibration()}
            onUploadCalibration={() => void handleUploadCalibration()}
            onStartScoring={(mode) => void handleStartScoring(mode)}
          />
        )}

        {state.currentStep === 3 && state.session.status === 'scoring' && (
          <ScoringStep state={state} onCancelScoring={() => void handleCancelScoring()} />
        )}

        {state.currentStep === 4 && (
          <ResultsStep state={state} dispatch={dispatch} onNotify={notify} />
        )}
      </main>
    </div>
  );
}
