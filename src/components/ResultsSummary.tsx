'use client';

import { Candidate, Tier } from '@/lib/types';

interface ResultsSummaryProps {
  candidates: Candidate[];
}

const tierConfig: Record<Tier, { label: string; color: string; range: string }> = {
  top: { label: 'Top Tier', color: '#22c55e', range: '9-10' },
  strong: { label: 'Strong', color: '#3b82f6', range: '8-8.9' },
  moderate: { label: 'Moderate', color: '#f97316', range: '7-7.9' },
  below: { label: 'Below Threshold', color: '#ef4444', range: '<7' },
};

export function ResultsSummary({ candidates }: ResultsSummaryProps) {
  const tiers: Tier[] = ['top', 'strong', 'moderate', 'below'];
  const counts = tiers.map((tier) => ({
    tier,
    count: candidates.filter((c) => c.tier === tier).length,
    config: tierConfig[tier],
  }));

  const total = candidates.length;
  const avgScore = candidates.length > 0
    ? candidates.reduce((sum, c) => sum + c.overallScore, 0) / candidates.length
    : 0;

  return (
    <div className="space-y-6">
      {/* Overall Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-bg-secondary border border-border-primary rounded-lg p-4">
          <p className="text-xs text-text-muted uppercase tracking-wide">Total Screened</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{total}</p>
        </div>
        <div className="bg-bg-secondary border border-border-primary rounded-lg p-4">
          <p className="text-xs text-text-muted uppercase tracking-wide">Avg Score</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{avgScore.toFixed(1)}</p>
        </div>
        <div className="bg-bg-secondary border border-border-primary rounded-lg p-4">
          <p className="text-xs text-text-muted uppercase tracking-wide">Top Tier</p>
          <p className="text-2xl font-bold text-accent-green mt-1">
            {counts.find((c) => c.tier === 'top')?.count || 0}
          </p>
        </div>
        <div className="bg-bg-secondary border border-border-primary rounded-lg p-4">
          <p className="text-xs text-text-muted uppercase tracking-wide">Below Threshold</p>
          <p className="text-2xl font-bold text-accent-red mt-1">
            {counts.find((c) => c.tier === 'below')?.count || 0}
          </p>
        </div>
      </div>

      {/* Tier Distribution */}
      <div className="bg-bg-secondary border border-border-primary rounded-lg p-4">
        <h3 className="text-sm font-medium text-text-primary mb-4">Tier Distribution</h3>
        <div className="space-y-3">
          {counts.map(({ tier, count, config }) => {
            const percentage = total > 0 ? (count / total) * 100 : 0;
            return (
              <div key={tier} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">
                    {config.label} <span className="text-text-muted">({config.range})</span>
                  </span>
                  <span className="text-text-primary font-medium">{count}</span>
                </div>
                <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${percentage}%`,
                      backgroundColor: config.color,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
