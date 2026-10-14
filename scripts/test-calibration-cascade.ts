import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resolveEndorsementFloor,
  selectExemplarCascade,
} from '../src/lib/calibration-exemplars';
import type { GHApplication, GHCandidate, GHJobStage } from '../src/lib/greenhouse';

// The five ladder shapes measured against the Greenhouse Harvest API on
// 2026-07-31, reproduced with their real structure — names, spellings,
// priorities — and synthetic ids, because the cascade's correctness claim is
// that it works across ladders that share no naming convention.
const LADDERS: Record<string, GHJobStage[]> = {
  'baseline ladder': [
    { id: 100, name: 'Application Review', priority: 0 },
    { id: 101, name: 'Recruiter Phone Screen', priority: 1 },
    { id: 102, name: 'Hiring Manager Review', priority: 2 },
    { id: 103, name: 'Manager / Tech Screen', priority: 3 },
    { id: 104, name: 'Onsite Interviews', priority: 4 },
    { id: 105, name: 'Verbal Offer', priority: 5 },
    { id: 106, name: 'Offer', priority: 6 },
    { id: 107, name: 'Offer Signed', priority: 7 },
  ],
  'assessment ladder': [
    { id: 200, name: 'Application Review', priority: 0 },
    { id: 201, name: 'Reached out', priority: 1 },
    { id: 202, name: 'Recruiter Phone Screen', priority: 2 },
    { id: 203, name: 'Hiring Manager Review', priority: 3 },
    { id: 204, name: 'Skills Assessment', priority: 4 },
    { id: 205, name: 'Manager / Tech Screen', priority: 5 },
    { id: 206, name: 'Onsite Interviews', priority: 6 },
    { id: 207, name: 'Verbal Offer', priority: 7 },
    { id: 208, name: 'Offer Extend', priority: 8 },
    { id: 209, name: 'Offer Signed', priority: 9 },
  ],
  'ai-interview ladder': [
    { id: 300, name: 'Application Review', priority: 0 },
    { id: 301, name: 'Recruiter Phone Screen', priority: 1 },
    { id: 302, name: 'AI Interview', priority: 2 },
    { id: 303, name: 'Hiring Manager Review', priority: 3 },
    { id: 304, name: 'Manager / Tech Screen', priority: 4 },
    { id: 305, name: 'Onsite Interviews', priority: 5 },
    { id: 306, name: 'Offer Extend', priority: 6 },
    { id: 307, name: 'Offer Signed', priority: 7 },
  ],
  'shortened ladder': [
    { id: 400, name: 'Application Review', priority: 0 },
    { id: 401, name: 'Preliminary Phone Screen', priority: 1 },
    { id: 402, name: 'Hiring Manager Review', priority: 2 },
    { id: 403, name: 'Phone Interview', priority: 3 },
    { id: 404, name: 'Face to Face', priority: 4 },
    { id: 405, name: 'Reference Check', priority: 5 },
    { id: 406, name: 'Offer', priority: 6 },
  ],
  'sourced ladder': [
    { id: 500, name: 'Application Review', priority: 0 },
    { id: 501, name: 'Sourced', priority: 1 },
    { id: 502, name: 'Recruiter Phone Screen', priority: 2 },
    { id: 503, name: 'Hiring Manager Review', priority: 3 },
    { id: 504, name: 'Manager / Tech Screen', priority: 4 },
    { id: 505, name: 'Onsite Interviews', priority: 5 },
    { id: 506, name: 'Offer', priority: 6 },
    { id: 507, name: 'Offer Signed', priority: 7 },
  ],
};

const JOB_ID = 424242;

