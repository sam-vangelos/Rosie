'use client';

import { Candidate, Tier } from '@/lib/types';
import { CandidateCard } from './CandidateCard';
import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface TierSectionProps {
  tier: Tier;
  candidates: Candidate[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  onAction: (action: 'advance' | 'reject', ids: string[]) => void;
  globalRankMap?: Map<string, number>;
}

const tierConfig = {
  top: {
    label: 'Top Tier',
    scoreRange: '9.0 - 10',
    description: 'Exceptional match for the role',
    action: 'Advance All to Screen',
  },
  strong: {
    label: 'Strong',
    scoreRange: '8.0 - 8.9',
    description: 'Strong candidates worth reviewing',
    action: 'Review Individually',
  },
  moderate: {
    label: 'Moderate',
    scoreRange: '7.0 - 7.9',
    description: 'Some gaps but potential fit',
    action: 'Review or Reject',
  },
  below: {
    label: 'Below Threshold',
    scoreRange: '< 7.0',
    description: 'Does not meet minimum requirements',
    action: 'Bulk Reject',
  },
};

export function TierSection({
  tier,
  candidates,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onAction,
  globalRankMap,
}: TierSectionProps) {
  const [collapsed, setCollapsed] = useState(tier === 'below');
  const config = tierConfig[tier];
  const tierCandidateIds = candidates.map((c) => c.id);
  const selectedInTier = tierCandidateIds.filter((id) => selectedIds.has(id));
  const allSelected = selectedInTier.length === candidates.length && candidates.length > 0;

  if (candidates.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-3 group"
        >
          <ChevronRight
            className={cn(
              'size-4 text-muted-foreground transition-transform',
              !collapsed && 'rotate-90',
            )}
          />
          <div className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: `var(--tier-${tier})` }}
            />
            <h2 className="text-lg font-semibold text-foreground group-hover:text-muted-foreground transition-colors">
              {config.label}
            </h2>
            <span className="text-sm text-muted-foreground">({config.scoreRange})</span>
          </div>
          <span className="text-sm text-muted-foreground">{candidates.length} candidates</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onSelectAll(allSelected ? [] : tierCandidateIds)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {allSelected ? 'Deselect All' : 'Select All'}
          </button>
          {tier === 'top' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onAction('advance', tierCandidateIds)}
              className="text-tier-top hover:text-tier-top hover:bg-tier-top/10"
            >
              {config.action}
            </Button>
          )}
          {tier === 'below' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onAction('reject', tierCandidateIds)}
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              {config.action}
            </Button>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="space-y-2 pl-7">
          {candidates.map((candidate) => (
            <CandidateCard
              key={candidate.id}
              candidate={candidate}
              rank={globalRankMap?.get(candidate.id) || 0}
              selected={selectedIds.has(candidate.id)}
              onSelect={onToggleSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
