'use client';

import { IdealPatterns } from '@/lib/types';

interface IdealPatternsDisplayProps {
  patterns: IdealPatterns;
}

const frequencyColors = {
  all: 'bg-accent-green text-accent-green',
  most: 'bg-accent-blue text-accent-blue',
  some: 'bg-accent-orange text-accent-orange',
};

export function IdealPatternsDisplay({ patterns }: IdealPatternsDisplayProps) {
  return (
    <div className="space-y-6">
      {/* Common Skills */}
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-3">Common Skills</h3>
        <div className="flex flex-wrap gap-2">
          {patterns.commonSkills.map((item, i) => (
            <div
              key={i}
              className={`px-3 py-1.5 rounded-md text-sm ${frequencyColors[item.frequency]}/10`}
              style={{
                backgroundColor: `var(--${frequencyColors[item.frequency].split(' ')[0].replace('bg-', '')}20)`,
              }}
            >
              <span className="text-text-primary">{item.skill}</span>
              <span className="text-text-muted ml-2 text-xs">({item.frequency})</span>
            </div>
          ))}
        </div>
      </div>

      {/* Career Patterns */}
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-3">Career Patterns</h3>
        <div className="space-y-2">
          {patterns.careerPatterns.map((item, i) => (
            <div key={i} className="flex items-center gap-3 p-3 bg-bg-tertiary rounded-md">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: `var(--${frequencyColors[item.frequency].split(' ')[0].replace('bg-', '')})` }}
              />
              <span className="text-sm text-text-primary flex-1">{item.pattern}</span>
              <span className="text-xs text-text-muted capitalize">{item.frequency} hires</span>
            </div>
          ))}
        </div>
      </div>

      {/* Achievement Signals */}
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-3">Achievement Signals</h3>
        <div className="space-y-3">
          {patterns.achievementSignals.map((item, i) => (
            <div key={i} className="p-3 bg-bg-tertiary rounded-md">
              <p className="text-sm font-medium text-text-primary mb-2">{item.signal}</p>
              <div className="flex flex-wrap gap-2">
                {item.examples.map((example, j) => (
                  <span
                    key={j}
                    className="px-2 py-1 bg-bg-secondary rounded text-xs text-text-secondary"
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
