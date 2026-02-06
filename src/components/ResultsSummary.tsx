'use client';

import { Candidate, Tier } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ResultsSummaryProps {
  candidates: Candidate[];
}

const tierConfig: Record<Tier, { label: string; range: string }> = {
  top: { label: 'Top Tier', range: '9-10' },
  strong: { label: 'Strong', range: '8-8.9' },
  moderate: { label: 'Moderate', range: '7-7.9' },
  below: { label: 'Below Threshold', range: '<7' },
};

export function ResultsSummary({ candidates }: ResultsSummaryProps) {
  const tiers: Tier[] = ['top', 'strong', 'moderate', 'below'];
  const counts = tiers.map((tier) => ({
    tier,
    count: candidates.filter((c) => c.tier === tier).length,
    config: tierConfig[tier],
  }));

  const total = candidates.length;
  const avgScore =
    candidates.length > 0
      ? candidates.reduce((sum, c) => sum + c.overallScore, 0) / candidates.length
      : 0;

  const sorted = [...candidates].sort((a, b) => a.overallScore - b.overallScore);
  const medianScore =
    sorted.length > 0
      ? sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1].overallScore + sorted[sorted.length / 2].overallScore) / 2
        : sorted[Math.floor(sorted.length / 2)].overallScore
      : 0;

  return (
    <div className="space-y-6">
      {/* Overall Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="py-4">
          <CardContent className="px-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Screened</p>
            <p className="text-2xl font-bold text-foreground mt-1">{total}</p>
          </CardContent>
        </Card>
        <Card className="py-4">
          <CardContent className="px-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Avg Score</p>
            <p className="text-2xl font-bold text-foreground mt-1">{avgScore.toFixed(1)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Median: {medianScore.toFixed(1)}</p>
          </CardContent>
        </Card>
        <Card className="py-4">
          <CardContent className="px-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Top Tier</p>
            <p className="text-2xl font-bold text-tier-top mt-1">
              {counts.find((c) => c.tier === 'top')?.count || 0}
            </p>
          </CardContent>
        </Card>
        <Card className="py-4">
          <CardContent className="px-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Below Threshold</p>
            <p className="text-2xl font-bold text-destructive mt-1">
              {counts.find((c) => c.tier === 'below')?.count || 0}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tier Distribution */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Tier Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {counts.map(({ tier, count, config }) => {
              const percentage = total > 0 ? (count / total) * 100 : 0;
              return (
                <div key={tier} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {config.label}{' '}
                      <span className="text-muted-foreground/60">({config.range})</span>
                    </span>
                    <span className="text-foreground font-medium">
                      {count}{' '}
                      <span className="text-muted-foreground text-xs">({percentage.toFixed(0)}%)</span>
                    </span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${percentage}%`,
                        backgroundColor: `var(--tier-${tier})`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
