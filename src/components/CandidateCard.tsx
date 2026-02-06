'use client';

import { Candidate } from '@/lib/types';
import { ScoreRing } from './ScoreRing';
import { TierBadge } from './TierBadge';
import { useState } from 'react';
import { ChevronDown, ExternalLink, Plus, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';

interface CandidateCardProps {
  candidate: Candidate;
  rank: number;
  selected?: boolean;
  onSelect?: (id: string) => void;
}

export function CandidateCard({ candidate, rank, selected, onSelect }: CandidateCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card
      className={cn(
        'py-0 transition-all',
        selected
          ? 'border-chart-1 bg-chart-1/5'
          : 'hover:border-input',
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          {onSelect && (
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onSelect(candidate.id)}
              className="mt-1 h-4 w-4 rounded border-input bg-muted"
            />
          )}
          <div className="text-muted-foreground font-mono text-sm w-6">#{rank}</div>
          <ScoreRing score={candidate.overallScore} tier={candidate.tier} size="sm" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-foreground">{candidate.name}</h3>
              <TierBadge tier={candidate.tier} size="sm" />
              {candidate.greenhouseUrl && (
                <a
                  href={candidate.greenhouseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-chart-1 transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="size-3" />
                  GH Profile
                </a>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {candidate.currentRole} at {candidate.currentCompany}
            </p>
            <div className="flex items-center gap-3 mt-0.5">
              {candidate.currentStage && (
                <span className="text-xs text-muted-foreground/70">
                  Stage: {candidate.currentStage}
                </span>
              )}
              {candidate.source && candidate.source !== 'Unknown' && (
                <span className="text-xs text-muted-foreground/70">
                  Source: {candidate.source}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown
              className={cn('size-5 transition-transform', expanded && 'rotate-180')}
            />
          </button>
        </div>
      </CardContent>

      {expanded && (
        <div className="border-t px-4 py-4 space-y-4">
          {/* Score Breakdown with visual bars */}
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
              Score Breakdown
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Object.entries(candidate.scores).map(([key, value]) => (
                <div key={key} className="bg-muted rounded-md p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-xs text-muted-foreground capitalize">{key}</div>
                    <div className="text-sm font-semibold text-foreground">{value.toFixed(1)}</div>
                  </div>
                  <div className="h-1.5 bg-background rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${(value / 10) * 100}%`,
                        backgroundColor:
                          value >= 9
                            ? 'var(--tier-top)'
                            : value >= 7
                            ? 'var(--tier-strong)'
                            : value >= 5
                            ? 'var(--tier-moderate)'
                            : 'var(--tier-below)',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Strengths */}
          {candidate.strengths.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Strengths
              </h4>
              <ul className="space-y-1">
                {candidate.strengths.map((strength, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Plus className="size-3.5 text-tier-top mt-0.5 shrink-0" />
                    {strength}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Gaps */}
          {candidate.gaps.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Gaps
              </h4>
              <ul className="space-y-1">
                {candidate.gaps.map((gap, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Minus className="size-3.5 text-tier-moderate mt-0.5 shrink-0" />
                    {gap}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Reasoning */}
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              AI Assessment
            </h4>
            <p className="text-sm text-muted-foreground bg-muted rounded-md p-3 leading-relaxed">
              {candidate.reasoning}
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}
