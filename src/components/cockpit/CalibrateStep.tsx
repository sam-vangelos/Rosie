'use client';

import { Dispatch, DragEvent, useRef, useState } from 'react';
import type { ProviderName } from '@/lib/providers/types';
import {
  CalibrationBasis,
  CockpitAction,
  CockpitState,
} from '@/lib/cockpit-session';
import { ScreeningRunMode } from '@/lib/types';
import { cn } from '@/lib/utils';
import { RubricDisplay } from '@/components/RubricDisplay';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  FileText,
  Loader2,
  Sparkles,
  Upload,
  Users,
  X,
} from 'lucide-react';

function CalibrationBasisDisplay({ basis }: { basis: CalibrationBasis }) {
  return (
    <div className="rounded-lg border bg-muted/40 p-4">
      <p className="text-sm font-medium text-foreground">
        Calibration basis: {basis.targetStage}
      </p>
      {basis.reason && (
        <p className="mt-1 text-sm text-muted-foreground">{basis.reason}</p>
      )}
      {basis.exemplars.length > 0 && (
        <ul className="mt-3 space-y-2">
          {basis.exemplars.map((exemplar, index) => (
            <li
              key={`${exemplar.name}-${index}`}
              className="flex flex-col justify-between gap-0.5 text-sm sm:flex-row sm:gap-3"
            >
              <span className="font-medium text-foreground">{exemplar.name}</span>
              <span className="text-muted-foreground">
                {exemplar.stage} · {exemplar.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface CalibrateStepProps {
  state: CockpitState;
  dispatch: Dispatch<CockpitAction>;
  providers: ProviderName[];
  isCalibrating: boolean;
  isFetchingPreview: boolean;
  onAutoCalibrate: () => void;
  onUploadCalibration: () => void;
  onStartScoring: (mode: ScreeningRunMode) => void;
}

export function CalibrateStep({
  state,
  dispatch,
  providers,
  isCalibrating,
  isFetchingPreview,
  onAutoCalibrate,
  onUploadCalibration,
  onStartScoring,
}: CalibrateStepProps) {
  const {
    session,
    provider,
    calibrationFiles,
    calibrationOutcome,
    calibrationError,
    calibrationBasis,
    candidatePreview,
    isScoring,
  } = state;

  const [isDragOver, setIsDragOver] = useState(false);
  const [showRubricDetail, setShowRubricDetail] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files) {
      dispatch({ type: 'calibration_files_added', files: Array.from(e.dataTransfer.files) });
    }
  };

  const backToSetup = () => dispatch({ type: 'step_back', step: 1 });

  return (
    <div className="space-y-6">
      {/* ---- Phase 1: Upload (before calibration) ---- */}
      {!session.idealPatterns &&
      calibrationOutcome !== 'intake_grounded' ? (
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
              <div className="mb-6 flex flex-col justify-between gap-3 rounded-lg border bg-muted/30 p-4 sm:flex-row sm:items-center">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Use your team&apos;s revealed hiring bar
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Pull recent advanced candidates from this Greenhouse job using {provider}.
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={onAutoCalibrate}
                  disabled={
                    !session.greenhouseJobId ||
                    !session.rubric ||
                    isCalibrating
                  }
                >
                  {isCalibrating ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Finding exemplars...
                    </>
                  ) : (
                    <>
                      <Sparkles className="size-4" />
                      Auto-calibrate from advanced candidates
                    </>
                  )}
                </Button>
              </div>
              {session.rubricIntakeNotes && (
                <div className="mb-6 flex flex-col justify-between gap-3 rounded-lg border bg-muted/30 p-4 sm:flex-row sm:items-center">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Use stated hiring-team criteria
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Continue with the rubric generated from your intake
                      notes instead of exemplar resumes.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => dispatch({ type: 'intake_grounding_chosen' })}
                    disabled={isCalibrating}
                  >
                    <FileText className="size-4" />
                    Use intake notes
                  </Button>
                </div>
              )}
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
                    if (e.target.files) {
                      dispatch({ type: 'calibration_files_added', files: Array.from(e.target.files) });
                    }
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
                          onClick={(e) => {
                            e.stopPropagation();
                            dispatch({ type: 'calibration_file_removed', index: i });
                          }}
                          className="text-muted-foreground hover:text-destructive ml-2 shrink-0"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <Button
                    onClick={(e) => { e.stopPropagation(); onUploadCalibration(); }}
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

              {calibrationBasis && (
                <div className="mt-4">
                  <CalibrationBasisDisplay basis={calibrationBasis} />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Footer */}
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={backToSetup}>
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
              {calibrationOutcome === 'calibrated' ? (
                <div className="flex items-center gap-3 p-3 bg-tier-top/10 rounded-lg">
                  <CheckCircle2 className="size-5 text-tier-top shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {calibrationFiles.length > 0
                        ? `Calibrated with ${calibrationFiles.length} resume${calibrationFiles.length !== 1 ? 's' : ''}`
                        : calibrationBasis
                          ? `Auto-calibrated with ${calibrationBasis.exemplars.length} advanced candidate${calibrationBasis.exemplars.length === 1 ? '' : 's'}`
                        : 'Using saved calibrated rubric'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Rubric refined based on exemplar patterns
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto text-xs"
                    onClick={() => dispatch({ type: 'calibration_retrained' })}
                  >
                    Re-train
                  </Button>
                </div>
              ) : calibrationOutcome === 'intake_grounded' ? (
                <div className="rounded-lg border border-chart-1/20 bg-chart-1/5 p-3">
                  <div className="flex items-start gap-3">
                    <FileText className="size-5 shrink-0 text-chart-1" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">
                        Grounded in hiring-team intake notes
                      </p>
                      <p className="text-xs text-muted-foreground">
                        This rubric was generated with the intake notes
                        you provided.
                      </p>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                          Review intake notes
                        </summary>
                        <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                          {session.rubricIntakeNotes}
                        </p>
                      </details>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs"
                      onClick={() => dispatch({ type: 'intake_grounding_cleared' })}
                    >
                      Use exemplars instead
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                  <AlertTriangle className="size-5 text-yellow-500 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Patterns extracted, rubric unchanged
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Rubric calibration failed. Scoring will use the original rubric without calibration adjustments.
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto text-xs"
                    onClick={() => dispatch({ type: 'calibration_retrained' })}
                  >
                    Re-train
                  </Button>
                </div>
              )}

              {calibrationBasis && (
                <CalibrationBasisDisplay basis={calibrationBasis} />
              )}

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
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <label htmlFor="screening-provider" className="text-sm font-medium">
                  Provider
                </label>
                <select
                  id="screening-provider"
                  value={provider}
                  onChange={(event) =>
                    dispatch({ type: 'provider_changed', provider: event.target.value as ProviderName })
                  }
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  {providers.map((name) => (
                    <option key={name} value={name}>
                      {name === 'api' ? 'Anthropic API' : name}
                    </option>
                  ))}
                </select>
              </div>
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
                          onClick={backToSetup}
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
                  onClick={() => onStartScoring('new_or_changed')}
                  disabled={
                    !session.greenhouseJobId ||
                    isScoring ||
                    !providers.includes(provider)
                  }
                  size="lg"
                  className="w-full sm:w-auto"
                >
                  {candidatePreview
                    ? `Score New / Changed Candidates`
                    : 'Score Candidates'}
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onStartScoring('all')}
                  disabled={
                    !session.greenhouseJobId ||
                    isScoring ||
                    !providers.includes(provider)
                  }
                >
                  Score Entire Pool
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onStartScoring('retry_failed_only')}
                  disabled={
                    !session.greenhouseJobId ||
                    isScoring ||
                    !providers.includes(provider)
                  }
                >
                  Retry Failed Only
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onStartScoring('reopen_likely_no')}
                  disabled={
                    !session.greenhouseJobId ||
                    isScoring ||
                    !providers.includes(provider)
                  }
                >
                  Reopen Likely-No Bucket
                </Button>
                <p className="text-xs text-muted-foreground ml-auto">
                  Default mode reuses cached scores where the resume + rubric are unchanged.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Footer */}
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={backToSetup}>
              <ChevronLeft className="size-4" />
              Back to Setup
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
