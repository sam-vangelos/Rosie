'use client';

import { IdealPatterns } from '@/lib/types';
import { cn } from '@/lib/utils';

interface IdealPatternsDisplayProps {
  patterns: IdealPatterns;
}

const frequencyClasses = {
  all: 'bg-tier-top/10 text-tier-top',
  most: 'bg-chart-1/10 text-chart-1',
  some: 'bg-tier-moderate/10 text-tier-moderate',
};

export function IdealPatternsDisplay({ patterns }: IdealPatternsDisplayProps) {
  return (
    <div className="space-y-6">
      {/* Common Skills */}
      <div>
        <h3 className="text-sm font-medium text-foreground mb-3">Common Skills</h3>
        <div className="flex flex-wrap gap-2">
          {patterns.commonSkills.map((item, i) => (
            <div
              key={i}
              className={cn('px-3 py-1.5 rounded-md text-sm', frequencyClasses[item.frequency])}
            >
              <span className="text-foreground">{item.skill}</span>
              <span className="text-muted-foreground ml-2 text-xs">({item.frequency})</span>
            </div>
          ))}
        </div>
      </div>

      {/* Career Patterns */}
      <div>
        <h3 className="text-sm font-medium text-foreground mb-3">Career Patterns</h3>
        <div className="space-y-2">
          {patterns.careerPatterns.map((item, i) => (
            <div key={i} className="flex items-center gap-3 p-3 bg-muted rounded-md">
              <div
                className={cn(
                  'w-2 h-2 rounded-full',
                  item.frequency === 'all'
                    ? 'bg-tier-top'
                    : item.frequency === 'most'
                    ? 'bg-chart-1'
                    : 'bg-tier-moderate',
                )}
              />
              <span className="text-sm text-foreground flex-1">{item.pattern}</span>
              <span className="text-xs text-muted-foreground capitalize">{item.frequency} hires</span>
            </div>
          ))}
        </div>
      </div>

      {/* Achievement Signals */}
      <div>
        <h3 className="text-sm font-medium text-foreground mb-3">Achievement Signals</h3>
        <div className="space-y-3">
          {patterns.achievementSignals.map((item, i) => (
            <div key={i} className="p-3 bg-muted rounded-md">
              <p className="text-sm font-medium text-foreground mb-2">{item.signal}</p>
              <div className="flex flex-wrap gap-2">
                {item.examples.map((example, j) => (
                  <span
                    key={j}
                    className="px-2 py-1 bg-card rounded text-xs text-muted-foreground"
                  >
                    &ldquo;{example}&rdquo;
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
