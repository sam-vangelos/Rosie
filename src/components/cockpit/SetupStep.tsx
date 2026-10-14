'use client';

import { Dispatch, useState } from 'react';
import {
  GreenhouseJob,
  SavedRubricSummary,
  ScreeningRunListSummary,
} from '@/lib/types';
import type { ProviderName } from '@/lib/providers/types';
import { CockpitAction, CockpitState } from '@/lib/cockpit-session';
import { cn, qualifyIntakeNotes } from '@/lib/utils';
import { RecentRuns } from '@/components/RecentRuns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, RefreshCw, Search } from 'lucide-react';

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

interface SetupStepProps {
  state: CockpitState;
  dispatch: Dispatch<CockpitAction>;
  ghJobs: GreenhouseJob[];
  ghJobsLoading: boolean;
  onLoadJobs: () => void;
  onSelectJob: (jobId: number) => void;
  recentRuns: ScreeningRunListSummary[];
  onOpenRun: (runId: string) => void;
  savedRubric: SavedRubricSummary | undefined;
  onUseSavedRubric: (savedRubric: SavedRubricSummary) => void;
  providers: ProviderName[];
  isGeneratingRubric: boolean;
  onGenerateRubric: () => void;
}

export function SetupStep({
  state,
  dispatch,
  ghJobs,
  ghJobsLoading,
  onLoadJobs,
  onSelectJob,
  recentRuns,
  onOpenRun,
  savedRubric,
  onUseSavedRubric,
  providers,
  isGeneratingRubric,
  onGenerateRubric,
}: SetupStepProps) {
  const { session, selectedJobId, provider } = state;
  const [jobSearchQuery, setJobSearchQuery] = useState('');

  const filteredJobs = ghJobs.filter(
    (j) =>
      j.name.toLowerCase().includes(jobSearchQuery.toLowerCase()) ||
      j.department.toLowerCase().includes(jobSearchQuery.toLowerCase())
  );

  return (
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
              onClick={onLoadJobs}
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
                    onClick={() => onSelectJob(job.id)}
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

      {recentRuns.length > 0 && (
        <RecentRuns runs={recentRuns} onOpenRun={onOpenRun} />
      )}

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
              dispatch({ type: 'session_field_set', field: 'jobDescription', value: e.target.value })
            }
            className="h-80 resize-none"
            placeholder="Paste the job description or select a Greenhouse job above..."
          />
          {savedRubric && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onUseSavedRubric(savedRubric)}
            >
              Use saved rubric ({savedRubric.criteriaNames.length} criteria
              {savedRubric.calibrated ? ', calibrated' : ''}) from{' '}
              {formatDate(savedRubric.createdAt)}
            </Button>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground flex items-center justify-between">
            Intake Notes
            <span className="text-xs text-muted-foreground font-normal">(optional)</span>
          </label>
          <Textarea
            value={session.intakeNotes}
            onChange={(e) =>
              dispatch({ type: 'session_field_set', field: 'intakeNotes', value: e.target.value })
            }
            className="h-80 resize-none"
            placeholder="Paste notes from your HM intake call. Include must-haves, nice-to-haves, red flags, team context, and what 'good' looks like..."
          />
          {session.intakeNotes.trim() &&
            !qualifyIntakeNotes(session.intakeNotes) && (
              <p className="text-xs text-muted-foreground">
                Add several specific hiring-team criteria to use these
                notes instead of exemplar resumes.
              </p>
            )}
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
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-end">
          <div className="space-y-1">
            <label htmlFor="rubric-provider" className="text-xs font-medium text-muted-foreground">
              Provider
            </label>
            <select
              id="rubric-provider"
              value={provider}
              onChange={(event) =>
                dispatch({ type: 'provider_changed', provider: event.target.value as ProviderName })
              }
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-auto"
            >
              {providers.map((name) => (
                <option key={name} value={name}>
                  {name === 'api' ? 'Anthropic API' : name}
                </option>
              ))}
            </select>
          </div>
          <Button
            onClick={onGenerateRubric}
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
    </div>
  );
}
