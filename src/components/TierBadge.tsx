'use client';

import { Tier } from '@/lib/types';
import { cn } from '@/lib/utils';

interface TierBadgeProps {
  tier: Tier;
  size?: 'sm' | 'md';
}

const tierLabels: Record<Tier, string> = {
  top: 'Top Tier',
  strong: 'Strong',
  moderate: 'Moderate',
  below: 'Below Threshold',
};

export function TierBadge({ tier, size = 'md' }: TierBadgeProps) {
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm';

  return (
    <span
      className={cn(
        'rounded-full border font-medium',
        sizeClasses,
        `border-tier-${tier} text-tier-${tier} bg-tier-${tier}/10`,
      )}
    >
      {tierLabels[tier]}
    </span>
  );
}
