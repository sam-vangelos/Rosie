'use client';

import { Candidate, Tier } from '@/lib/types';

interface ResultsSummaryProps {
  candidates: Candidate[];
}

export function ResultsSummary({ candidates }: ResultsSummaryProps) {
  const counts: Record<Tier, number> = { top: 0, strong: 0, moderate: 0, below: 0 };
  for (const c of candidates) counts[c.tier]++;

  return (
    <p className="text-sm text-muted-foreground">
      {candidates.length} screened
      {counts.top > 0 && (
        <> · <span className="text-tier-top font-medium">{counts.top} top tier</span></>
      )}
      {counts.strong > 0 && (
        <> · <span className="text-tier-strong font-medium">{counts.strong} strong</span></>
      )}
      {counts.moderate > 0 && (
        <> · <span className="text-tier-moderate font-medium">{counts.moderate} moderate</span></>
      )}
      {counts.below > 0 && (
        <> · <span className="text-destructive font-medium">{counts.below} below threshold</span></>
      )}
    </p>
  );
}
