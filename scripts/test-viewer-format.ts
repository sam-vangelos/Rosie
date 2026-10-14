import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import type { ScreeningRunStatus, Tier } from '../src/lib/types';
import {
  displayNameFromEmail,
  formatRelativeDate,
  formatRunListEmptyState,
  formatRunVerdict,
  groupCandidatesByScore,
  humanizeProvider,
  humanizeStatus,
  pluralize,
  REVIEW_THRESHOLD,
  SCORE_GROUP_DEFINITIONS,
  tierFromScore,
} from '../src/lib/viewer-format';

describe('viewer score formatting', () => {
  it('assigns every score boundary to the specified tier', () => {
    const cases: Array<[number, Tier]> = [
      [10, 'top'],
      [9, 'top'],
      [8.99, 'strong'],
      [8, 'strong'],
      [7.99, 'moderate'],
      [7, 'moderate'],
      [6.99, 'below'],
      [0, 'below'],
    ];

    for (const [score, expected] of cases) {
      assert.equal(tierFromScore(score), expected, `score ${score}`);
    }
  });

  it('uses the fixed group order and omits empty groups', () => {
    assert.deepEqual(SCORE_GROUP_DEFINITIONS, [
      { id: 'top', label: 'Top', range: '9.0–10', min: 9 },
      { id: 'strong', label: 'Strong', range: '8.0–8.9', min: 8 },
      { id: 'moderate', label: 'Moderate', range: '7.0–7.9', min: 7 },
      { id: 'below', label: 'Below', range: 'under 7.0', min: 0 },
    ]);

    const groups = groupCandidatesByScore([
      { id: 'top-a', overallScore: 9.8 },
      { id: 'top-b', overallScore: 9.1 },
      { id: 'strong', overallScore: 8.2 },
      { id: 'below-a', overallScore: 6.8 },
      { id: 'below-b', overallScore: 4.2 },
    ]);

    assert.deepEqual(
      groups.map((group) => group.id),
      ['top', 'strong', 'below']
    );
  });

  it('assigns rank globally rather than restarting within each group', () => {
    const groups = groupCandidatesByScore([
      { id: 'top-a', overallScore: 9.8 },
      { id: 'top-b', overallScore: 9.1 },
      { id: 'strong', overallScore: 8.2 },
      { id: 'below-a', overallScore: 6.8 },
      { id: 'below-b', overallScore: 4.2 },
    ]);

    assert.deepEqual(
      groups.map((group) => ({
        id: group.id,
        candidates: group.candidates.map(({ candidate, rank }) => ({
          id: candidate.id,
          rank,
        })),
      })),
      [
        {
          id: 'top',
          candidates: [
            { id: 'top-a', rank: 1 },
            { id: 'top-b', rank: 2 },
          ],
        },
        {
          id: 'strong',
          candidates: [{ id: 'strong', rank: 3 }],
        },
        {
          id: 'below',
          candidates: [
            { id: 'below-a', rank: 4 },
            { id: 'below-b', rank: 5 },
          ],
        },
      ]
    );
  });

  it('preserves fallback behavior for non-finite and below-floor scores', () => {
    const cases: Array<[number, Tier]> = [
      [-1, 'below'],
      [-Infinity, 'below'],
      [NaN, 'below'],
      [Infinity, 'top'],
      [0, 'below'],
    ];

    for (const [score, expected] of cases) {
      assert.equal(tierFromScore(score), expected, `score ${score}`);
    }
  });

  it('derives the review threshold from the moderate tier', () => {
    assert.equal(REVIEW_THRESHOLD, 7);
    assert.equal(
      REVIEW_THRESHOLD,
      SCORE_GROUP_DEFINITIONS.find((group) => group.id === 'moderate')?.min
    );
  });
});

describe('viewer labels', () => {
  it('humanizes known providers and preserves an unknown provider', () => {
    assert.equal(humanizeProvider('api'), 'Claude API');
    assert.equal(humanizeProvider('claude-agent'), 'Claude agent');
    assert.equal(humanizeProvider('codex-agent'), 'Codex agent');
    assert.equal(humanizeProvider('future-provider'), 'future-provider');
  });

  it('humanizes every screening status', () => {
    const cases: Array<[ScreeningRunStatus, string]> = [
      ['queued', 'Queued'],
      ['fetching', 'Fetching'],
      ['processing', 'Processing'],
      ['triaging', 'Triaging'],
      ['full_scoring', 'Full scoring'],
      ['auditing', 'Auditing'],
      ['completed', 'Completed'],
      ['canceled', 'Canceled'],
      ['failed', 'Failed'],
    ];

    for (const [status, expected] of cases) {
      assert.equal(humanizeStatus(status), expected);
    }
  });

  it('derives display names only from first.last email local parts', () => {
    assert.equal(displayNameFromEmail('margot.ellis@example.com'), 'Margot Ellis');
    assert.equal(displayNameFromEmail('JORDAN.RIVERA@example.com'), 'Jordan Rivera');
    assert.equal(
      displayNameFromEmail('service-account@example.com'),
      'service-account@example.com'
    );
    assert.equal(
      displayNameFromEmail('first.middle.last@example.com'),
      'first.middle.last@example.com'
    );
  });

  it('pluralizes singular and plural nouns', () => {
    assert.equal(pluralize(1, 'candidate'), 'candidate');
    assert.equal(pluralize(2, 'candidate'), 'candidates');
    assert.equal(pluralize(0, 'person', 'people'), 'people');
  });
});

