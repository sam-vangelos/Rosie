'use client';

import { Loader2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

interface ScoringProgressProps {
  total: number;
  completed: number;
  currentCandidate?: string;
  failed?: number;
}

export function ScoringProgress({ total, completed, currentCandidate, failed = 0 }: ScoringProgressProps) {
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="w-full max-w-md mx-auto space-y-4">
      <div className="text-center">
        <div className="text-6xl font-bold text-chart-1 mb-2">{percentage}%</div>
        <p className="text-muted-foreground">
          {total > 0 ? (
            <>
              Scored {completed} of {total} candidates
              {failed > 0 && (
                <span className="text-tier-moderate"> ({failed} failed)</span>
              )}
            </>
          ) : (
            'Preparing...'
          )}
        </p>
      </div>

      <Progress value={percentage} />

      {currentCandidate && (
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {currentCandidate}
        </div>
      )}
    </div>
  );
}
