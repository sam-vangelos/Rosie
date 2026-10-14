'use client';

import { Tier } from '@/lib/types';

interface ScoreRingProps {
  score: number;
  tier: Tier;
  size?: 'sm' | 'md' | 'lg';
}

export function ScoreRing({ score, tier, size = 'md' }: ScoreRingProps) {
  const sizeConfig = {
    sm: { width: 48, stroke: 4, fontSize: 'text-sm' },
    md: { width: 64, stroke: 5, fontSize: 'text-lg' },
    lg: { width: 80, stroke: 6, fontSize: 'text-xl' },
  };

  const config = sizeConfig[size];
  const radius = (config.width - config.stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 10) * circumference;

  return (
    <div className="relative" style={{ width: config.width, height: config.width }}>
      <svg className="score-ring" width={config.width} height={config.width}>
        <circle
          cx={config.width / 2}
          cy={config.width / 2}
          r={radius}
          fill="none"
          className="stroke-border"
          strokeWidth={config.stroke}
        />
        <circle
          cx={config.width / 2}
          cy={config.width / 2}
          r={radius}
          fill="none"
          className={`stroke-tier-${tier}`}
          strokeWidth={config.stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - progress}
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
      </svg>
      <div
        className={`absolute inset-0 flex items-center justify-center font-bold ${config.fontSize} text-tier-${tier}`}
      >
        {score.toFixed(1)}
      </div>
    </div>
  );
}
