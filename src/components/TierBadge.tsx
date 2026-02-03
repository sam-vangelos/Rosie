'use client';

import { Tier } from '@/lib/types';

interface TierBadgeProps {
  tier: Tier;
  size?: 'sm' | 'md';
}

export function TierBadge({ tier, size = 'md' }: TierBadgeProps) {
  const tierLabels = {
    top: 'Top Tier',
    strong: 'Strong',
    moderate: 'Moderate',
    below: 'Below Threshold',
  };

  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm';

  return (
    <span className={`tier-${tier} rounded-full border font-medium ${sizeClasses}`}>
      {tierLabels[tier]}
    </span>
  );
}
