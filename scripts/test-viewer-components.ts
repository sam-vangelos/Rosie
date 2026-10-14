import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  RunCandidateList,
  type FailedCandidateView,
  type RunCandidateGroupView,
  type RunCandidateView,
  type TriagedCandidateView,
} from '../src/components/viewer/RunCandidateList';

const candidatesUrl = new URL(
  '../src/components/viewer/RunCandidateList.tsx',
  import.meta.url
);

function scoredCandidate(
  id: string,
  rank: number,
  name: string,
  roleCompany: string | null = null
): RunCandidateView {
  return {
    id,
    buttonId: `${id}-button`,
    panelId: `${id}-panel`,
    rank,
    name,
    roleCompany,
    score: '8.0',
    scoreTier: 'strong',
    greenhouseUrl: null,
    criteria: [],
    strengths: [],
    gaps: [],
  };
}

function scoredGroup(
  candidates: RunCandidateView[]
): RunCandidateGroupView {
  return {
    id: 'strong',
    headingId: 'viewer-test-strong-heading',
    label: 'Strong',
    range: '8.0–8.9',
    count: candidates.length,
    candidates,
  };
}

const triagedCandidate: TriagedCandidateView = {
  id: 'triaged-1',
  name: 'Triaged Candidate',
  roleCompany: 'Operations · Acme',
  rationale: 'No relevant product evidence.',
  audited: false,
};

const failedCandidate: FailedCandidateView = {
  id: 'failed-1',
  name: 'Failed Candidate',
  message: 'Unreadable résumé.',
};

function renderList({
  groups,
  triaged = [],
  failures = [],
}: {
  groups: RunCandidateGroupView[];
  triaged?: TriagedCandidateView[];
  failures?: FailedCandidateView[];
}): string {
  return renderToStaticMarkup(
    createElement(RunCandidateList, {
      groups,
      triaged,
      failures,
      singleGroupStatement: null,
    })
  );
}

describe('viewer result hierarchy', () => {
  it('renders failures after scored and triaged candidates', () => {
    const markup = renderList({
      groups: [
        scoredGroup([scoredCandidate('scored-1', 1, 'Scored Candidate')]),
      ],
      triaged: [triagedCandidate],
      failures: [failedCandidate],
    });

    const failedIndex = markup.indexOf('Failed Candidate');
    const scoredIndex = markup.indexOf('Scored Candidate');
    const triagedIndex = markup.indexOf('Triaged Candidate');

    assert.ok(failedIndex >= 0);
    assert.ok(scoredIndex < triagedIndex);
    assert.ok(triagedIndex < failedIndex);
  });

  it('shows search at twenty candidates and section links for multiple families', () => {
    const twentyCandidateMarkup = renderList({
      groups: [
        scoredGroup(
          Array.from({ length: 18 }, (_, index) =>
            scoredCandidate(
              `scored-${index + 1}`,
              index + 1,
              `Scored Candidate ${index + 1}`
            )
          )
        ),
      ],
      triaged: [triagedCandidate],
      failures: [failedCandidate],
    });
    const nineteenCandidateMarkup = renderList({
      groups: [
        scoredGroup(
          Array.from({ length: 17 }, (_, index) =>
            scoredCandidate(
              `small-${index + 1}`,
              index + 1,
              `Small Candidate ${index + 1}`
            )
          )
        ),
      ],
      triaged: [triagedCandidate],
      failures: [failedCandidate],
    });

    assert.match(twentyCandidateMarkup, /<input[^>]+type="search"/);
    assert.match(twentyCandidateMarkup, /href="#viewer-failed"/);
    assert.match(twentyCandidateMarkup, /href="#viewer-scored"/);
    assert.match(twentyCandidateMarkup, /href="#viewer-triaged"/);
    assert.ok(
      twentyCandidateMarkup.indexOf('href="#viewer-scored"') <
        twentyCandidateMarkup.indexOf('href="#viewer-triaged"')
    );
    assert.ok(
      twentyCandidateMarkup.indexOf('href="#viewer-triaged"') <
        twentyCandidateMarkup.indexOf('href="#viewer-failed"')
    );
    assert.doesNotMatch(nineteenCandidateMarkup, /<input[^>]+type="search"/);
    assert.match(nineteenCandidateMarkup, /aria-label="Result sections"/);

    const oneFamilyMarkup = renderList({
      groups: [
        scoredGroup(
          Array.from({ length: 20 }, (_, index) =>
            scoredCandidate(
              `only-${index + 1}`,
              index + 1,
              `Only Candidate ${index + 1}`
            )
          )
        ),
      ],
    });
    assert.match(oneFamilyMarkup, /<input[^>]+type="search"/);
    assert.doesNotMatch(oneFamilyMarkup, /aria-label="Result sections"/);
  });
});

