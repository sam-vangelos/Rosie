import { Fragment } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  RunCandidateList,
  type FailedCandidateView,
  type RunCandidateGroupView,
  type RunCandidateView,
  type RunCriterionView,
  type TriagedCandidateView,
} from '@/components/viewer/RunCandidateList';
import { ViewerMasthead } from '@/components/viewer/ViewerMasthead';
import { resolveJobAccess } from '@/lib/job-access';
import { requireViewer } from '@/lib/require-viewer';
import { getRunRubric } from '@/lib/rubric-store';
import { getRunSummary } from '@/lib/run-store';
import type {
  Candidate,
  ScoringRubric,
  ScreeningRunSummary,
} from '@/lib/types';
import {
  groupCandidatesByScore,
  humanizeProvider,
  humanizeStatus,
  isInProgressStatus,
  pluralize,
  REVIEW_THRESHOLD,
  tierFromScore,
} from '@/lib/viewer-format';

export const metadata: Metadata = {
  title: 'Screening run | Rosie',
};

const dateFormatter = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

function formatDate(value: string): string {
  return dateFormatter.format(new Date(value));
}

function joinRoleCompany(role: string, company: string): string | null {
  const parts = [role, company]
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function safeDomId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function prepareCriteria(
  candidate: Candidate,
  rubric: ScoringRubric | null
): RunCriterionView[] {
  const rubricCriteria = rubric?.criteria ?? [];
  const rubricById = new Map(
    rubricCriteria.map((criterion) => [criterion.id, criterion])
  );
  const rubricOrder = new Map(
    rubricCriteria.map((criterion, index) => [criterion.id, index])
  );

  return candidate.scores.criterionScores
    .map((criterion, index) => ({
      criterion,
      index,
      order: rubricOrder.get(criterion.criterionId),
    }))
    .sort((left, right) => {
      if (left.order === undefined && right.order === undefined) {
        return left.index - right.index;
      }
      if (left.order === undefined) return 1;
      if (right.order === undefined) return -1;
      return left.order - right.order;
    })
    .map(({ criterion, index }) => {
      const definition = rubricById.get(criterion.criterionId);
      return {
        key: `${candidate.id}-${criterion.criterionId}-${index}`,
        name: definition?.name ?? criterion.criterionId,
        weight: definition ? `${definition.weight}%` : null,
        score: criterion.score.toFixed(1),
        scoreTier: tierFromScore(criterion.score),
        evidence: criterion.evidence.trim() ? criterion.evidence : null,
      };
    });
}

function prepareCandidateGroups(
  run: ScreeningRunSummary,
  rubric: ScoringRubric | null
): RunCandidateGroupView[] {
  const runDomId = safeDomId(run.id);

  return groupCandidatesByScore(run.fullyScored).map((group) => ({
    id: group.id,
    headingId: `viewer-${runDomId}-${group.id}-heading`,
    label: group.label,
    range: group.range,
    count: group.candidates.length,
    candidates: group.candidates.map(({ candidate, rank }) => {
      const candidateDomId = `viewer-${runDomId}-candidate-${rank}`;
      const view: RunCandidateView = {
        id: `${candidate.id}-${rank}`,
        buttonId: `${candidateDomId}-button`,
        panelId: `${candidateDomId}-panel`,
        rank,
        name: candidate.name,
        roleCompany: joinRoleCompany(
          candidate.currentRole,
          candidate.currentCompany
        ),
        score: candidate.overallScore.toFixed(1),
        scoreTier: tierFromScore(candidate.overallScore),
        greenhouseUrl: candidate.greenhouseUrl?.trim() || null,
        criteria: prepareCriteria(candidate, rubric),
        strengths: candidate.strengths.filter((strength) => strength.trim()),
        gaps: candidate.gaps.filter((gap) => gap.trim()),
      };
      return view;
    }),
  }));
}

function prepareTriaged(run: ScreeningRunSummary): TriagedCandidateView[] {
  return run.likelyNo.map((candidate, index) => ({
    id: `${candidate.candidateId}-triaged-${index}`,
    name: candidate.name,
    roleCompany: joinRoleCompany(
      candidate.currentRole,
      candidate.currentCompany
    ),
    rationale: candidate.rationale.trim() ? candidate.rationale : null,
    audited: candidate.audited,
  }));
}

function prepareFailures(run: ScreeningRunSummary): FailedCandidateView[] {
  return run.failures.map((failure, index) => ({
    id: `${failure.candidateId}-failure-${index}`,
    name: failure.candidateName,
    message: failure.message,
  }));
}

function singleGroupStatement(
  group: RunCandidateGroupView | undefined
): string | null {
  if (!group) return null;

  const candidateNoun = pluralize(group.count, 'candidate');
  if (group.id === 'below') {
    return `No candidate scored at or above ${REVIEW_THRESHOLD.toFixed(
      1
    )} — all ${group.count} scored ${candidateNoun} shown by rank.`;
  }

  return `All ${group.count} scored ${candidateNoun} fall in ${group.label} (${group.range}).`;
}

function ScoringGuide({ rubric }: { rubric: ScoringRubric }) {
  if (rubric.criteria.length === 0) return null;

  return (
    <details className="mt-v-3">
      <summary className="viewer-scoring-summary viewer-focus viewer-interactive text-v-meta font-semibold text-v-ink-2">
        Scoring guide
      </summary>
      <ul className="viewer-divided-list">
        {rubric.criteria.map((criterion, index) => {
          const headingId = `viewer-rubric-${safeDomId(
            criterion.id
          )}-${index}-heading`;
          return (
            <li key={`${criterion.id}-${index}`}>
              <section
                aria-labelledby={headingId}
                className="viewer-static-row"
              >
                <h2
                  className="text-v-body font-[number:var(--v-weight-row)] text-v-ink"
                  id={headingId}
                >
                  {criterion.name}
                </h2>
                <span className="font-mono text-v-meta text-v-ink-3">
                  {criterion.weight}%
                </span>
                <div className="viewer-static-row-detail space-y-v-3">
                  <p className="viewer-measure text-v-body text-v-ink-2">
                    {criterion.description}
                  </p>
                  <dl className="viewer-measure space-y-v-2 text-v-meta text-v-ink-2">
                    <div>
                      <dt className="font-semibold text-v-ink">High</dt>
                      <dd>{criterion.scoringGuide.high}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-v-ink">Mid</dt>
                      <dd>{criterion.scoringGuide.mid}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-v-ink">Low</dt>
                      <dd>{criterion.scoringGuide.low}</dd>
                    </div>
                  </dl>
                </div>
              </section>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await requireViewer();
  const access = await resolveJobAccess(viewer);
  const { id } = await params;
  const run = await getRunSummary(id);

  if (!run) notFound();
  if (access.kind === 'jobs' && !access.jobIds.has(run.jobId)) notFound();

  const rubricRecord = await getRunRubric(id);
  const rubric = rubricRecord?.rubric ?? null;
  const groups = prepareCandidateGroups(run, rubric);
  const triaged = prepareTriaged(run);
  const failures = prepareFailures(run);
  const hasResults =
    groups.length > 0 || triaged.length > 0 || failures.length > 0;
  const completedEmpty = run.status === 'completed' && !hasResults;
  const dateValue = run.finishedAt ?? run.startedAt;
  const refreshHref = `/runs/${encodeURIComponent(run.id)}`;
  return (
    <main className="viewer-shell">
      <div className="viewer-column">
        <ViewerMasthead access={access} viewer={viewer} />

        <Link
          className="viewer-focus viewer-muted-link viewer-link-target text-v-meta"
          href="/runs"
        >
          ← Runs
        </Link>

        <header className="mt-v-5">
          <p className="text-v-label font-semibold uppercase tracking-[var(--v-track-label)] text-v-ink-3">
            SCREENING RUN
          </p>
          <h1 className="mt-v-2 text-balance text-v-display font-semibold text-v-ink">
            {run.jobTitle}
          </h1>
          <p className="mt-v-2 text-v-meta text-v-ink-3">
            <time dateTime={dateValue}>{formatDate(dateValue)}</time> ·{' '}
            {humanizeProvider(run.provider)} · {run.counts.total} screened
          </p>
          {rubric && rubric.criteria.length > 0 ? (
            <p className="mt-v-3 text-v-meta text-v-ink-2">
              {rubric.criteria.map((criterion, index) => (
                <Fragment key={`${criterion.id}-${index}`}>
                  {index > 0 ? ' · ' : null}
                  <span>
                    {criterion.name}{' '}
                    <span className="tabular-nums">{criterion.weight}%</span>
                  </span>
                </Fragment>
              ))}
            </p>
          ) : null}
        </header>

        {rubric ? <ScoringGuide rubric={rubric} /> : null}

        {isInProgressStatus(run.status) ? (
          <div
            className="viewer-status-banner mt-v-5"
            data-status-tone="live"
          >
            <p className="text-v-body text-v-ink">
              {humanizeStatus(run.status)}
              {run.currentActivity ? ` · ${run.currentActivity}` : ''}
            </p>
            <p className="mt-v-1 text-v-meta tabular-nums text-v-ink-3">
              {run.counts.processed} of {run.counts.total} processed
            </p>
            <p className="mt-v-2 text-v-meta text-v-ink-2">
              Partial results — this run is still in progress.
            </p>
            <a
              className="viewer-focus viewer-text-link viewer-link-target text-v-meta text-v-accent-ink"
              href={refreshHref}
            >
              Refresh results
            </a>
          </div>
        ) : null}

        {run.status === 'failed' ? (
          <div
            className="viewer-status-banner mt-v-5"
            data-status-tone="danger"
          >
            <p className="text-v-body text-v-ink">
              {humanizeStatus(run.status)}
            </p>
            <p className="mt-v-1 text-v-meta tabular-nums text-v-ink-3">
              {run.counts.processed} of {run.counts.total} processed
            </p>
            {run.failures.length === 0 ? (
              <p className="mt-v-2 text-v-meta text-v-ink-2">
                The run failed before any candidate was scored.
              </p>
            ) : null}
          </div>
        ) : null}

        {run.status === 'canceled' ? (
          <div
            className="viewer-status-banner mt-v-5"
            data-status-tone="neutral"
          >
            <p className="text-v-body text-v-ink">
              {humanizeStatus(run.status)}
            </p>
            <p className="mt-v-1 text-v-meta text-v-ink-3">
              This run was canceled.
            </p>
          </div>
        ) : null}

        {completedEmpty ? (
          <div className="viewer-empty-state mt-v-6 text-v-body text-v-ink-2">
            This run completed without scoring any candidates.
          </div>
        ) : hasResults ? (
          <div className="mt-v-6">
            <RunCandidateList
              failures={failures}
              groups={groups}
              singleGroupStatement={
                groups.length === 1 ? singleGroupStatement(groups[0]) : null
              }
              triaged={triaged}
            />
          </div>
        ) : null}
      </div>
    </main>
  );
}