describe('run-list empty states', () => {
  it('distinguishes no recruiter scope from scoped jobs with no runs', () => {
    assert.deepEqual(formatRunListEmptyState(0), {
      heading: 'No assigned requisitions',
      description:
        'Rosie shows runs only for jobs where Greenhouse lists you as a recruiter. Ask the recruiting lead to add you to the job’s hiring team.',
    });
    assert.deepEqual(formatRunListEmptyState(2), {
      heading: 'No screening runs yet',
      description:
        'Rosie has not screened candidates for your requisitions yet. Ask a Rosie operator to start a run.',
    });
  });

  it('gives an operator an operator-specific next action', () => {
    assert.deepEqual(formatRunListEmptyState(null), {
      heading: 'No screening runs yet',
      description:
        'Start a screening run in the Rosie cockpit and its results will appear here.',
    });
  });

  it('uses the empty-state formatter on the runs page', async () => {
    const source = await readFile(
      new URL('../src/app/runs/page.tsx', import.meta.url),
      'utf8'
    );
    assert.match(source, /formatRunListEmptyState\(/);
  });
});

describe('run verdict formatting', () => {
  const baseCounts = {
    total: 16,
    processed: 16,
    fullyScored: 16,
    failed: 0,
    triagedLikelyNo: 0,
  };

  it('uses status-first precedence for unfinished and terminal error states', () => {
    assert.deepEqual(
      formatRunVerdict({
        status: 'processing',
        counts: { ...baseCounts, processed: 3 },
        distribution: {
          top: 1,
          strong: 0,
          moderate: 0,
          below: 2,
          best: 9,
        },
      }),
      { kind: 'status', primary: 'Processing', secondary: '3 of 16' }
    );
    assert.deepEqual(
      formatRunVerdict({
        status: 'failed',
        counts: baseCounts,
        distribution: null,
      }),
      { kind: 'status', primary: 'Failed', secondary: null }
    );
    assert.deepEqual(
      formatRunVerdict({
        status: 'canceled',
        counts: baseCounts,
        distribution: null,
      }),
      { kind: 'status', primary: 'Canceled', secondary: null }
    );
  });

  it('formats completed score outcomes and preserves one decimal place', () => {
    assert.deepEqual(
      formatRunVerdict({
        status: 'completed',
        counts: baseCounts,
        distribution: {
          top: 0,
          strong: 0,
          moderate: 2,
          below: 14,
          best: 7,
        },
      }),
      {
        kind: 'text',
        primary: '2 at or above 7.0',
        secondary: 'of 16 screened',
        tone: 'review',
      }
    );
    assert.deepEqual(
      formatRunVerdict({
        status: 'completed',
        counts: baseCounts,
        distribution: {
          top: 0,
          strong: 0,
          moderate: 0,
          below: 16,
          best: 6.8,
        },
      }),
      {
        kind: 'text',
        primary: 'best 6.8',
        secondary: 'of 16 screened',
        tone: 'default',
      }
    );
  });

  it('keeps completed non-score outcomes distinct', () => {
    assert.deepEqual(
      formatRunVerdict({
        status: 'completed',
        counts: {
          total: 3,
          processed: 3,
          fullyScored: 0,
          failed: 3,
          triagedLikelyNo: 0,
        },
        distribution: null,
      }),
      {
        kind: 'text',
        primary: 'All 3 candidates failed to process',
        secondary: null,
        tone: 'danger',
      }
    );
    assert.deepEqual(
      formatRunVerdict({
        status: 'completed',
        counts: {
          total: 16,
          processed: 16,
          fullyScored: 0,
          failed: 0,
          triagedLikelyNo: 16,
        },
        distribution: null,
      }),
      {
        kind: 'text',
        primary: '16 screened, none advanced to scoring',
        secondary: null,
        tone: 'default',
      }
    );
    assert.deepEqual(
      formatRunVerdict({
        status: 'completed',
        counts: {
          total: 0,
          processed: 0,
          fullyScored: 0,
          failed: 0,
          triagedLikelyNo: 0,
        },
        distribution: null,
      }),
      {
        kind: 'text',
        primary: 'No candidates',
        secondary: null,
        tone: 'muted',
      }
    );
  });
});

describe('relative date formatting', () => {
  const now = '2026-07-27T12:00:00.000Z';

  it('formats a current instant without consulting the ambient clock', () => {
    assert.equal(formatRelativeDate(now, now), 'now');
  });

  it('formats fixed hours, days, and weeks in the past', () => {
    assert.equal(
      formatRelativeDate('2026-07-27T10:00:00.000Z', now),
      '2 hours ago'
    );
    assert.equal(
      formatRelativeDate('2026-07-26T12:00:00.000Z', now),
      'yesterday'
    );
    assert.equal(
      formatRelativeDate('2026-07-13T12:00:00.000Z', now),
      '2 weeks ago'
    );
  });
});
