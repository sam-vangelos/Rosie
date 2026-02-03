'use client';

import { Candidate, Tier } from '@/lib/types';
import { CandidateCard } from './CandidateCard';
import { useState } from 'react';

interface TierSectionProps {
  tier: Tier;
  candidates: Candidate[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  onAction: (action: 'advance' | 'reject', ids: string[]) => void;
}

const tierConfig = {
  top: {
    label: 'Top Tier',
    scoreRange: '9.0 - 10',
    description: 'Exceptional match for the role',
    color: 'accent-green',
    action: 'Advance All to Screen',
  },
  strong: {
    label: 'Strong',
    scoreRange: '8.0 - 8.9',
    description: 'Strong candidates worth reviewing',
    color: 'accent-blue',
    action: 'Review Individually',
  },
  moderate: {
    label: 'Moderate',
    scoreRange: '7.0 - 7.9',
    description: 'Some gaps but potential fit',
    color: 'accent-orange',
    action: 'Review or Reject',
  },
  below: {
    label: 'Below Threshold',
    scoreRange: '< 7.0',
    description: 'Does not meet minimum requirements',
    color: 'accent-red',
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
          <svg
            className={`w-4 h-4 text-text-muted transition-transform ${collapsed ? '' : 'rotate-90'}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full bg-${config.color}`} style={{ backgroundColor: `var(--${config.color})` }} />
            <h2 className="text-lg font-semibold text-text-primary group-hover:text-text-secondary transition-colors">
              {config.label}
            </h2>
            <span className="text-sm text-text-muted">({config.scoreRange})</span>
          </div>
          <span className="text-sm text-text-muted">{candidates.length} candidates</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onSelectAll(allSelected ? [] : tierCandidateIds)}
            className="text-xs text-text-muted hover:text-text-secondary transition-colors"
          >
            {allSelected ? 'Deselect All' : 'Select All'}
          </button>
          {tier === 'top' && (
            <button
              onClick={() => onAction('advance', tierCandidateIds)}
              className="px-3 py-1.5 text-sm font-medium rounded-md bg-accent-green/10 text-accent-green hover:bg-accent-green/20 transition-colors"
            >
              {config.action}
            </button>
          )}
          {tier === 'below' && (
            <button
              onClick={() => onAction('reject', tierCandidateIds)}
              className="px-3 py-1.5 text-sm font-medium rounded-md bg-accent-red/10 text-accent-red hover:bg-accent-red/20 transition-colors"
            >
              {config.action}
            </button>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="space-y-2 pl-7">
          {candidates.map((candidate, index) => (
            <CandidateCard
              key={candidate.id}
              candidate={candidate}
              rank={index + 1}
              selected={selectedIds.has(candidate.id)}
              onSelect={onToggleSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