function application(input: {
  id: number;
  status?: string;
  stage?: { id: number; name: string } | null;
  prospect?: boolean;
  appliedAt?: string;
  rejectedAt?: string | null;
  lastActivityAt?: string;
  applicationJobId?: number;
}): GHApplication {
  return {
    id: input.id,
    candidate_id: input.id,
    prospect: input.prospect || false,
    applied_at: input.appliedAt || '2026-01-01T00:00:00.000Z',
    rejected_at: input.rejectedAt ?? null,
    last_activity_at: input.lastActivityAt ?? '',
    location: null,
    source: null,
    credited_to: null,
    rejection_reason: null,
    rejection_details: null,
    jobs: [{ id: input.applicationJobId ?? JOB_ID, name: 'Fixture role' }],
    job_post_id: null,
    status: input.status || 'active',
    current_stage: input.stage === undefined ? null : input.stage,
    answers: [],
  };
}

function candidate(id: number, applications: GHApplication[]): GHCandidate {
  return {
    id,
    first_name: 'Candidate',
    last_name: String(id),
    company: null,
    title: null,
    is_private: false,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    last_activity: '2026-01-01T00:00:00.000Z',
    photo_url: null,
    application_ids: applications.map((item) => item.id),
    phone_numbers: [],
    addresses: [],
    email_addresses: [],
    website_addresses: [],
    social_media_addresses: [],
    tags: [],
    applications,
    attachments: [],
  };
}

function stageOf(ladder: string, name: string): GHJobStage {
  const stage = LADDERS[ladder].find((item) => item.name === name);
  if (!stage) throw new Error(`No stage "${name}" on ${ladder}`);
  return stage;
}

function floorOf(ladder: string): number {
  const floor = resolveEndorsementFloor(LADDERS[ladder], 'Hiring Manager Review');
  assert.ok(floor, `${ladder} must resolve a floor`);
  return floor.floorPriority;
}

describe('resolveEndorsementFloor', () => {
  it('lands on the rung above Hiring Manager Review on every measured ladder', () => {
    // No two of these share a name, which is the point: a configured stage name
    // cannot express this floor, and a shared priority number cannot either.
    const resolved = Object.fromEntries(
      Object.entries(LADDERS).map(([label, stages]) => [
        label,
        resolveEndorsementFloor(stages, 'Hiring Manager Review')?.floorStage?.name,
      ])
    );

    assert.deepEqual(resolved, {
      'baseline ladder': 'Manager / Tech Screen',
      'assessment ladder': 'Skills Assessment',
      'ai-interview ladder': 'Manager / Tech Screen',
      'shortened ladder': 'Phone Interview',
      'sourced ladder': 'Manager / Tech Screen',
    });
  });

  it('puts the floor strictly above the endorsement stage, never at it', () => {
    for (const [label, stages] of Object.entries(LADDERS)) {
      const floor = resolveEndorsementFloor(stages, 'Hiring Manager Review');
      assert.ok(floor, label);
      assert.equal(floor.floorPriority, floor.endorsementStage.priority + 1, label);
      // Hiring Manager Review is an early resume read on every requisition
      // measured, so a candidate sitting in it has not yet been endorsed.
      assert.ok(floor.endorsementStage.priority < floor.floorPriority, label);
    }
  });

  it('returns null when the endorsement stage is absent so the caller can fail loudly', () => {
    assert.equal(
      resolveEndorsementFloor(
        [{ id: 1, name: 'Application Review', priority: 0 }],
        'Hiring Manager Review'
      ),
      null
    );
  });

  it('reports no floor stage when nothing sits above the endorsement stage', () => {
    const floor = resolveEndorsementFloor(
      [
        { id: 1, name: 'Application Review', priority: 0 },
        { id: 2, name: 'Hiring Manager Review', priority: 1 },
      ],
      'Hiring Manager Review'
    );
    assert.ok(floor);
    assert.equal(floor.floorStage, null);
    assert.equal(floor.floorPriority, 2);
  });
});