describe('viewer candidate search', () => {
  it('matches every intended population and excludes rationale and error text', async () => {
    const component = await import(
      '../src/components/viewer/RunCandidateList'
    );
    assert.equal(typeof component.filterViewerResults, 'function');

    const groups = [
      scoredGroup([
        {
          ...scoredCandidate(
            'scored-platform',
            7,
            'Alex Smith',
            'Engineer · Platform Co'
          ),
          criteria: [
            {
              key: 'criterion-1',
              name: 'Execution',
              weight: null,
              score: '8.0',
              scoreTier: 'strong',
              evidence: 'secret scored evidence phrase',
            },
          ],
        },
        scoredCandidate('scored-other', 8, 'Jamie Jones', 'Designer · Beta'),
      ]),
      {
        ...scoredGroup([
          scoredCandidate('scored-top', 1, 'Taylor Kim', 'Director · Gamma'),
        ]),
        id: 'top',
        headingId: 'viewer-test-top-heading',
        label: 'Top',
      } satisfies RunCandidateGroupView,
    ];
    const triaged = [
      {
        ...triagedCandidate,
        roleCompany: 'Platform Operations · Acme',
        rationale: 'secret rationale phrase',
      },
    ];
    const failures = [
      {
        ...failedCandidate,
        name: 'Platform Parse',
        message: 'secret error phrase',
      },
    ];

    const platform = component.filterViewerResults(
      groups,
      triaged,
      failures,
      '  PLATFORM  '
    );
    assert.deepEqual(
      platform.groups[0]?.candidates.map(
        (candidate: RunCandidateView) => candidate.id
      ),
      ['scored-platform']
    );
    assert.equal(platform.groups[0]?.count, 1);
    assert.equal(platform.groups[0]?.candidates[0]?.rank, 7);
    assert.equal(platform.triaged.length, 1);
    assert.equal(platform.failures.length, 1);

    const scoredName = component.filterViewerResults(
      groups,
      triaged,
      failures,
      'ALEX'
    );
    assert.deepEqual(
      scoredName.groups.flatMap((group) =>
        group.candidates.map((candidate) => candidate.id)
      ),
      ['scored-platform']
    );

    const triagedName = component.filterViewerResults(
      groups,
      triaged,
      failures,
      'triaged candidate'
    );
    assert.deepEqual(triagedName.groups, []);
    assert.deepEqual(triagedName.triaged.map((candidate) => candidate.id), [
      'triaged-1',
    ]);

    const failedName = component.filterViewerResults(
      groups,
      triaged,
      failures,
      'parse'
    );
    assert.deepEqual(failedName.groups, []);
    assert.deepEqual(failedName.triaged, []);
    assert.deepEqual(failedName.failures.map((candidate) => candidate.id), [
      'failed-1',
    ]);

    const secret = component.filterViewerResults(
      groups,
      triaged,
      failures,
      'secret'
    );
    assert.deepEqual(secret.groups, []);
    assert.deepEqual(secret.triaged, []);
    assert.deepEqual(secret.failures, []);

    const score = component.filterViewerResults(
      groups,
      triaged,
      failures,
      '8.0'
    );
    assert.deepEqual(score, {
      groups: [],
      triaged: [],
      failures: [],
    });
  });

  it('preserves all results for a blank query and returns an honest no-match set', async () => {
    const component = await import(
      '../src/components/viewer/RunCandidateList'
    );
    assert.equal(typeof component.filterViewerResults, 'function');

    const groups = [
      scoredGroup([scoredCandidate('scored-1', 12, 'Scored Candidate')]),
    ];
    const all = component.filterViewerResults(
      groups,
      [triagedCandidate],
      [failedCandidate],
      '   '
    );
    assert.deepEqual(all, {
      groups,
      triaged: [triagedCandidate],
      failures: [failedCandidate],
    });

    const none = component.filterViewerResults(
      groups,
      [triagedCandidate],
      [failedCandidate],
      'not present'
    );
    assert.deepEqual(none, {
      groups: [],
      triaged: [],
      failures: [],
    });
  });

  it('wires filtered results into groups, navigation, and the visible search states', async () => {
    const source = await readFile(candidatesUrl, 'utf8');

    assert.match(
      source,
      /const filtered = filterViewerResults\(groups, triaged, failures, query\)/
    );
    assert.match(source, /count: filtered\.failures\.length/);
    assert.match(source, /count: scoredCount/);
    assert.match(source, /count: filtered\.triaged\.length/);
    assert.match(source, /\{filtered\.failures\.map\(/);
    assert.match(source, /\{filtered\.groups\.map\(/);
    assert.match(source, /\{filtered\.triaged\.map\(/);
    assert.match(source, /No candidates match “\{normalizedQuery\}”/);
    assert.match(
      source,
      /!normalizedQuery &&\s*groups\.length === 1 &&\s*singleGroupStatement/
    );
  });
});
