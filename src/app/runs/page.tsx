import type { Metadata } from 'next';
import { ViewerMasthead } from '@/components/viewer/ViewerMasthead';
import type { ScreeningRunListSummary } from '@/lib/types';
import { resolveJobAccess } from '@/lib/job-access';
import { requireViewer } from '@/lib/require-viewer';
import {
  getRunScoreDistributions,
  listRunSummaries,
  listRunSummariesForJobs,
  type RunScoreDistribution,
} from '@/lib/run-store';
import {
  formatRelativeDate,
  formatRunListEmptyState,
  formatRunVerdict,
  humanizeProvider,
  pluralize,
} from '@/lib/viewer-format';

export const metadata: Metadata = {
  title: 'Screening runs | Rosie',
};

const RUN_LIST_LIMIT = 50;
const RELATIVE_DATE_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;

const absoluteDateFormatter = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const fullTimestampFormatter = new Intl.DateTimeFormat('en', {
  dateStyle: 'full',
  timeStyle: 'long',
});

interface RequisitionRunGroup {
  jobId: number;
  jobTitle: string;
  headingId: string;
  runs: ScreeningRunListSummary[];
}

function groupRunsByRequisition(
  runs: readonly ScreeningRunListSummary[]
): RequisitionRunGroup[] {
  const groups = new Map<number, RequisitionRunGroup>();

  for (const run of runs) {
    const existing = groups.get(run.jobId);
    if (existing) {
      existing.runs.push(run);
      continue;
    }

    groups.set(run.jobId, {
      jobId: run.jobId,
      jobTitle: run.jobTitle,
      headingId: `viewer-job-${run.jobId}-heading`,
      runs: [run],
    });
  }

  return [...groups.values()];
}

function formatRunDate(value: string, now: Date): string {
  const date = new Date(value);
  if (
    Number.isFinite(date.getTime()) &&
    Math.abs(now.getTime() - date.getTime()) < RELATIVE_DATE_WINDOW_MS
  ) {
    return formatRelativeDate(date, now);
  }
  return absoluteDateFormatter.format(date);
}

function statusTone(
  status: ScreeningRunListSummary['status']
): 'live' | 'danger' | 'neutral' {
  if (status === 'failed') return 'danger';
  if (status === 'canceled') return 'neutral';
  return 'live';
}

function RunRow({
  run,
  distribution,
  now,
}: {
  run: ScreeningRunListSummary;
  distribution: RunScoreDistribution | null;
  now: Date;
}) {
  const verdict = formatRunVerdict({
    status: run.status,
    counts: run.counts,
    distribution,
  });
  const dateValue = run.finishedAt ?? run.startedAt;
  const engine = humanizeProvider(run.provider);

  return (
    <li>
      <a
        className="viewer-run-row viewer-focus viewer-interactive"
        href={`/runs/${encodeURIComponent(run.id)}`}
      >
        <span
          className="viewer-verdict"
          data-verdict-tone={verdict.kind === 'text' ? verdict.tone : undefined}
        >
          {verdict.kind === 'status' ? (
            <span
              className="viewer-status-chip"
              data-status-tone={statusTone(run.status)}
            >
              {verdict.primary}
            </span>
          ) : (
            <span className="block text-v-row font-semibold">
              {verdict.primary}
            </span>
          )}
          {verdict.secondary ? (
            <span className="mt-v-1 block text-v-meta tabular-nums text-v-ink-3">
              {verdict.secondary}
            </span>
          ) : null}
        </span>

        <span className="text-v-meta text-v-ink-3" title={engine}>
          {engine}
        </span>

        <time
          className="justify-self-end whitespace-nowrap text-v-meta tabular-nums text-v-ink-3"
          dateTime={dateValue}
          title={fullTimestampFormatter.format(new Date(dateValue))}
        >
          {formatRunDate(dateValue, now)}
        </time>
      </a>
    </li>
  );
}

export default async function RunsPage() {
  const viewer = await requireViewer();
  const access = await resolveJobAccess(viewer);
  const runs =
    access.kind === 'all'
      ? await listRunSummaries(RUN_LIST_LIMIT)
      : await listRunSummariesForJobs([...access.jobIds], RUN_LIST_LIMIT);
  const distributions = await getRunScoreDistributions(
    runs.filter((run) => run.counts.fullyScored > 0).map((run) => run.id)
  );
  const groups = groupRunsByRequisition(runs);
  const now = new Date();
  const emptyState = formatRunListEmptyState(
    access.kind === 'all' ? null : access.jobIds.size
  );

  return (
    <main className="viewer-shell">
      <div className="viewer-column">
        <ViewerMasthead access={access} viewer={viewer} />

        <header>
          <h1 className="text-v-label font-semibold uppercase tracking-[var(--v-track-label)] text-v-ink-3">
            SCREENING RUNS
          </h1>
        </header>

        {groups.length > 0 ? (
          <div className="mt-v-5">
            {groups.map((group) => (
              <section
                aria-labelledby={group.headingId}
                className="viewer-job-group"
                key={group.jobId}
              >
                <header className="viewer-group-header">
                  <h2
                    className="min-w-0 truncate text-v-row font-semibold text-v-ink"
                    id={group.headingId}
                    title={group.jobTitle}
                  >
                    {group.jobTitle}
                  </h2>
                  <span className="ml-auto whitespace-nowrap text-v-label tabular-nums text-v-ink-3">
                    {group.runs.length}{' '}
                    {pluralize(group.runs.length, 'run')}
                  </span>
                </header>
                <ul className="viewer-run-list viewer-divided-list">
                  {group.runs.map((run) => (
                    <RunRow
                      distribution={distributions.get(run.id) ?? null}
                      key={run.id}
                      now={now}
                      run={run}
                    />
                  ))}
                </ul>
              </section>
            ))}
            {runs.length === RUN_LIST_LIMIT ? (
              <p className="mt-v-5 text-v-meta text-v-ink-3">
                Showing the {RUN_LIST_LIMIT} most recent runs.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="viewer-empty-state mt-v-5">
            <h2 className="text-v-row font-semibold text-v-ink">
              {emptyState.heading}
            </h2>
            <p className="mt-v-2 text-v-body text-v-ink-2">
              {emptyState.description}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
