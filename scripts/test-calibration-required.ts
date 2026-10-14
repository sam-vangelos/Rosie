import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NextRequest } from 'next/server';

/**
 * An uncalibrated run is not a weaker ranking — it is a meaningless one.
 * Measured on a real 75-candidate requisition: against a JD-only rubric,
 * candidates who reached Onsite/Verbal Offer/Hired scored 2.86 while the
 * general pool scored 2.75, nobody cleared 6.0, and the top-ranked candidate
 * was not the person the calibrated rubric ranked first. The API must refuse.
 */
describe('runs API requires calibration', () => {
  async function post(body: unknown) {
    const { POST } = await import('../src/app/api/runs/route');
    // The route reads request.nextUrl before validating, so it needs a real
    // NextRequest rather than a bare Request.
    const req = new NextRequest('http://localhost/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return POST(req);
  }

  const rubric = {
    criteria: [
      {
        id: 'a',
        name: 'A',
        description: 'd',
        weight: 100,
        scoringGuide: { high: 'h', mid: 'm', low: 'l' },
      },
    ],
    tableStakes: [],
  };

  it('refuses a run with no calibrationVersion', async () => {
    const res = await post({ jobId: 1, rubric, idealPatterns: null });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { code?: string };
    assert.equal(body.code, 'CALIBRATION_REQUIRED');
  });

  it('refuses an explicitly null calibrationVersion', async () => {
    const res = await post({
      jobId: 1,
      rubric,
      idealPatterns: null,
      calibrationVersion: null,
    });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { code?: string }).code, 'CALIBRATION_REQUIRED');
  });

  it('refuses an empty-string calibrationVersion', async () => {
    const res = await post({
      jobId: 1,
      rubric,
      idealPatterns: null,
      calibrationVersion: '',
    });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { code?: string }).code, 'CALIBRATION_REQUIRED');
  });

  it('still validates jobId and rubric before calibration', async () => {
    assert.equal((await post({ rubric, calibrationVersion: 'v1' })).status, 400);
    assert.equal((await post({ jobId: 1, calibrationVersion: 'v1' })).status, 400);
  });
});

describe('runs API accepts an intake-notes grounded rubric', () => {
  const rubric = {
    criteria: [
      { id: 'a', name: 'A', description: 'd', weight: 100,
        scoringGuide: { high: 'h', mid: 'm', low: 'l' } },
    ],
    tableStakes: [],
  };

  it('passes the grounding check when groundedByIntakeNotes is set', async () => {
    const { POST } = await import('../src/app/api/runs/route');
    const { NextRequest } = await import('next/server');
    const res = await POST(
      new NextRequest('http://localhost/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jobId: 1, rubric, idealPatterns: null, groundedByIntakeNotes: true,
        }),
      })
    );
    // Past the grounding gate; it fails later on DB access, which is fine here.
    const body = (await res.json()) as { code?: string };
    assert.notEqual(
      body.code,
      'CALIBRATION_REQUIRED',
      'a rubric grounded in stated hiring-team criteria must not be refused'
    );
  });
});
