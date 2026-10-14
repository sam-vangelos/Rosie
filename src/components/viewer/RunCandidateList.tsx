'use client';

import { useState } from 'react';
import type { Tier } from '@/lib/types';

export interface RunCriterionView {
  key: string;
  name: string;
  weight: string | null;
  score: string;
  scoreTier: Tier;
  evidence: string | null;
}

export interface RunCandidateView {
  id: string;
  buttonId: string;
  panelId: string;
  rank: number;
  name: string;
  roleCompany: string | null;
  score: string;
  scoreTier: Tier;
  greenhouseUrl: string | null;
  criteria: RunCriterionView[];
  strengths: string[];
  gaps: string[];
}

export interface RunCandidateGroupView {
  id: Tier;
  headingId: string;
  label: string;
  range: string;
  count: number;
  candidates: RunCandidateView[];
}

export interface TriagedCandidateView {
  id: string;
  name: string;
  roleCompany: string | null;
  rationale: string | null;
  audited: boolean;
}

export interface FailedCandidateView {
  id: string;
  name: string;
  message: string;
}

interface RunCandidateListProps {
  groups: RunCandidateGroupView[];
  triaged: TriagedCandidateView[];
  failures: FailedCandidateView[];
  singleGroupStatement: string | null;
}

type GroupTone = Tier | 'neutral' | 'danger';

export function filterViewerResults(
  groups: RunCandidateGroupView[],
  triaged: TriagedCandidateView[],
  failures: FailedCandidateView[],
  query: string
): {
  groups: RunCandidateGroupView[];
  triaged: TriagedCandidateView[];
  failures: FailedCandidateView[];
} {
  const term = query.trim().toLowerCase();
  if (!term) return { groups, triaged, failures };

  const includesTerm = (...values: Array<string | null>) =>
    values.some((value) => value?.toLowerCase().includes(term));

  const filteredGroups = groups
    .map((group) => {
      const candidates = group.candidates.filter((candidate) =>
        includesTerm(candidate.name, candidate.roleCompany)
      );
      return { ...group, count: candidates.length, candidates };
    })
    .filter((group) => group.count > 0);

  return {
    groups: filteredGroups,
    triaged: triaged.filter((candidate) =>
      includesTerm(candidate.name, candidate.roleCompany)
    ),
    failures: failures.filter((candidate) =>
      includesTerm(candidate.name)
    ),
  };
}

function GroupHeader({
  headingId,
  label,
  range,
  count,
  tone,
}: {
  headingId: string;
  label: string;
  range: string | null;
  count: number;
  tone: GroupTone;
}) {
  return (
    <header className="viewer-group-header">
      <span
        aria-hidden="true"
        className="viewer-group-dot"
        data-group-tone={tone}
        data-score-tier={tone}
      />
      <h2
        id={headingId}
        className="text-v-label font-semibold uppercase tracking-[var(--v-track-label)] text-v-ink"
      >
        {label}
      </h2>
      {range ? (
        <span className="text-v-label text-v-ink-3">{range}</span>
      ) : null}
      <span className="ml-auto text-v-label tabular-nums text-v-ink-3">
        {count}
      </span>
    </header>
  );
}