describe('selectExemplarCascade', () => {
  it('ranks hired candidates first even though they carry no stage at all', () => {
    // The 28 hires measured on one requisition all had current_stage: null.
    // Any selection that ranks by stage priority misses them entirely.
    const onsite = stageOf('ai-interview ladder', 'Onsite Interviews');
    const offerSigned = stageOf('ai-interview ladder', 'Offer Signed');

    const { selected, rungs } = selectExemplarCascade({
      candidates: [
        candidate(1, [application({ id: 1, stage: onsite })]),
        candidate(2, [application({ id: 2, status: 'hired', stage: null })]),
        candidate(3, [application({ id: 3, status: 'rejected', stage: offerSigned })]),
      ],
      jobId: JOB_ID,
      stages: LADDERS['ai-interview ladder'],
      floorPriority: floorOf('ai-interview ladder'),
    });

    assert.deepEqual(
      selected.map((item) => item.candidate.id),
      [2, 3, 1]
    );
    assert.equal(selected[0].stageName, 'Hired');
    assert.deepEqual(rungs[0], { stage: 'Hired', priority: null, matched: 1, taken: 1 });
  });

  it('counts a candidate rejected at a stage as an exemplar for that stage', () => {
    // One requisition's 19 offer-signed and 15 offer-extend candidates were all
    // rejected, as were both offer-signed on a second one. Excluding them would
    // discard the strongest exemplars on those requisitions. Rosie's target is
    // the screening decision, not the hire decision.
    const offerSigned = stageOf('assessment ladder', 'Offer Signed');
    const { selected } = selectExemplarCascade({
      candidates: [
        candidate(1, [
          application({ id: 1, status: 'rejected', stage: offerSigned, rejectedAt: '2026-05-01T00:00:00.000Z' }),
        ]),
      ],
      jobId: JOB_ID,
      stages: LADDERS['assessment ladder'],
      floorPriority: floorOf('assessment ladder'),
    });

    assert.equal(selected.length, 1);
    assert.equal(selected[0].status, 'rejected');
    assert.equal(selected[0].stageName, 'Offer Signed');
  });

  it('walks the ladder strictly top-down across every offer spelling', () => {
    // The assessment ladder spells the offer rung several ways across distinct
    // priorities. The walk never inspects a name.
    const stages = LADDERS['assessment ladder'];
    const named = (name: string) => stageOf('assessment ladder', name);
    const { selected } = selectExemplarCascade({
      candidates: [
        candidate(1, [application({ id: 1, stage: named('Onsite Interviews') })]),
        candidate(2, [application({ id: 2, stage: named('Verbal Offer') })]),
        candidate(3, [application({ id: 3, stage: named('Offer Signed') })]),
        candidate(4, [application({ id: 4, stage: named('Skills Assessment') })]),
        candidate(5, [application({ id: 5, stage: named('Offer Extend') })]),
      ],
      jobId: JOB_ID,
      stages,
      floorPriority: floorOf('assessment ladder'),
    });

    assert.deepEqual(
      selected.map((item) => item.stageName),
      ['Offer Signed', 'Offer Extend', 'Verbal Offer', 'Onsite Interviews', 'Skills Assessment']
    );
  });

  it('orders by last_activity_at within a rung, not by application date', () => {
    // A hire who applied in March and was hired in April must not sort behind
    // someone who applied in May.
    const { selected } = selectExemplarCascade({
      candidates: [
        candidate(1, [
          application({
            id: 1,
            status: 'hired',
            stage: null,
            appliedAt: '2025-03-31T00:00:00.000Z',
            lastActivityAt: '2026-07-30T00:00:00.000Z',
          }),
        ]),
        candidate(2, [
          application({
            id: 2,
            status: 'hired',
            stage: null,
            appliedAt: '2025-05-09T00:00:00.000Z',
            lastActivityAt: '2025-05-31T00:00:00.000Z',
          }),
        ]),
      ],
      jobId: JOB_ID,
      stages: LADDERS['ai-interview ladder'],
      floorPriority: floorOf('ai-interview ladder'),
    });

    assert.deepEqual(
      selected.map((item) => item.candidate.id),
      [1, 2]
    );
    assert.equal(selected[0].activityAt, '2026-07-30T00:00:00.000Z');
  });

  it('falls back to rejected_at then applied_at when last_activity_at is absent', () => {
    const onsite = stageOf('ai-interview ladder', 'Onsite Interviews');
    const { selected } = selectExemplarCascade({
      candidates: [
        candidate(1, [
          application({ id: 1, stage: onsite, appliedAt: '2026-02-01T00:00:00.000Z' }),
        ]),
        candidate(2, [
          application({
            id: 2,
            status: 'rejected',
            stage: onsite,
            rejectedAt: '2026-06-01T00:00:00.000Z',
          }),
        ]),
      ],
      jobId: JOB_ID,
      stages: LADDERS['ai-interview ladder'],
      floorPriority: floorOf('ai-interview ladder'),
    });

    assert.deepEqual(
      selected.map((item) => item.candidate.id),
      [2, 1]
    );
  });

  it('stops at five and still reports what the lower rungs held', () => {
    const onsite = stageOf('ai-interview ladder', 'Onsite Interviews');
    const managerScreen = stageOf('ai-interview ladder', 'Manager / Tech Screen');
    const candidates = [
      ...Array.from({ length: 6 }, (_, index) =>
        candidate(index + 1, [
          application({
            id: index + 1,
            stage: onsite,
            lastActivityAt: `2026-0${index + 1}-01T00:00:00.000Z`,
          }),
        ])
      ),
      candidate(99, [application({ id: 99, stage: managerScreen })]),
    ];

    const { selected, rungs } = selectExemplarCascade({
      candidates,
      jobId: JOB_ID,
      stages: LADDERS['ai-interview ladder'],
      floorPriority: floorOf('ai-interview ladder'),
    });

    assert.equal(selected.length, 5);
    // Newest five of the six onsite candidates, most recent first.
    assert.deepEqual(
      selected.map((item) => item.candidate.id),
      [6, 5, 4, 3, 2]
    );
    const managerRung = rungs.find((rung) => rung.stage === 'Manager / Tech Screen');
    assert.deepEqual(managerRung, {
      stage: 'Manager / Tech Screen',
      priority: 4,
      matched: 1,
      taken: 0,
    });
  });

  it('reports every rung at or above the floor and nothing below it', () => {
    const { rungs } = selectExemplarCascade({
      candidates: [],
      jobId: JOB_ID,
      stages: LADDERS['shortened ladder'],
      floorPriority: floorOf('shortened ladder'),
    });

    assert.deepEqual(
      rungs.map((rung) => rung.stage),
      ['Hired', 'Offer', 'Reference Check', 'Face to Face', 'Phone Interview']
    );
    // Hiring Manager Review sits below the floor and must never be offered as
    // a rung: nobody in it has been endorsed by the hiring manager.
    assert.ok(!rungs.some((rung) => rung.stage === 'Hiring Manager Review'));
  });

  it('returns nothing for the shortened ladder, whose eight candidates all sit below the floor', () => {
    // Measured on 2026-07-31: 615 non-prospect applications, 8 at Hiring
    // Manager Review, nothing above it. The cascade must hand this to the
    // operator rather than calibrate on resumes no hiring manager has endorsed.
    const hmReview = stageOf('shortened ladder', 'Hiring Manager Review');
    const { selected, rungs } = selectExemplarCascade({
      candidates: Array.from({ length: 8 }, (_, index) =>
        candidate(index + 1, [application({ id: index + 1, stage: hmReview })])
      ),
      jobId: JOB_ID,
      stages: LADDERS['shortened ladder'],
      floorPriority: floorOf('shortened ladder'),
    });

    assert.equal(selected.length, 0);
    assert.equal(
      rungs.reduce((total, rung) => total + rung.matched, 0),
      0
    );
  });

  it('descends to Manager / Tech Screen to fill five on the baseline ladder', () => {
    // Measured on 2026-07-31: 2 at Onsite, 15 at Manager / Tech Screen.
    const onsite = stageOf('baseline ladder', 'Onsite Interviews');
    const managerScreen = stageOf('baseline ladder', 'Manager / Tech Screen');
    const { selected, rungs } = selectExemplarCascade({
      candidates: [
        candidate(1, [application({ id: 1, stage: onsite, lastActivityAt: '2026-07-10T00:00:00.000Z' })]),
        candidate(2, [
          application({
            id: 2,
            status: 'rejected',
            stage: onsite,
            lastActivityAt: '2026-07-11T00:00:00.000Z',
          }),
        ]),
        ...Array.from({ length: 15 }, (_, index) =>
          candidate(100 + index, [
            application({
              id: 100 + index,
              stage: managerScreen,
              lastActivityAt: `2026-06-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
            }),
          ])
        ),
      ],
      jobId: JOB_ID,
      stages: LADDERS['baseline ladder'],
      floorPriority: floorOf('baseline ladder'),
    });

    assert.equal(selected.length, 5);
    assert.deepEqual(
      selected.map((item) => item.stageName),
      [
        'Onsite Interviews',
        'Onsite Interviews',
        'Manager / Tech Screen',
        'Manager / Tech Screen',
        'Manager / Tech Screen',
      ]
    );
    assert.deepEqual(
      rungs.filter((rung) => rung.matched > 0),
      [
        { stage: 'Onsite Interviews', priority: 4, matched: 2, taken: 2 },
        { stage: 'Manager / Tech Screen', priority: 3, matched: 15, taken: 3 },
      ]
    );
  });

  it('keeps a renamed stage in its rung by resolving on id', () => {
    // Greenhouse renames are applied to the ladder but the application still
    // carries the old string. Bucketing on the application's name would let
    // this candidate pass the floor test and then match no rung, dropping them
    // silently.
    const { selected, rungs } = selectExemplarCascade({
      candidates: [
        candidate(1, [
          application({
            id: 1,
            stage: { id: stageOf('ai-interview ladder', 'Onsite Interviews').id, name: 'Onsites (old name)' },
          }),
        ]),
      ],
      jobId: JOB_ID,
      stages: LADDERS['ai-interview ladder'],
      floorPriority: floorOf('ai-interview ladder'),
    });

    assert.equal(selected.length, 1);
    assert.equal(selected[0].stageName, 'Onsite Interviews');
    assert.deepEqual(
      rungs.find((rung) => rung.stage === 'Onsite Interviews'),
      { stage: 'Onsite Interviews', priority: 5, matched: 1, taken: 1 }
    );
  });

  it('excludes prospects, other requisitions, and stages off this ladder', () => {
    const onsite = stageOf('ai-interview ladder', 'Onsite Interviews');
    const { selected } = selectExemplarCascade({
      candidates: [
        candidate(1, [application({ id: 1, stage: onsite, prospect: true })]),
        candidate(2, [application({ id: 2, stage: onsite, applicationJobId: 999 })]),
        candidate(3, [application({ id: 3, stage: { id: 42, name: 'Mystery Stage' } })]),
        candidate(4, [application({ id: 4, stage: onsite })]),
      ],
      jobId: JOB_ID,
      stages: LADDERS['ai-interview ladder'],
      floorPriority: floorOf('ai-interview ladder'),
    });

    assert.deepEqual(
      selected.map((item) => item.candidate.id),
      [4]
    );
  });

  it('keeps a hired candidate whose application is a prospect out of the cascade', () => {
    const { selected } = selectExemplarCascade({
      candidates: [
        candidate(1, [application({ id: 1, status: 'hired', stage: null, prospect: true })]),
      ],
      jobId: JOB_ID,
      stages: LADDERS['ai-interview ladder'],
      floorPriority: floorOf('ai-interview ladder'),
    });

    assert.equal(selected.length, 0);
  });
});
