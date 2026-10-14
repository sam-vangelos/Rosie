import type { ScreeningRunListSummary, ScreeningRunStatus } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function formatStatus(status: ScreeningRunStatus): string {
  return status.replaceAll('_', ' ');
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value));
}

export function RecentRuns({
  runs,
  onOpenRun,
}: {
  runs: ScreeningRunListSummary[];
  onOpenRun: (runId: string) => void;
}) {
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="px-4 py-3">
        <CardTitle className="text-sm">Recent runs</CardTitle>
      </CardHeader>
      <CardContent className="divide-y px-0">
        {runs.map((run) => {
          const viewable = !['canceled', 'failed'].includes(run.status);
          return (
            <button
              key={run.id}
              className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left enabled:hover:bg-muted/50 disabled:cursor-default"
              onClick={() => onOpenRun(run.id)}
              disabled={!viewable}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{run.jobTitle}</p>
                <p className="text-xs text-muted-foreground">{formatDate(run.startedAt)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Badge
                  variant={
                    run.status === 'completed'
                      ? 'default'
                      : run.status === 'failed'
                        ? 'destructive'
                        : 'secondary'
                  }
                  className="capitalize"
                >
                  {formatStatus(run.status)}
                </Badge>
                <span className="w-12 text-right text-xs text-muted-foreground">
                  {run.counts.fullyScored}/{run.counts.total}
                </span>
              </div>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}
