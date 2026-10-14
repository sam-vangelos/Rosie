import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveThresholdStage } from '../src/lib/calibration-exemplars';
import type { GHJobStage } from '../src/lib/greenhouse';

const stages: GHJobStage[] = [
  { id: 100, name: 'Application Review', priority: 0 },
  { id: 101, name: 'Recruiter Phone Screen', priority: 1 },
  { id: 102, name: 'AI Interview', priority: 2 },
  { id: 103, name: 'Hiring Manager Review', priority: 3 },
  { id: 104, name: 'Manager / Tech Screen', priority: 4 },
  { id: 105, name: 'Onsite Interviews', priority: 5 },
  { id: 106, name: 'Offer Extend', priority: 6 },
  { id: 107, name: 'Offer Signed', priority: 7 },
];

describe('resolveThresholdStage', () => {
  it('prefers an exact normalized match', () => {
    assert.deepEqual(
      resolveThresholdStage(stages, '  onsite interviews  '),
      stages[5]
    );
  });

  it('matches the configured "Onsite" threshold to the real stage name', () => {
    assert.deepEqual(resolveThresholdStage(stages, 'onsite'), stages[5]);
  });

  it('returns null when no stage matches', () => {
    assert.equal(resolveThresholdStage(stages, 'Executive Review'), null);
  });
});
