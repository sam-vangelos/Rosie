'use client';

import { Dispatch } from 'react';
import { Candidate, Tier } from '@/lib/types';
import {
  CockpitAction,
  CockpitState,
  filterCandidates,
} from '@/lib/cockpit-session';
import { ResultsSummary } from '@/components/ResultsSummary';
import { TierSection } from '@/components/TierSection';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Download, Search } from 'lucide-react';

interface ResultsStepProps {
  state: CockpitState;
  dispatch: Dispatch<CockpitAction>;
  onNotify: (message: { type: 'success' | 'error'; text: string }) => void;
}

export function ResultsStep({ state, dispatch, onNotify }: ResultsStepProps) {
  const { session, activeRun, candidateSearchQuery, selectedCandidates } = state;

  const filteredCandidates = filterCandidates(session.candidates, candidateSearchQuery);

  const candidatesByTier = filteredCandidates.reduce(
    (acc, candidate) => {
      acc[candidate.tier].push(candidate);
      return acc;
    },
    { top: [], strong: [], moderate: [], below: [] } as Record<Tier, Candidate[]>
  );

  const globalRankMap = new Map<string, number>();
  session.candidates.forEach((c, i) => globalRankMap.set(c.id, i + 1));

  const exportCsv = () => {
    // Build dynamic headers from rubric criteria
    const criteriaHeaders = session.rubric?.criteria.map((c) => c.name) || [];
    const headers = [
      'Rank', 'Name', 'Email', 'Role', 'Company', 'Overall Score', 'Tier',
      ...criteriaHeaders,
      'Strengths', 'Gaps', 'Greenhouse URL',
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
    onNotify({ type: 'success', text: 'CSV exported' });
  };

  const exportRunJson = async () => {
    if (!activeRun) return;
    const res = await fetch(`/api/runs/${activeRun.id}/export`);
    const payload = await res.json();
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rosie-run-${activeRun.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onNotify({ type: 'success', text: 'Run handoff exported' });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">{session.jobTitle || 'Screening Results'}</h2>
          <ResultsSummary candidates={session.candidates} />
          {activeRun && (
            <p className="text-xs text-muted-foreground mt-1">
              {activeRun.counts.triagedLikelyNo} triaged likely-no
              {activeRun.audit.sampled > 0
                ? ` · ${activeRun.audit.sampled} audited`
                : ''}
              {activeRun.counts.failed > 0
                ? ` · ${activeRun.counts.failed} failed`
                : ''}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              dispatch({ type: 'nav_requested', nav: { step: 2, status: 'calibrating' } })
            }
          >
            Back to Calibrate
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="size-4" />
            Export CSV
          </Button>
          {activeRun && (
            <Button variant="outline" size="sm" onClick={exportRunJson}>
              Export Run JSON
            </Button>
          )}
        </div>
      </div>

      {/* Candidate search */}
      {session.candidates.length > 5 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={candidateSearchQuery}
            onChange={(e) => dispatch({ type: 'search_changed', query: e.target.value })}
            placeholder="Search candidates by name, role, or company..."
            className="pl-9"
          />
        </div>
      )}

      {activeRun && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Run Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              <p>{activeRun.counts.cached} cached score hits</p>
              <p>{activeRun.counts.escalated} escalated to full scoring</p>
              <p>{activeRun.counts.failed} parse/model failures</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Audit</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              <p>{activeRun.audit.sampled} likely-no resumes audited</p>
              <p>{activeRun.audit.disagreements} audit disagreements</p>
              <p>{activeRun.audit.strongSignalsFound} strong signals found</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Likely-No Bucket</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>{activeRun.likelyNo.length} candidates left triaged-only</p>
              {activeRun.likelyNo.slice(0, 3).map((candidate) => (
                <div key={candidate.candidateId} className="rounded-md bg-muted px-2 py-1.5">
                  <p className="font-medium text-foreground">{candidate.name}</p>
                  <p className="text-xs">{candidate.currentRole} at {candidate.currentCompany}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      <div className="space-y-6">
        {candidateSearchQuery.trim() && filteredCandidates.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-sm">No candidates match &ldquo;{candidateSearchQuery}&rdquo;</p>
            <button
              className="text-sm text-chart-1 hover:underline mt-1"
              onClick={() => dispatch({ type: 'search_changed', query: '' })}
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
              onClick={() => dispatch({ type: 'step_back', step: 2 })}
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
            onToggleSelect={(id) => dispatch({ type: 'selection_toggled', id })}
            onSelectAll={(action, ids) => dispatch({ type: 'selection_bulk', action, ids })}
            globalRankMap={globalRankMap}
          />
        ))}
      </div>

      <div className="border-t pt-8 flex justify-center">
        <Button
          variant="ghost"
          onClick={() => dispatch({ type: 'nav_requested', nav: { step: 1, status: 'setup' } })}
        >
          Start New Screening Session
        </Button>
      </div>
    </div>
  );
}
