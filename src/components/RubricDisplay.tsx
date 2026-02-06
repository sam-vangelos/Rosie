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
        <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-destructive" />
          Must-Haves
        </h3>
        <div className="space-y-2">
          {rubric.mustHaves.map((item, i) => (
            <div key={i} className="flex items-start gap-3 p-3 bg-muted rounded-md">
              <div className="flex-shrink-0 w-10 h-6 rounded bg-destructive/20 text-destructive text-xs font-medium flex items-center justify-center">
                {item.weight}%
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground">{item.requirement}</p>
                {item.flexibility && (
                  <p className="text-xs text-muted-foreground mt-1 italic">
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
        <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-chart-1" />
          Nice-to-Haves
        </h3>
        <div className="space-y-2">
          {rubric.niceToHaves.map((item, i) => (
            <div key={i} className="flex items-start gap-3 p-3 bg-muted rounded-md">
              <div className="flex-shrink-0 w-10 h-6 rounded bg-chart-1/20 text-chart-1 text-xs font-medium flex items-center justify-center">
                {item.weight}%
              </div>
              <p className="text-sm text-foreground">{item.requirement}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Contextual Signals */}
      {rubric.hiddenPreferences.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-chart-4" />
            Contextual Signals (from Intake)
          </h3>
          <div className="space-y-2">
            {rubric.hiddenPreferences.map((item, i) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-muted rounded-md">
                <p className="text-sm text-foreground flex-1">{item.preference}</p>
                <span className="text-xs text-muted-foreground">{item.source}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Seniority Target */}
      <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Target Seniority:
        </span>
        <span className="text-sm text-foreground">{rubric.seniorityTarget}</span>
      </div>
    </div>
  );
}
