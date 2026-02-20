'use client';

import { useState, useCallback, useRef, useEffect, DragEvent } from 'react';
import { Candidate, ScreeningSession, Tier, GreenhouseJob, ScoringRubric } from '@/lib/types';
import { cn } from '@/lib/utils';
import { StepIndicator } from '@/components/StepIndicator';
import { RubricDisplay } from '@/components/RubricDisplay';

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
  FileText,
  CheckCircle2,
  Users,
  ChevronDown,
} from 'lucide-react';

const steps = [
  { label: 'Setup', description: 'JD + intake notes' },
  { label: 'Calibrate', description: 'Few-shot training' },
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

  // Results search
  const [candidateSearchQuery, setCandidateSearchQuery] = useState('');

  // Calibration upload
  const [calibrationFiles, setCalibrationFiles] = useState<File[]>([]);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Candidate preview (fetched on Step 2 for count display)
  const [candidatePreview, setCandidatePreview] = useState<{
    total: number;
    withResumes: number;
  } | null>(null);
  const [isFetchingPreview, setIsFetchingPreview] = useState(false);

  // Rubric detail expand
  const [showRubricDetail, setShowRubricDetail] = useState(false);

  // Discard confirmation
  const [pendingNav, setPendingNav] = useState<{ step: number; status: ScreeningSession['status'] } | null>(null);

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

      const responseText = await res.text();

      if (!res.ok) {
        let errorMsg = 'Failed to generate rubric';
        try {
          const data = JSON.parse(responseText);
          errorMsg = data.error || errorMsg;
        } catch {
          if (responseText) errorMsg = `Server error: ${responseText.slice(0, 200)}`;
        }
        throw new Error(errorMsg);
      }

      let data;
      try {
        data = JSON.parse(responseText);
      } catch {
        throw new Error(`Invalid response from server: ${responseText.slice(0, 200)}`);
      }
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
  // Stateless batching: fetch metadata → client chunks batches → process + score each
  const handleStartScoring = useCallback(async () => {
    setCurrentStep(3);
    setSession((prev) => ({ ...prev, status: 'scoring' }));
    setIsScoring(true);
    scoringAbortRef.current = false;

    try {
      // Phase 1: Fetch candidate metadata (no resume downloads — fast)
      setIsFetchingCandidates(true);
      setScoringProgress({ completed: 0, total: 0, current: 'Fetching candidates from Greenhouse...', failed: 0 });

      const metaRes = await fetch('/api/greenhouse/candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: session.greenhouseJobId }),
      });

      const metaText = await metaRes.text();
      if (!metaRes.ok) {
        let msg = 'Failed to fetch candidates from Greenhouse';
        try { msg = JSON.parse(metaText).error || msg; } catch {}
        throw new Error(msg);
      }

      let metaData;
      try { metaData = JSON.parse(metaText); } catch {
        throw new Error(`Invalid response fetching candidates: ${metaText.slice(0, 200)}`);
      }

      const candidateMetas = metaData.candidates;
      setIsFetchingCandidates(false);

      if (candidateMetas.length === 0) {
        setError('No candidates found for this job in Greenhouse');
        setCurrentStep(2);
        setSession((prev) => ({ ...prev, status: 'calibrating' }));
        setIsScoring(false);
        return;
      }

      // Phase 2: Process resumes + score in interleaved batches
      // Client sends candidate objects directly — no server-side state
      const PROCESS_BATCH_SIZE = 10;
      const SCORE_CONCURRENCY = 5;
      const scoredCandidates: Candidate[] = [];
      let completed = 0;
      let failed = 0;

      setScoringProgress({ completed: 0, total: candidateMetas.length, current: '', failed: 0 });

      const totalBatches = Math.ceil(candidateMetas.length / PROCESS_BATCH_SIZE);

      for (let i = 0; i < candidateMetas.length; i += PROCESS_BATCH_SIZE) {
        if (scoringAbortRef.current) break;

        const batch = candidateMetas.slice(i, i + PROCESS_BATCH_SIZE);
        const batchNumber = Math.floor(i / PROCESS_BATCH_SIZE) + 1;

        // Step A: Send candidate objects to process endpoint for resume download + extraction
        setScoringProgress({
          completed,
          total: candidateMetas.length,
          current: `Downloading resumes (batch ${batchNumber} of ${totalBatches})...`,
          failed,
        });

        const processRes = await fetch('/api/greenhouse/candidates/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ candidates: batch }),
        });

        const processText = await processRes.text();
        if (!processRes.ok) {
          let msg = 'Failed to process candidate resumes';
          try { msg = JSON.parse(processText).error || msg; } catch {}
          throw new Error(msg);
        }

        let processData;
        try { processData = JSON.parse(processText); } catch {
          throw new Error(`Invalid response processing resumes: ${processText.slice(0, 200)}`);
        }

        const processedCandidates = processData.candidates;

        // Log any processing errors (non-fatal — candidates scored without resume)
        if (processData.errors?.length > 0) {
          for (const err of processData.errors) {
            console.warn(`Resume issue: ${err.name} (${err.candidateId}): ${err.error}`);
          }
        }

        // Step B: Score this batch with concurrency limit
        for (let j = 0; j < processedCandidates.length; j += SCORE_CONCURRENCY) {
          if (scoringAbortRef.current) break;

          const scoreBatch = processedCandidates.slice(j, j + SCORE_CONCURRENCY);
          const names = scoreBatch.map((c: { name: string }) => c.name).join(', ');
          setScoringProgress({
            completed,
            total: candidateMetas.length,
            current: names,
            failed,
          });

          const results = await Promise.allSettled(
            scoreBatch.map(async (ghCandidate: { name: string }) => {
              const scoreRes = await fetch('/api/score', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  rubric: session.rubric,
                  idealPatterns: session.idealPatterns,
                  candidate: ghCandidate,
                }),
              });

              const scoreText = await scoreRes.text();
              if (!scoreRes.ok) throw new Error(`HTTP ${scoreRes.status}: ${scoreText.slice(0, 100)}`);
              const scoreData = JSON.parse(scoreText);
              return scoreData.candidate as Candidate;
            })
          );

          for (const result of results) {
            if (result.status === 'fulfilled') {
              scoredCandidates.push(result.value);
            } else {
              failed++;
              console.error(`Scoring failed:`, result.reason);
            }
          }
          completed += scoreBatch.length;
          setScoringProgress({ completed, total: candidateMetas.length, current: '', failed });
        }
      }

      scoredCandidates.sort((a, b) => b.overallScore - a.overallScore);

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

  // ---- Calibration Upload ----
  const handleCalibrationFiles = useCallback((files: FileList | File[]) => {
    const accepted = Array.from(files).filter((f) => {
      const name = f.name.toLowerCase();
      return name.endsWith('.pdf') || name.endsWith('.docx') || name.endsWith('.doc') || name.endsWith('.txt');
    });
    setCalibrationFiles((prev) => {
      const combined = [...prev, ...accepted];
      return combined.slice(0, 10); // max 10
    });
    setCalibrationError(null);
  }, []);

  const handleRemoveCalibrationFile = useCallback((index: number) => {
    setCalibrationFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (e.dataTransfer.files) {
        handleCalibrationFiles(e.dataTransfer.files);
      }
    },
    [handleCalibrationFiles]
  );

  const handleUploadCalibration = useCallback(async () => {
    if (calibrationFiles.length === 0) return;

    setIsCalibrating(true);
    setCalibrationError(null);
    try {
      const formData = new FormData();
      calibrationFiles.forEach((file) => formData.append('resumes', file));
      // Pass rubric + JD so the calibrate route can refine the rubric
      if (session.rubric) {
        formData.append('rubric', JSON.stringify(session.rubric));
      }
      if (session.jobDescription) {
        formData.append('jobDescription', session.jobDescription);
      }

      const res = await fetch('/api/calibrate', {
        method: 'POST',
        body: formData,
      });

      const responseText = await res.text();

      if (!res.ok) {
        let errorMsg = 'Failed to process resumes';
        try {
          const data = JSON.parse(responseText);
          errorMsg = data.error || errorMsg;
        } catch {
          if (responseText) errorMsg = `Server error: ${responseText.slice(0, 200)}`;
        }
        throw new Error(errorMsg);
      }

      let data;
      try {
        data = JSON.parse(responseText);
      } catch {
        throw new Error(`Invalid response from server: ${responseText.slice(0, 200)}`);
      }
      setSession((prev) => ({
        ...prev,
        idealPatterns: data.patterns,
        // Use calibrated rubric if available, otherwise keep existing
        rubric: data.calibratedRubric || prev.rubric,
      }));
    } catch (err) {
      setCalibrationError(err instanceof Error ? err.message : 'Calibration failed');
    } finally {
      setIsCalibrating(false);
    }
  }, [calibrationFiles, session.rubric, session.jobDescription]);

  // ---- Candidate Preview (count only, no resumes) ----
  const fetchCandidatePreview = useCallback(async () => {
    if (!session.greenhouseJobId) return;
    setIsFetchingPreview(true);
    try {
      const res = await fetch('/api/greenhouse/candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: session.greenhouseJobId }),
      });
      if (res.ok) {
        const data = await res.json();
        setCandidatePreview({
          total: data.total,
          withResumes: data.withResumes,
        });
      }
    } catch {
      // non-critical — preview is nice-to-have
    } finally {
      setIsFetchingPreview(false);
    }
  }, [session.greenhouseJobId]);

  // Fetch candidate preview when entering Step 2
  useEffect(() => {
    if (currentStep === 2 && session.greenhouseJobId && !candidatePreview) {
      fetchCandidatePreview();
    }
  }, [currentStep, session.greenhouseJobId, candidatePreview, fetchCandidatePreview]);

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
    const actionText = confirmAction.action === 'advance' ? 'marked for advance' : 'marked for rejection';
    setActionMessage({
      type: 'success',
      text: `${confirmAction.count} candidate${confirmAction.count === 1 ? '' : 's'} ${actionText} (Greenhouse writeback coming soon)`,
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

  // ---- Group candidates by tier (with optional search filter) ----
  const filteredCandidates = candidateSearchQuery.trim()
    ? session.candidates.filter(
        (c) =>
          c.name.toLowerCase().includes(candidateSearchQuery.toLowerCase()) ||
          c.currentRole?.toLowerCase().includes(candidateSearchQuery.toLowerCase()) ||
          c.currentCompany?.toLowerCase().includes(candidateSearchQuery.toLowerCase())
      )
    : session.candidates;

  const candidatesByTier = filteredCandidates.reduce(
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
        <Dialog open={!!pendingNav} onOpenChange={(open) => !open && setPendingNav(null)}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Discard Scoring Results?</DialogTitle>
              <DialogDescription>
                {pendingNav?.step === 1
                  ? 'Starting a new session will discard all scored candidates. This cannot be undone.'
                  : 'Going back will discard your current scoring results. You can re-score after making changes.'}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setPendingNav(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (pendingNav?.step === 1) {
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
                    setCandidateSearchQuery('');
                  } else {
                    setCurrentStep(pendingNav?.step || 2);
                    setSession((prev) => ({ ...prev, status: pendingNav?.status || 'calibrating' }));
                  }
                  setPendingNav(null);
                }}
              >
                Discard Results
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

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
                Select a Greenhouse job to score candidates. The job description will auto-populate, or you can edit it manually.
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

            <div className="flex flex-col-reverse sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="text-sm text-muted-foreground">
                {selectedJobId && session.jobDescription.trim() ? (
                  <span className="text-tier-top">Job loaded from Greenhouse</span>
                ) : !selectedJobId && session.jobDescription.trim() ? (
                  <span className="text-tier-moderate">Select a Greenhouse job above to score candidates after rubric generation</span>
                ) : null}
              </div>
              <Button
                onClick={handleGenerateRubric}
                disabled={!session.jobDescription.trim() || isGeneratingRubric}
                size="lg"
                className="w-full sm:w-auto"
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
            {/* ---- Phase 1: Upload (before calibration) ---- */}
            {!session.idealPatterns ? (
              <>
                <div>
                  <h2 className="text-2xl font-bold text-foreground">Train Your Scoring Model</h2>
                  <p className="text-muted-foreground mt-2">
                    Upload the strongest resumes from your initial sourcing batch. The model will learn
                    what &ldquo;good&rdquo; looks like for this role, then apply that to score your
                    applicant pool.
                  </p>
                </div>

                {/* Upload Card — full width, hero position */}
                <Card>
                  <CardContent className="p-6">
                    <div
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                      className={cn(
                        'w-full py-12 px-6 border-2 border-dashed rounded-lg text-center cursor-pointer transition-colors',
                        isDragOver
                          ? 'border-chart-1 bg-chart-1/5'
                          : 'border-input hover:border-chart-1/50 hover:bg-muted/50',
                      )}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept=".pdf,.docx,.doc,.txt"
                        className="hidden"
                        onChange={(e) => {
                          if (e.target.files) handleCalibrationFiles(e.target.files);
                          e.target.value = '';
                        }}
                      />
                      <Upload className="size-10 mx-auto mb-3 text-muted-foreground" />
                      <p className="text-base font-medium text-foreground">
                        Drop resumes here or click to browse
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        PDF, DOCX, or TXT &bull; 2-10 resumes from top candidates you&rsquo;ve already reviewed
                      </p>
                    </div>

                    {/* File list */}
                    {calibrationFiles.length > 0 && (
                      <div className="mt-4 space-y-3">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                          {calibrationFiles.length} resume{calibrationFiles.length !== 1 ? 's' : ''} selected
                        </p>
                        <div className="space-y-1">
                          {calibrationFiles.map((file, i) => (
                            <div
                              key={`${file.name}-${i}`}
                              className="flex items-center justify-between bg-muted rounded-md px-3 py-2"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <FileText className="size-4 text-muted-foreground shrink-0" />
                                <span className="text-sm text-foreground truncate">{file.name}</span>
                              </div>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleRemoveCalibrationFile(i); }}
                                className="text-muted-foreground hover:text-destructive ml-2 shrink-0"
                              >
                                <X className="size-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                        <Button
                          onClick={(e) => { e.stopPropagation(); handleUploadCalibration(); }}
                          disabled={isCalibrating}
                          size="lg"
                          className="w-full"
                        >
                          {isCalibrating ? (
                            <>
                              <Loader2 className="size-4 animate-spin" />
                              Analyzing Resumes...
                            </>
                          ) : (
                            `Train on ${calibrationFiles.length} Resume${calibrationFiles.length !== 1 ? 's' : ''}`
                          )}
                        </Button>
                      </div>
                    )}

                    {calibrationError && (
                      <div className="mt-4 p-3 bg-destructive/10 border border-destructive/30 rounded-md">
                        <p className="text-sm text-destructive">{calibrationError}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Footer */}
                <div className="flex items-center justify-between">
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
                </div>
              </>
            ) : (
              /* ---- Phase 2: Scoring Summary (after calibration) ---- */
              <>
                <div>
                  <h2 className="text-2xl font-bold text-foreground">Scoring Summary</h2>
                  <p className="text-muted-foreground mt-2">
                    The model will score candidates on these discriminative criteria.
                  </p>
                </div>

                {/* Scoring Summary Card — full width */}
                <Card>
                  <CardContent className="p-6 space-y-6">
                    {/* Calibration status */}
                    <div className="flex items-center gap-3 p-3 bg-tier-top/10 rounded-lg">
                      <CheckCircle2 className="size-5 text-tier-top shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          Calibrated with {calibrationFiles.length} resume{calibrationFiles.length !== 1 ? 's' : ''}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Rubric refined based on exemplar patterns
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto text-xs"
                        onClick={() => {
                          setSession((prev) => ({ ...prev, idealPatterns: null }));
                          setCalibrationFiles([]);
                        }}
                      >
                        Re-train
                      </Button>
                    </div>

                    {/* Calibration Summary — plain English */}
                    {session.rubric?.calibrationSummary && (
                      <div className="p-4 bg-chart-1/5 border border-chart-1/20 rounded-lg">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                          What calibration changed
                        </p>
                        <p className="text-sm text-foreground leading-relaxed">
                          {session.rubric.calibrationSummary}
                        </p>
                      </div>
                    )}

                    {/* Discriminative Criteria */}
                    {session.rubric && (
                      <div className="space-y-3">
                        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                          Scoring Criteria
                        </h3>
                        {session.rubric.criteria.map((criterion) => (
                          <div key={criterion.id} className="flex items-start gap-3 p-3 bg-muted rounded-md">
                            <div className="flex-shrink-0 w-10 h-6 rounded bg-chart-1/20 text-chart-1 text-xs font-medium flex items-center justify-center">
                              {criterion.weight}%
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-foreground">{criterion.name}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">{criterion.description}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Table Stakes */}
                    {session.rubric && session.rubric.tableStakes.length > 0 && (
                      <div>
                        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                          Table Stakes (not scored)
                        </h3>
                        <div className="flex flex-wrap gap-1.5">
                          {session.rubric.tableStakes.map((skill, i) => (
                            <span
                              key={i}
                              className="px-2 py-0.5 bg-muted rounded text-xs text-muted-foreground"
                            >
                              {skill}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Expandable full rubric detail */}
                    <div className="border-t pt-4">
                      <button
                        onClick={() => setShowRubricDetail(!showRubricDetail)}
                        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <ChevronDown
                          className={cn('size-4 transition-transform', showRubricDetail && 'rotate-180')}
                        />
                        {showRubricDetail ? 'Hide' : 'View'} full scoring guides
                      </button>
                      {showRubricDetail && session.rubric && (
                        <div className="mt-4">
                          <RubricDisplay rubric={session.rubric} />
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Candidate Preview + Score CTA */}
                <Card>
                  <CardContent className="p-6">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <Users className="size-5 text-muted-foreground" />
                        <div>
                          {isFetchingPreview ? (
                            <p className="text-sm text-muted-foreground flex items-center gap-2">
                              <Loader2 className="size-3 animate-spin" />
                              Checking applicant pool...
                            </p>
                          ) : candidatePreview ? (
                            <>
                              <p className="text-sm font-medium text-foreground">
                                {candidatePreview.total} candidate{candidatePreview.total !== 1 ? 's' : ''} in Application Review
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Applicants only (not sourced)
                              </p>
                            </>
                          ) : !session.greenhouseJobId ? (
                            <p className="text-sm text-tier-moderate">
                              No Greenhouse job selected —{' '}
                              <button
                                className="underline hover:text-foreground"
                                onClick={() => {
                                  setCurrentStep(1);
                                  setSession((prev) => ({ ...prev, status: 'setup' }));
                                }}
                              >
                                go back to Setup
                              </button>
                            </p>
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              Ready to score candidates
                            </p>
                          )}
                        </div>
                      </div>
                      <Button
                        onClick={handleStartScoring}
                        disabled={!session.greenhouseJobId || isScoring}
                        size="lg"
                        className="w-full sm:w-auto"
                      >
                        {candidatePreview
                          ? `Score ${candidatePreview.total} Candidate${candidatePreview.total !== 1 ? 's' : ''}`
                          : 'Score Candidates'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Footer */}
                <div className="flex items-center justify-between">
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
                </div>
              </>
            )}
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
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-foreground">{session.jobTitle || 'Screening Results'}</h2>
                <ResultsSummary candidates={session.candidates} />
                {scoringProgress.failed > 0 && (
                  <p className="text-xs text-tier-moderate mt-0.5">{scoringProgress.failed} failed to score</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPendingNav({ step: 2, status: 'calibrating' })}
                >
                  Back to Calibrate
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    // Build dynamic headers from rubric criteria
                    const criteriaHeaders = session.rubric?.criteria.map((c) => c.name) || [];
                    const headers = [
                      'Rank', 'Name', 'Email', 'Role', 'Company', 'Overall Score', 'Tier',
                      ...criteriaHeaders,
                      'Strengths', 'Gaps', 'Reasoning', 'Greenhouse URL',
                    ];
                    const rows = session.candidates.map((c, i) => {
                      const criteriaScores = (session.rubric?.criteria || []).map((criterion) => {
                        const cs = c.scores.criterionScores.find((s) => s.criterionId === criterion.id);
                        return cs ? cs.score : '';
                      });
                      return [
                        i + 1,
                        c.name,
                        c.email,
                        c.currentRole,
                        c.currentCompany,
                        c.overallScore,
                        c.tier,
                        ...criteriaScores,
                        c.strengths.join('; '),
                        c.gaps.join('; '),
                        c.reasoning,
                        c.greenhouseUrl || '',
                      ];
                    });
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

            {/* Candidate search */}
            {session.candidates.length > 5 && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  value={candidateSearchQuery}
                  onChange={(e) => setCandidateSearchQuery(e.target.value)}
                  placeholder="Search candidates by name, role, or company..."
                  className="pl-9"
                />
              </div>
            )}

            <div className="space-y-6">
              {candidateSearchQuery.trim() && filteredCandidates.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <p className="text-sm">No candidates match &ldquo;{candidateSearchQuery}&rdquo;</p>
                  <button
                    className="text-sm text-chart-1 hover:underline mt-1"
                    onClick={() => setCandidateSearchQuery('')}
                  >
                    Clear search
                  </button>
                </div>
              )}
              {session.candidates.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <p>No candidates were scored successfully.</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2"
                    onClick={() => {
                      setCurrentStep(2);
                      setSession((prev) => ({ ...prev, status: 'calibrating' }));
                    }}
                  >
                    Back to Calibrate
                  </Button>
                </div>
              )}
              {(['top', 'strong', 'moderate', 'below'] as Tier[]).map((tier) => (
                <TierSection
                  key={tier}
                  tier={tier}
                  candidates={candidatesByTier[tier]}
                  rubric={session.rubric}
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
                onClick={() => setPendingNav({ step: 1, status: 'setup' })}
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
