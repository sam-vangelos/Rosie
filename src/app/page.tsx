'use client';

import { useState, useCallback, useRef } from 'react';
import { Candidate, ScreeningSession, Tier, GreenhouseJob, ScoringRubric } from '@/lib/types';
import { cn } from '@/lib/utils';
import { StepIndicator } from '@/components/StepIndicator';
import { RubricDisplay } from '@/components/RubricDisplay';
import { IdealPatternsDisplay } from '@/components/IdealPatternsDisplay';
import { ScoringProgress } from '@/components/ScoringProgress';
import { ResultsSummary } from '@/components/ResultsSummary';
import { TierSection } from '@/components/TierSection';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Loader2,
  ChevronLeft,
  X,
  AlertTriangle,
  Download,
  Upload,
  Search,
  RefreshCw,
} from 'lucide-react';

const steps = [
  { label: 'Setup', description: 'Configure requirements' },
  { label: 'Calibrate', description: 'Review rubric' },
  { label: 'Score', description: 'AI evaluation' },
  { label: 'Results', description: 'Review & act' },
];

export default function Home() {
  const [session, setSession] = useState<ScreeningSession>({
    jobTitle: '',
    jobDescription: '',
    intakeNotes: '',
    rubric: null,
    idealPatterns: null,
    candidates: [],
    status: 'setup',
  });

  const [currentStep, setCurrentStep] = useState(1);
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set());
  const [scoringProgress, setScoringProgress] = useState({
    completed: 0,
    total: 0,
    current: '',
    failed: 0,
  });
  const [showRubric, setShowRubric] = useState(true);
  const [showPatterns, setShowPatterns] = useState(false);
  const [actionMessage, setActionMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Greenhouse state
  const [ghJobs, setGhJobs] = useState<GreenhouseJob[]>([]);
  const [ghJobsLoading, setGhJobsLoading] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [jobSearchQuery, setJobSearchQuery] = useState('');

  // Loading states
  const [isGeneratingRubric, setIsGeneratingRubric] = useState(false);
  const [isFetchingCandidates, setIsFetchingCandidates] = useState(false);
  const [isScoring, setIsScoring] = useState(false);
  const scoringAbortRef = useRef(false);

  // Error state
  const [error, setError] = useState<string | null>(null);

  // Confirmation dialog
  const [confirmAction, setConfirmAction] = useState<{
    action: 'advance' | 'reject';
    ids: string[];
    count: number;
  } | null>(null);

  // ---- Greenhouse Job Fetching ----
  const fetchGreenhouseJobs = useCallback(async () => {
    setGhJobsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/greenhouse/jobs');
      if (!res.ok) throw new Error('Failed to fetch jobs from Greenhouse');
      const data = await res.json();
      setGhJobs(data.jobs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to Greenhouse');
    } finally {
      setGhJobsLoading(false);
    }
  }, []);

  const handleSelectJob = useCallback(
    async (jobId: number) => {
      setSelectedJobId(jobId);
      const job = ghJobs.find((j) => j.id === jobId);
      if (job) {
        setSession((prev) => ({ ...prev, jobTitle: job.name, greenhouseJobId: jobId }));
      }

      try {
        const res = await fetch('/api/greenhouse/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobId }),
        });
        if (res.ok) {
          const data = await res.json();
          setSession((prev) => ({
            ...prev,
            jobDescription: `${data.title}\n\n${data.content}`,
          }));
        }
      } catch {
        // Job post fetch failed - user can paste JD manually
      }
    },
    [ghJobs]
  );

  // ---- Rubric Generation ----
  const handleGenerateRubric = useCallback(async () => {
    setIsGeneratingRubric(true);
    setError(null);
    try {
      const res = await fetch('/api/rubric/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobDescription: session.jobDescription,
          intakeNotes: session.intakeNotes,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to generate rubric');
      }

      const data = await res.json();
      setSession((prev) => ({
        ...prev,
        rubric: data.rubric,
        status: 'calibrating',
      }));
      setCurrentStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rubric generation failed');
    } finally {
      setIsGeneratingRubric(false);
    }
  }, [session.jobDescription, session.intakeNotes]);

  // ---- Candidate Scoring Pipeline ----
  const handleStartScoring = useCallback(async () => {
    setCurrentStep(3);
    setSession((prev) => ({ ...prev, status: 'scoring' }));
    setIsScoring(true);
    scoringAbortRef.current = false;

    try {
      setIsFetchingCandidates(true);
      setScoringProgress({ completed: 0, total: 0, current: 'Fetching candidates from Greenhouse...', failed: 0 });

      const candidatesRes = await fetch('/api/greenhouse/candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: session.greenhouseJobId }),
      });

      if (!candidatesRes.ok) {
        throw new Error('Failed to fetch candidates from Greenhouse');
      }

      const candidatesData = await candidatesRes.json();
      const ghCandidates = candidatesData.candidates;
      setIsFetchingCandidates(false);

      if (ghCandidates.length === 0) {
        setError('No candidates found for this job in Greenhouse');
        setCurrentStep(2);
        setSession((prev) => ({ ...prev, status: 'calibrating' }));
        setIsScoring(false);
        return;
      }

      setScoringProgress({
        completed: 0,
        total: ghCandidates.length,
        current: ghCandidates[0]?.name || '',
        failed: 0,
      });

      const scoredCandidates: Candidate[] = [];
      let failed = 0;

      for (let i = 0; i < ghCandidates.length; i++) {
        if (scoringAbortRef.current) break;

        const ghCandidate = ghCandidates[i];
        setScoringProgress({
          completed: i,
          total: ghCandidates.length,
          current: ghCandidate.name,
          failed,
        });

        try {
          const scoreRes = await fetch('/api/score', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              rubric: session.rubric,
              idealPatterns: session.idealPatterns,
              candidate: ghCandidate,
            }),
          });

          if (scoreRes.ok) {
            const scoreData = await scoreRes.json();
            scoredCandidates.push(scoreData.candidate);
          } else {
            failed++;
            console.error(`Failed to score ${ghCandidate.name}`);
          }
        } catch {
          failed++;
          console.error(`Error scoring ${ghCandidate.name}`);
        }
      }

      scoredCandidates.sort((a, b) => b.overallScore - a.overallScore);

      setScoringProgress({
        completed: ghCandidates.length,
        total: ghCandidates.length,
        current: '',
        failed,
      });

      setSession((prev) => ({
        ...prev,
        candidates: scoredCandidates,
        status: 'results',
      }));
      setCurrentStep(4);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scoring pipeline failed');
      setCurrentStep(2);
      setSession((prev) => ({ ...prev, status: 'calibrating' }));
    } finally {
      setIsScoring(false);
      setIsFetchingCandidates(false);
    }
  }, [session.greenhouseJobId, session.rubric, session.idealPatterns]);

  const handleCancelScoring = useCallback(() => {
    scoringAbortRef.current = true;
  }, []);

  const handleSkipCalibration = useCallback(() => {
    handleStartScoring();
  }, [handleStartScoring]);

  // ---- Candidate Selection ----
  const handleToggleSelect = useCallback((id: string) => {
    setSelectedCandidates((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback((ids: string[]) => {
    setSelectedCandidates((prev) => {
      const next = new Set(prev);
      if (ids.length === 0) return new Set();
      ids.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  // ---- Tier Actions ----
  const handleTierAction = useCallback((action: 'advance' | 'reject', ids: string[]) => {
    setConfirmAction({ action, ids, count: ids.length });
  }, []);

  const executeAction = useCallback(() => {
    if (!confirmAction) return;
    const actionText = confirmAction.action === 'advance' ? 'advanced to screen' : 'rejected';
    setActionMessage({
      type: 'success',
      text: `${confirmAction.count} candidate${confirmAction.count === 1 ? '' : 's'} ${actionText} in Greenhouse`,
    });
    setTimeout(() => setActionMessage(null), 4000);
    setConfirmAction(null);
  }, [confirmAction]);

  // ---- Step Navigation ----
  const handleStepClick = useCallback(
    (stepNumber: number) => {
      if (stepNumber < currentStep) {
        setCurrentStep(stepNumber);
        if (stepNumber === 1) setSession((prev) => ({ ...prev, status: 'setup' }));
        if (stepNumber === 2) setSession((prev) => ({ ...prev, status: 'calibrating' }));
      }
    },
    [currentStep]
  );

  // ---- Group candidates by tier ----
  const candidatesByTier = session.candidates.reduce(
    (acc, candidate) => {
      acc[candidate.tier].push(candidate);
      return acc;
    },
    { top: [], strong: [], moderate: [], below: [] } as Record<Tier, Candidate[]>
  );

  const globalRankMap = new Map<string, number>();
  session.candidates.forEach((c, i) => globalRankMap.set(c.id, i + 1));

  const filteredJobs = ghJobs.filter(
    (j) =>
      j.name.toLowerCase().includes(jobSearchQuery.toLowerCase()) ||
      j.department.toLowerCase().includes(jobSearchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-chart-4 to-chart-1 flex items-center justify-center">
                <span className="text-white font-bold text-lg">R</span>
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground">Rosie</h1>
                <p className="text-xs text-muted-foreground">AI Resume Screening</p>
              </div>
            </div>
            <StepIndicator
              currentStep={currentStep}
              steps={steps}
              onStepClick={handleStepClick}
            />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Toast Notification */}
        {actionMessage && (
          <div
            className={cn(
              'fixed top-20 right-4 px-4 py-3 rounded-lg shadow-lg z-50 flex items-center gap-3',
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

        {/* Confirmation Dialog */}
        <Dialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>
                {confirmAction?.action === 'advance' ? 'Advance Candidates' : 'Reject Candidates'}
              </DialogTitle>
              <DialogDescription>
                {confirmAction?.action === 'advance'
                  ? `Move ${confirmAction.count} candidate${confirmAction.count === 1 ? '' : 's'} to the screening stage in Greenhouse?`
                  : `Reject ${confirmAction?.count} candidate${confirmAction?.count === 1 ? '' : 's'} in Greenhouse? This action is hard to reverse.`}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirmAction(null)}>
                Cancel
              </Button>
              <Button
                variant={confirmAction?.action === 'reject' ? 'destructive' : 'default'}
                onClick={executeAction}
                className={confirmAction?.action === 'advance' ? 'bg-tier-top hover:bg-tier-top/90 text-white' : ''}
              >
                {confirmAction?.action === 'advance' ? 'Advance' : 'Reject'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Error Banner */}
        {error && (
          <div className="mb-6 p-4 bg-destructive/10 border border-destructive/30 rounded-lg flex items-start gap-3">
            <AlertTriangle className="size-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-destructive font-medium">Error</p>
              <p className="text-sm text-muted-foreground mt-0.5">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>
        )}

        {/* ============ STEP 1: SETUP ============ */}
        {currentStep === 1 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-foreground">Setup Requirements</h2>
              <p className="text-muted-foreground mt-2">
                Select a Greenhouse job or paste a job description to get started.
              </p>
            </div>

            {/* Greenhouse Job Selector */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Select from Greenhouse</CardTitle>
                    <CardDescription className="mt-0.5">
                      Auto-populates the job description from Greenhouse
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={fetchGreenhouseJobs}
                    disabled={ghJobsLoading}
                  >
                    {ghJobsLoading ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Loading...
                      </>
                    ) : ghJobs.length > 0 ? (
                      <>
                        <RefreshCw className="size-4" />
                        Refresh Jobs
                      </>
                    ) : (
                      'Load Greenhouse Jobs'
                    )}
                  </Button>
                </div>
              </CardHeader>

              {ghJobs.length > 0 && (
                <CardContent>
                  <div className="space-y-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                      <Input
                        value={jobSearchQuery}
                        onChange={(e) => setJobSearchQuery(e.target.value)}
                        placeholder="Search jobs by title or department..."
                        className="pl-9"
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {filteredJobs.map((job) => (
                        <button
                          key={job.id}
                          onClick={() => handleSelectJob(job.id)}
                          className={cn(
                            'w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors',
                            selectedJobId === job.id
                              ? 'bg-chart-1/10 border border-chart-1/30 text-chart-1'
                              : 'bg-muted hover:bg-muted/80 text-foreground border border-transparent',
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{job.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {job.openings} opening{job.openings !== 1 ? 's' : ''}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {job.department} {job.office ? `· ${job.office}` : ''}
                          </div>
                        </button>
                      ))}
                      {filteredJobs.length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-4">No matching jobs</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>

            {/* JD + Intake Notes */}
            <div className="grid lg:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground flex items-center justify-between">
                  Job Description
                  <span className="text-xs text-muted-foreground font-normal">
                    {session.jobDescription.length > 0 && `${session.jobDescription.length} chars`}
                  </span>
                </label>
                <Textarea
                  value={session.jobDescription}
                  onChange={(e) =>
                    setSession((prev) => ({ ...prev, jobDescription: e.target.value }))
                  }
                  className="h-80 resize-none"
                  placeholder="Paste the job description or select a Greenhouse job above..."
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground flex items-center justify-between">
                  Intake Notes
                  <span className="text-xs text-muted-foreground font-normal">(optional)</span>
                </label>
                <Textarea
                  value={session.intakeNotes}
                  onChange={(e) =>
                    setSession((prev) => ({ ...prev, intakeNotes: e.target.value }))
                  }
                  className="h-80 resize-none"
                  placeholder="Paste notes from your HM intake call. Include must-haves, nice-to-haves, red flags, team context, and what 'good' looks like..."
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                {selectedJobId && session.jobDescription.trim() && (
                  <span className="text-tier-top">Job loaded from Greenhouse</span>
                )}
              </div>
              <Button
                onClick={handleGenerateRubric}
                disabled={!session.jobDescription.trim() || isGeneratingRubric}
                size="lg"
              >
                {isGeneratingRubric ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Generating Rubric...
                  </>
                ) : (
                  'Generate Scoring Rubric'
                )}
              </Button>
            </div>
          </div>
        )}

        {/* ============ STEP 2: CALIBRATE ============ */}
        {currentStep === 2 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-2xl font-bold text-foreground">Calibrate Scoring</h2>
              <p className="text-muted-foreground mt-2">
                Review the AI-generated rubric. The rubric defines how candidates will be scored.
              </p>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
              {/* Rubric */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Scoring Rubric</CardTitle>
                    <Button variant="link" size="sm" onClick={() => setShowRubric(!showRubric)}>
                      {showRubric ? 'Collapse' : 'Expand'}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {session.rubric &&
                    (showRubric ? (
                      <RubricDisplay rubric={session.rubric} />
                    ) : (
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {session.rubric.mustHaves.length}
                          </span>{' '}
                          must-have requirements
                        </p>
                        <p className="text-sm text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {session.rubric.niceToHaves.length}
                          </span>{' '}
                          nice-to-have requirements
                        </p>
                        <p className="text-sm text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {session.rubric.hiddenPreferences.length}
                          </span>{' '}
                          contextual signals from intake
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Target:{' '}
                          <span className="font-medium text-foreground">
                            {session.rubric.seniorityTarget}
                          </span>
                        </p>
                      </div>
                    ))}
                </CardContent>
              </Card>

              {/* Ideal Candidates */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>
                      Ideal Candidate Patterns{' '}
                      <span className="text-muted-foreground font-normal">(optional)</span>
                    </CardTitle>
                    {session.idealPatterns && (
                      <Button variant="link" size="sm" onClick={() => setShowPatterns(!showPatterns)}>
                        {showPatterns ? 'Collapse' : 'Expand'}
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {session.idealPatterns ? (
                    showPatterns ? (
                      <IdealPatternsDisplay patterns={session.idealPatterns} />
                    ) : (
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {session.idealPatterns.commonSkills.length}
                          </span>{' '}
                          common skills identified
                        </p>
                        <p className="text-sm text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {session.idealPatterns.careerPatterns.length}
                          </span>{' '}
                          career patterns
                        </p>
                      </div>
                    )
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Upload 2-5 resumes of your best hires in similar roles to teach the scoring
                        model what &ldquo;good&rdquo; looks like. This is optional but improves
                        accuracy.
                      </p>
                      <div className="w-full p-6 border-2 border-dashed rounded-lg text-center text-muted-foreground">
                        <Upload className="size-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">Resume upload coming soon</p>
                        <p className="text-xs mt-1">Scoring will proceed without calibration data</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="flex justify-between items-center">
              <Button
                variant="ghost"
                onClick={() => {
                  setCurrentStep(1);
                  setSession((prev) => ({ ...prev, status: 'setup' }));
                }}
              >
                <ChevronLeft className="size-4" />
                Back to Setup
              </Button>
              <div className="flex items-center gap-3">
                {!session.greenhouseJobId && (
                  <p className="text-sm text-tier-moderate">
                    No Greenhouse job selected — select a job in Setup to score real candidates
                  </p>
                )}
                <Button
                  onClick={handleStartScoring}
                  disabled={!session.greenhouseJobId || isScoring}
                  size="lg"
                >
                  Start Scoring Candidates
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ============ STEP 3: SCORING ============ */}
        {currentStep === 3 && session.status === 'scoring' && (
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="text-center space-y-8 max-w-lg w-full">
              <div>
                <h2 className="text-2xl font-bold text-foreground mb-2">
                  {isFetchingCandidates ? 'Loading Candidates' : 'Scoring Candidates'}
                </h2>
                <p className="text-muted-foreground">
                  {isFetchingCandidates
                    ? 'Downloading resumes from Greenhouse...'
                    : 'Analyzing each resume against your rubric with Claude'}
                </p>
              </div>
              <ScoringProgress
                total={scoringProgress.total}
                completed={scoringProgress.completed}
                currentCandidate={scoringProgress.current}
                failed={scoringProgress.failed}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCancelScoring}
                className="text-muted-foreground hover:text-destructive"
              >
                Cancel Scoring
              </Button>
            </div>
          </div>
        )}

        {/* ============ STEP 4: RESULTS ============ */}
        {currentStep === 4 && (
          <div className="space-y-8">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-2xl font-bold text-foreground">Screening Results</h2>
                <p className="text-muted-foreground mt-1">
                  {session.jobTitle || 'Job'} &bull; {session.candidates.length} candidates scored
                  {scoringProgress.failed > 0 && (
                    <span className="text-tier-moderate"> &bull; {scoringProgress.failed} failed</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setCurrentStep(2);
                    setSession((prev) => ({ ...prev, status: 'calibrating' }));
                  }}
                >
                  Back to Calibrate
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const headers = [
                      'Rank', 'Name', 'Email', 'Role', 'Company', 'Overall Score', 'Tier',
                      'Technical', 'Experience', 'Alignment', 'Growth',
                      'Strengths', 'Gaps', 'Reasoning', 'Greenhouse URL',
                    ];
                    const rows = session.candidates.map((c, i) => [
                      i + 1,
                      c.name,
                      c.email,
                      c.currentRole,
                      c.currentCompany,
                      c.overallScore,
                      c.tier,
                      c.scores.technical,
                      c.scores.experience,
                      c.scores.alignment,
                      c.scores.growth,
                      c.strengths.join('; '),
                      c.gaps.join('; '),
                      c.reasoning,
                      c.greenhouseUrl || '',
                    ]);
                    const csv = [headers, ...rows]
                      .map((row) =>
                        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
                      )
                      .join('\n');
                    const blob = new Blob([csv], { type: 'text/csv' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `rosie-results-${session.jobTitle.replace(/\s+/g, '-').toLowerCase()}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                    setActionMessage({ type: 'success', text: 'CSV exported' });
                    setTimeout(() => setActionMessage(null), 3000);
                  }}
                >
                  <Download className="size-4" />
                  Export CSV
                </Button>
              </div>
            </div>

            <ResultsSummary candidates={session.candidates} />

            <div className="space-y-6">
              {(['top', 'strong', 'moderate', 'below'] as Tier[]).map((tier) => (
                <TierSection
                  key={tier}
                  tier={tier}
                  candidates={candidatesByTier[tier]}
                  selectedIds={selectedCandidates}
                  onToggleSelect={handleToggleSelect}
                  onSelectAll={handleSelectAll}
                  onAction={handleTierAction}
                  globalRankMap={globalRankMap}
                />
              ))}
            </div>

            <div className="border-t pt-8 flex justify-center">
              <Button
                variant="ghost"
                onClick={() => {
                  setSession({
                    jobTitle: '',
                    jobDescription: '',
                    intakeNotes: '',
                    rubric: null,
                    idealPatterns: null,
                    candidates: [],
                    status: 'setup',
                  });
                  setCurrentStep(1);
                  setSelectedCandidates(new Set());
                  setSelectedJobId(null);
                  setScoringProgress({ completed: 0, total: 0, current: '', failed: 0 });
                }}
              >
                Start New Screening Session
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
