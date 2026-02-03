'use client';

import { ScoringRubric } from '@/lib/types';

interface RubricDisplayProps {
  rubric: ScoringRubric;
}

export function RubricDisplay({ rubric }: RubricDisplayProps) {
  return (
    <div className="space-y-6">
      {/* Must Haves */}
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-accent-red" />
          Must-Haves
        </h3>
        <div className="space-y-2">
          {rubric.mustHaves.map((item, i) => (
            <div key={i} className="flex items-start gap-3 p-3 bg-bg-tertiary rounded-md">
              <div className="flex-shrink-0 w-10 h-6 rounded bg-accent-red/20 text-accent-red text-xs font-medium flex items-center justify-center">
                {item.weight}%
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text-primary">{item.requirement}</p>
                {item.flexibility && (
                  <p className="text-xs text-text-muted mt-1 italic">
                    Flexibility: {item.flexibility}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Nice to Haves */}
      <div>
        <h3 className="text-sm font-medium text-text-primary mb-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-accent-blue" />
          Nice-to-Haves
        </h3>
        <div className="space-y-2">
          {rubric.niceToHaves.map((item, i) => (
            <div key={i} className="flex items-start gap-3 p-3 bg-bg-tertiary rounded-md">
              <div className="flex-shrink-0 w-10 h-6 rounded bg-accent-blue/20 text-accent-blue text-xs font-medium flex items-center justify-center">
                {item.weight}%
              </div>
              <p className="text-sm text-text-primary">{item.requirement}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Hidden Preferences */}
      {rubric.hiddenPreferences.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-text-primary mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-accent-purple" />
            Hidden Preferences (from Intake)
          </h3>
          <div className="space-y-2">
            {rubric.hiddenPreferences.map((item, i) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-bg-tertiary rounded-md">
                <p className="text-sm text-text-primary flex-1">{item.preference}</p>
                <span className="text-xs text-text-muted">{item.source}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Seniority Target */}
      <div className="flex items-center gap-2 p-3 bg-bg-tertiary rounded-md">
        <span className="text-xs font-medium text-text-muted uppercase tracking-wide">
          Target Seniority:
        </span>
        <span className="text-sm text-text-primary">{rubric.seniorityTarget}</span>
      </div>
    </div>
  );
}
