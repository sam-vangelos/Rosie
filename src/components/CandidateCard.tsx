'use client';

import { Candidate } from '@/lib/types';
import { ScoreRing } from './ScoreRing';
import { TierBadge } from './TierBadge';
import { useState } from 'react';

interface CandidateCardProps {
  candidate: Candidate;
  rank: number;
  selected?: boolean;
  onSelect?: (id: string) => void;
}

export function CandidateCard({ candidate, rank, selected, onSelect }: CandidateCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`rounded-lg border transition-all ${
        selected
          ? 'border-accent-blue bg-accent-blue/5'
          : 'border-border-primary bg-bg-secondary hover:border-border-secondary'
      }`}
    >
      <div className="p-4">
        <div className="flex items-start gap-4">
          {onSelect && (
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onSelect(candidate.id)}
              className="mt-1 h-4 w-4 rounded border-border-primary bg-bg-tertiary"
            />
          )}
          <div className="text-text-muted font-mono text-sm w-6">#{rank}</div>
          <ScoreRing score={candidate.overallScore} tier={candidate.tier} size="sm" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-text-primary">{candidate.name}</h3>
              <TierBadge tier={candidate.tier} size="sm" />
            </div>
            <p className="text-sm text-text-secondary mt-0.5">
              {candidate.currentRole} at {candidate.currentCompany}
            </p>
            <p className="text-xs text-text-muted mt-0.5">
              {candidate.yearsExperience} years experience
            </p>
          </div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-text-muted hover:text-text-secondary transition-colors"
          >
            <svg
              className={`w-5 h-5 transition-transform ${expanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border-primary px-4 py-4 space-y-4">
          {/* Score Breakdown */}
          <div>
            <h4 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">
              Score Breakdown
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Object.entries(candidate.scores).map(([key, value]) => (
                <div key={key} className="bg-bg-tertiary rounded-md p-2">
                  <div className="text-xs text-text-muted capitalize">{key}</div>
                  <div className="text-lg font-semibold text-text-primary">{value.toFixed(1)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Strengths */}
          {candidate.strengths.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">
                Strengths
              </h4>
              <ul className="space-y-1">
                {candidate.strengths.map((strength, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-text-secondary">
                    <span className="text-accent-green mt-0.5">+</span>
                    {strength}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Gaps */}
          {candidate.gaps.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">
                Gaps
              </h4>
              <ul className="space-y-1">
                {candidate.gaps.map((gap, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-text-secondary">
                    <span className="text-accent-orange mt-0.5">-</span>
                    {gap}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Reasoning */}
          <div>
            <h4 className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">
              AI Reasoning
            </h4>
            <p className="text-sm text-text-secondary bg-bg-tertiary rounded-md p-3">
              {candidate.reasoning}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
