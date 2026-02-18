'use client';

import { Candidate, ScoringRubric } from '@/lib/types';
import { ScoreRing } from './ScoreRing';
import { TierBadge } from './TierBadge';
import { useState } from 'react';
import { ChevronDown, ExternalLink, Plus, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';

interface CandidateCardProps {
  candidate: Candidate;
  rank: number;
  rubric?: ScoringRubric | null;
  selected?: boolean;
  onSelect?: (id: string) => void;
}

function scoreColor(value: number): string {
  if (value >= 9) return 'var(--tier-top)';
  if (value >= 8) return 'var(--tier-strong)';
  if (value >= 7) return 'var(--tier-moderate)';
  return 'var(--tier-below)';
}

export function CandidateCard({ candidate, rank, rubric, selected, onSelect }: CandidateCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);

  const criterionName = (id: string): string => {
    if (!rubric) return id;
    return rubric.criteria.find((c) => c.id === id)?.name ?? id;
  };

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
                  GH
                </a>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              {candidate.currentRole} at {candidate.currentCompany}
            </p>
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
        <div className="border-t px-4 py-3 space-y-3">
          {/* Criterion scores — compact bars, no evidence by default */}
          <div className="space-y-2">
            {candidate.scores.criterionScores.map((cs) => {
              const criterion = rubric?.criteria.find((c) => c.id === cs.criterionId);
              const weight = criterion?.weight ?? 0;
              return (
                <div key={cs.criterionId}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground font-mono w-7 shrink-0">{weight}%</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-foreground font-medium truncate">
                          {criterionName(cs.criterionId)}
                        </span>
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{
                              width: `${(cs.score / 10) * 100}%`,
                              backgroundColor: scoreColor(cs.score),
                            }}
                          />
                        </div>
                        <span className="text-xs font-semibold text-foreground w-7 text-right">{cs.score.toFixed(1)}</span>
                      </div>
                    </div>
                  </div>
                  {showEvidence && cs.evidence && (
                    <p className="text-xs text-muted-foreground ml-9 mt-0.5">{cs.evidence}</p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Evidence toggle */}
          <button
            onClick={() => setShowEvidence(!showEvidence)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showEvidence ? 'Hide evidence' : 'Show evidence'}
          </button>

          {/* Strengths + Gaps inline */}
          <div className="flex flex-col sm:flex-row gap-3">
            {candidate.strengths.length > 0 && (
              <div className="flex-1">
                <ul className="space-y-0.5">
                  {candidate.strengths.map((s, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <Plus className="size-3 text-tier-top mt-0.5 shrink-0" />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {candidate.gaps.length > 0 && (
              <div className="flex-1">
                <ul className="space-y-0.5">
                  {candidate.gaps.map((g, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <Minus className="size-3 text-tier-moderate mt-0.5 shrink-0" />
                      {g}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