function CandidatePanel({ candidate }: { candidate: RunCandidateView }) {
  const hasStrengthsOrGaps =
    candidate.strengths.length > 0 || candidate.gaps.length > 0;

  return (
    <div
      id={candidate.panelId}
      aria-labelledby={candidate.buttonId}
      className="viewer-candidate-panel"
      role="region"
    >
      <div className="space-y-v-5">
        {candidate.greenhouseUrl ? (
          <div>
            <a
              aria-label={`Open ${candidate.name} in Greenhouse`}
              className="viewer-focus viewer-text-link viewer-link-target text-v-meta text-v-accent-ink"
              href={candidate.greenhouseUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              Open in Greenhouse ↗
            </a>
          </div>
        ) : null}

        {candidate.criteria.length > 0 ? (
          <div className="space-y-v-4">
            {candidate.criteria.map((criterion) => (
              <section key={criterion.key}>
                <div className="viewer-criterion-header">
                  <h3 className="viewer-criterion-name text-v-body font-[number:var(--v-weight-row)] text-v-ink">
                    {criterion.name}
                  </h3>
                  {criterion.weight ? (
                    <span className="viewer-criterion-weight font-mono text-v-meta text-v-ink-3">
                      {criterion.weight}
                    </span>
                  ) : null}
                  <span
                    className="viewer-criterion-score viewer-score-text font-mono text-v-body font-semibold tabular-nums"
                    data-score-tier={criterion.scoreTier}
                  >
                    {criterion.score}
                  </span>
                </div>
                {criterion.evidence ? (
                  <p className="viewer-measure mt-v-1 text-v-body text-v-ink-2">
                    {criterion.evidence}
                  </p>
                ) : null}
              </section>
            ))}
          </div>
        ) : null}

        {hasStrengthsOrGaps ? (
          <div className="viewer-strength-gap-grid">
            {candidate.strengths.length > 0 ? (
              <section>
                <h3 className="text-v-label font-semibold uppercase tracking-[var(--v-track-label)] text-v-ink-3">
                  STRENGTHS
                </h3>
                <ul className="mt-v-2 space-y-v-1 text-v-body text-v-ink-2">
                  {candidate.strengths.map((strength, index) => (
                    <li
                      className="viewer-simple-list-item"
                      key={`${candidate.id}-strength-${index}`}
                    >
                      <span aria-hidden="true">·</span>
                      <span>{strength}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {candidate.gaps.length > 0 ? (
              <section>
                <h3 className="text-v-label font-semibold uppercase tracking-[var(--v-track-label)] text-v-ink-3">
                  GAPS
                </h3>
                <ul className="mt-v-2 space-y-v-1 text-v-body text-v-ink-2">
                  {candidate.gaps.map((gap, index) => (
                    <li
                      className="viewer-simple-list-item"
                      key={`${candidate.id}-gap-${index}`}
                    >
                      <span aria-hidden="true">·</span>
                      <span>{gap}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function RunCandidateList({
  groups,
  triaged,
  failures,
  singleGroupStatement,
}: RunCandidateListProps) {
  const [query, setQuery] = useState('');
  const [expandedCandidateIds, setExpandedCandidateIds] = useState<Set<string>>(
    () => new Set()
  );
  const filtered = filterViewerResults(groups, triaged, failures, query);
  const normalizedQuery = query.trim();
  const originalTotal =
    groups.reduce((total, group) => total + group.candidates.length, 0) +
    triaged.length +
    failures.length;
  const scoredCount = filtered.groups.reduce(
    (total, group) => total + group.candidates.length,
    0
  );
  const filteredTotal =
    scoredCount + filtered.triaged.length + filtered.failures.length;
  const sections = [
    scoredCount > 0
      ? { href: '#viewer-scored', label: 'Scored', count: scoredCount }
      : null,
    filtered.triaged.length > 0
      ? {
          href: '#viewer-triaged',
          label: 'Triaged out',
          count: filtered.triaged.length,
        }
      : null,
    filtered.failures.length > 0
      ? {
          href: '#viewer-failed',
          label: 'Failed',
          count: filtered.failures.length,
        }
      : null,
  ].filter(
    (
      section
    ): section is { href: string; label: string; count: number } =>
      section !== null
  );
  const showSearch = originalTotal >= 20;
  const showSectionLinks = sections.length >= 2;

  function toggleCandidate(candidateId: string) {
    setExpandedCandidateIds((current) => {
      const next = new Set(current);
      if (next.has(candidateId)) next.delete(candidateId);
      else next.add(candidateId);
      return next;
    });
  }

  return (
    <div>
      {showSearch || showSectionLinks ? (
        <div className="viewer-result-tools">
          {showSearch ? (
            <div className="viewer-search-field">
              <label className="sr-only" htmlFor="viewer-candidate-search">
                Search candidates
              </label>
              <input
                className="viewer-search-input viewer-focus text-v-body text-v-ink"
                id="viewer-candidate-search"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search candidates"
                type="search"
                value={query}
              />
            </div>
          ) : null}
          {showSectionLinks ? (
            <nav aria-label="Result sections" className="viewer-result-nav">
              <ul className="viewer-result-nav-list">
                {sections.map((section) => (
                  <li key={section.href}>
                    <a
                      className="viewer-focus viewer-muted-link viewer-link-target text-v-meta"
                      href={section.href}
                    >
                      {section.label}{' '}
                      <span className="font-mono tabular-nums">
                        {section.count}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
        </div>
      ) : null}

      {showSearch ? (
        <p aria-live="polite" className="sr-only">
          {filteredTotal} candidate{filteredTotal === 1 ? '' : 's'} shown
        </p>
      ) : null}

      {filteredTotal === 0 ? (
        <p className="py-v-6 text-v-body text-v-ink-2">
          No candidates match “{normalizedQuery}”
        </p>
      ) : (
        <>
          {filtered.groups.map((group, groupIndex) => (
            <section
              aria-labelledby={group.headingId}
              className="viewer-result-group"
              id={groupIndex === 0 ? 'viewer-scored' : undefined}
              key={group.id}
            >
              {!normalizedQuery &&
              groups.length === 1 &&
              singleGroupStatement ? (
                <header className="viewer-group-header">
                  <h2 className="sr-only" id={group.headingId}>
                    {group.label} scored candidates, {group.range}
                  </h2>
                  <p className="text-v-meta text-v-ink-2">
                    {singleGroupStatement}
                  </p>
                </header>
              ) : (
                <GroupHeader
                  count={group.count}
                  headingId={group.headingId}
                  label={group.label}
                  range={group.range}
                  tone={group.id}
                />
              )}
              <ul className="viewer-divided-list">
                {group.candidates.map((candidate) => {
                  const expanded = expandedCandidateIds.has(candidate.id);
                  return (
                    <li key={candidate.id}>
                      <button
                        id={candidate.buttonId}
                        aria-controls={candidate.panelId}
                        aria-expanded={expanded}
                        className="viewer-candidate-row viewer-focus viewer-interactive"
                        onClick={() => toggleCandidate(candidate.id)}
                        type="button"
                      >
                        <span className="viewer-candidate-identity">
                          <span className="viewer-candidate-rank font-mono text-v-meta tabular-nums text-v-ink-3">
                            {candidate.rank}
                          </span>
                          <span className="min-w-0">
                            <span
                              className="block truncate text-v-row font-[number:var(--v-weight-row)] text-v-ink"
                              title={candidate.name}
                            >
                              {candidate.name}
                            </span>
                            {candidate.roleCompany ? (
                              <span className="viewer-candidate-meta mt-v-1 block text-v-meta text-v-ink-3">
                                {candidate.roleCompany}
                              </span>
                            ) : null}
                          </span>
                        </span>
                        <span
                          className="viewer-score-text font-mono text-v-row font-semibold tabular-nums"
                          data-score-tier={candidate.scoreTier}
                        >
                          {candidate.score}
                        </span>
                        <span className="text-v-ink-3">
                          <span
                            aria-hidden="true"
                            className="viewer-chevron inline-block"
                          >
                            ›
                          </span>
                          <span className="sr-only">
                            {expanded ? 'Collapse' : 'Expand'} {candidate.name}
                          </span>
                        </span>
                      </button>
                      {expanded ? (
                        <CandidatePanel candidate={candidate} />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {filtered.triaged.length > 0 ? (
            <section
              aria-labelledby="viewer-triaged-heading"
              className="viewer-result-group"
              id="viewer-triaged"
            >
              <GroupHeader
                count={filtered.triaged.length}
                headingId="viewer-triaged-heading"
                label="Triaged out"
                range="not fully scored"
                tone="neutral"
              />
              <ul className="viewer-divided-list">
                {filtered.triaged.map((candidate) => (
                  <li className="viewer-static-row" key={candidate.id}>
                    <div className="min-w-0">
                      <p className="text-v-row font-[number:var(--v-weight-row)] text-v-ink">
                        {candidate.name}
                      </p>
                      {candidate.roleCompany ? (
                        <p className="mt-v-1 text-v-meta text-v-ink-3">
                          {candidate.roleCompany}
                        </p>
                      ) : null}
                    </div>
                    {candidate.audited ? (
                      <span className="viewer-neutral-chip">Audited</span>
                    ) : null}
                    {candidate.rationale ? (
                      <p className="viewer-static-row-detail viewer-measure text-v-body text-v-ink-2">
                        {candidate.rationale}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {filtered.failures.length > 0 ? (
            <section
              aria-labelledby="viewer-failures-heading"
              className="viewer-result-group"
              id="viewer-failed"
            >
              <GroupHeader
                count={filtered.failures.length}
                headingId="viewer-failures-heading"
                label="Failed"
                range={null}
                tone="danger"
              />
              <ul className="viewer-divided-list">
                {filtered.failures.map((failure) => (
                  <li className="px-v-2 py-v-3" key={failure.id}>
                    <p className="text-v-row font-[number:var(--v-weight-row)] text-v-ink">
                      {failure.name}
                    </p>
                    <p className="mt-v-1 text-v-meta text-v-danger-ink">
                      {failure.message}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
