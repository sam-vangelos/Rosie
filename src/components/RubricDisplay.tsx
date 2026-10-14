'use client';

import { ScoringRubric } from '@/lib/types';

interface RubricDisplayProps {
  rubric: ScoringRubric;
}

export function RubricDisplay({ rubric }: RubricDisplayProps) {
  return (
    <div className="space-y-6">
      {/* Discriminative Criteria */}
      <div>
        <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-chart-1" />
          Scoring Criteria
        </h3>
        <div className="space-y-3">
          {rubric.criteria.map((criterion) => (
            <div key={criterion.id} className="p-3 bg-muted rounded-md space-y-2">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-10 h-6 rounded bg-chart-1/20 text-chart-1 text-xs font-medium flex items-center justify-center">
                  {criterion.weight}%
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{criterion.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{criterion.description}</p>
                </div>
              </div>
              <div className="space-y-1 ml-13">
                <div className="flex items-start gap-2 text-xs">
                  <span className="text-tier-top font-medium shrink-0 w-10">9-10:</span>
                  <span className="text-muted-foreground">{criterion.scoringGuide.high}</span>
                </div>
                <div className="flex items-start gap-2 text-xs">
                  <span className="text-tier-moderate font-medium shrink-0 w-10">6-8:</span>
                  <span className="text-muted-foreground">{criterion.scoringGuide.mid}</span>
                </div>
                <div className="flex items-start gap-2 text-xs">
                  <span className="text-tier-below font-medium shrink-0 w-10">1-5:</span>
                  <span className="text-muted-foreground">{criterion.scoringGuide.low}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Table Stakes */}
      {rubric.tableStakes.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-muted-foreground" />
            Table Stakes (not scored)
          </h3>
          <div className="flex flex-wrap gap-2">
            {rubric.tableStakes.map((skill, i) => (
              <span
                key={i}
                className="px-2.5 py-1 bg-muted rounded text-xs text-muted-foreground"
              >
                {skill}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Calibration Summary */}
      {rubric.calibrationSummary && (
        <div className="p-3 bg-chart-1/5 border border-chart-1/20 rounded-md">
          <p className="text-xs font-medium text-foreground mb-1">Calibration Effect</p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {rubric.calibrationSummary}
          </p>
        </div>
      )}
    </div>
  );
}
