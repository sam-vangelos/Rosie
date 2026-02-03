'use client';

interface ScoringProgressProps {
  total: number;
  completed: number;
  currentCandidate?: string;
}

export function ScoringProgress({ total, completed, currentCandidate }: ScoringProgressProps) {
  const percentage = Math.round((completed / total) * 100);

  return (
    <div className="w-full max-w-md mx-auto space-y-4">
      <div className="text-center">
        <div className="text-6xl font-bold text-accent-blue mb-2">{percentage}%</div>
        <p className="text-text-secondary">
          Scored {completed} of {total} candidates
        </p>
      </div>

      <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden">
        <div
          className="h-full bg-accent-blue transition-all duration-300 ease-out"
          style={{ width: `${percentage}%` }}
        />
      </div>

      {currentCandidate && (
        <div className="flex items-center justify-center gap-2 text-sm text-text-muted">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          Analyzing {currentCandidate}...
        </div>
      )}
    </div>
  );
}
