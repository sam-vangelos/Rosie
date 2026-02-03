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

  const tierColors = {
    top: '#22c55e',
    strong: '#3b82f6',
    moderate: '#f97316',
    below: '#ef4444',
  };

  const color = tierColors[tier];

  return (
    <div className="relative" style={{ width: config.width, height: config.width }}>
      <svg className="score-ring" width={config.width} height={config.width}>
        {/* Background circle */}
        <circle
          cx={config.width / 2}
          cy={config.width / 2}
          r={radius}
          fill="none"
          stroke="#2a2a2a"
          strokeWidth={config.stroke}
        />
        {/* Progress circle */}
        <circle
          cx={config.width / 2}
          cy={config.width / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={config.stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - progress}
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
      </svg>
      <div
        className={`absolute inset-0 flex items-center justify-center font-bold ${config.fontSize}`}
        style={{ color }}
      >
        {score.toFixed(1)}
      </div>
    </div>
  );
}
