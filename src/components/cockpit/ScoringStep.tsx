'use client';

import { CockpitState } from '@/lib/cockpit-session';
import { ResultsSummary } from '@/components/ResultsSummary';
import { ScoringProgress } from '@/components/ScoringProgress';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sparkles } from 'lucide-react';

interface ScoringStepProps {
  state: CockpitState;
  onCancelScoring: () => void;
}

export function ScoringStep({ state, onCancelScoring }: ScoringStepProps) {
  const { session, scoringProgress, activeRun, isFetchingCandidates } = state;

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="space-y-8 max-w-3xl w-full">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-2">
            {isFetchingCandidates ? 'Preparing Candidates' : 'Scoring Candidates'}
          </h2>
          <p className="text-muted-foreground">
            {isFetchingCandidates
              ? 'Fetching applicants and building resume artifacts on the server.'
              : 'Rosie is triaging first, then escalating the strongest and most ambiguous candidates to full scoring.'}
          </p>
        </div>
        <ScoringProgress
          total={scoringProgress.total}
          completed={scoringProgress.completed}
          currentCandidate={scoringProgress.current}
          failed={scoringProgress.failed}
        />
        {activeRun && (
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardContent className="p-4 space-y-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Fully scored</p>
                <p className="text-2xl font-semibold text-foreground">{activeRun.counts.fullyScored}</p>
                <p className="text-xs text-muted-foreground">Partial shortlist updates live as the run progresses.</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 space-y-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Likely no</p>
                <p className="text-2xl font-semibold text-foreground">{activeRun.counts.triagedLikelyNo}</p>
                <p className="text-xs text-muted-foreground">
                  {activeRun.audit.sampled > 0
                    ? `${activeRun.audit.sampled} audited · ${activeRun.audit.disagreements} disagreements`
                    : 'Audit kicks in once Rosie has a likely-no sample.'}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 space-y-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Cache reuse</p>
                <p className="text-2xl font-semibold text-foreground">{activeRun.counts.cached}</p>
                <p className="text-xs text-muted-foreground">Unchanged resumes + rubric versions skip redundant model work.</p>
              </CardContent>
            </Card>
          </div>
        )}
        {session.candidates.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="size-4 text-chart-1" />
                Partial Results
              </CardTitle>
              <CardDescription>
                Rosie is already surfacing fully scored candidates while the rest of the run continues.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <ResultsSummary candidates={session.candidates} />
              <div className="space-y-2">
                {session.candidates.slice(0, 5).map((candidate, index) => (
                  <div
                    key={candidate.id}
                    className="flex items-center justify-between rounded-lg border px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        #{index + 1} {candidate.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {candidate.currentRole} at {candidate.currentCompany}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-foreground">{candidate.overallScore.toFixed(1)}</p>
                      <p className="text-xs text-muted-foreground capitalize">{candidate.tier}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancelScoring}
          className="text-muted-foreground hover:text-destructive"
        >
          Cancel Scoring
        </Button>
      </div>
    </div>
  );
}
