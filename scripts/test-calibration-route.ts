import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import {
  after,
  afterEach,
  before,
  describe,
  it,
} from 'node:test';
import type { ScoringRubric } from '../src/lib/types';

const originalFetch = globalThis.fetch;
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalExecutableProviders = process.env.ROSIE_EXECUTABLE_PROVIDERS;
const originalThreshold = process.env.ROSIE_CALIBRATION_MIN_STAGE;

const rubric: ScoringRubric = {
  criteria: [
    {
      id: 'systems',
      name: 'Systems',
      description: 'Builds reliable systems',
      weight: 100,
      scoringGuide: { high: 'Excellent', mid: 'Adequate', low: 'Limited' },
    },
  ],
  tableStakes: ['TypeScript'],
  calibrationSummary: 'Fixture calibration',
};
const patterns = {
  commonSkills: [],
  careerPatterns: [],
  achievementSignals: [],
};

let calibratePost: typeof import('../src/app/api/calibrate/route').POST;
let rubricPost: typeof import('../src/app/api/rubric/generate/route').POST;

before(async () => {
  process.env.DATABASE_URL =
    'postgresql://fixture:fixture@127.0.0.1:1/fixture';
  process.env.ROSIE_EXECUTABLE_PROVIDERS = 'api';
  globalThis.__rosieDbPool = {
    query: async (text: string) => {
      if (text.includes('select rubric, ideal_patterns')) {
        return { rows: [{ rubric, ideal_patterns: patterns }] };
      }
      throw new Error(`Unexpected database query: ${text}`);
    },
  } as unknown as Pool;

  ({ POST: calibratePost } = await import('../src/app/api/calibrate/route'));
  ({ POST: rubricPost } = await import(
    '../src/app/api/rubric/generate/route'
  ));
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalThreshold === undefined) {
    delete process.env.ROSIE_CALIBRATION_MIN_STAGE;
  } else {
    process.env.ROSIE_CALIBRATION_MIN_STAGE = originalThreshold;
  }
});

after(() => {
  globalThis.fetch = originalFetch;
  globalThis.__rosieDbPool = undefined;
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
  if (originalExecutableProviders === undefined) {
    delete process.env.ROSIE_EXECUTABLE_PROVIDERS;
  } else {
    process.env.ROSIE_EXECUTABLE_PROVIDERS = originalExecutableProviders;
  }
});

describe('POST /api/calibrate', () => {
  it('accepts the current browser-generated multipart request unchanged', async () => {
    globalThis.fetch = async () => {
      throw new Error('Multipart cache hit must not fetch');
    };
    const formData = new FormData();
    formData.append(
      'resumes',
      new File(['Experienced systems engineer'], 'fixture.txt', {
        type: 'text/plain',
      })
    );
    formData.append('rubric', JSON.stringify(rubric));
    formData.append('jobDescription', 'Build reliable recruiting systems.');
    const request = new Request('http://localhost/api/calibrate', {
      method: 'POST',
      body: formData,
    });

    assert.match(
      request.headers.get('content-type') || '',
      /^multipart\/form-data; boundary=/
    );
    assert.equal(formData.has('provider'), false);

    const response = await calibratePost(request);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.targetStage, 'Manual upload');
    assert.deepEqual(body.exemplars, [
      { name: 'fixture.txt', stage: 'Manual upload', status: 'uploaded' },
    ]);
    assert.equal(body.calibratedRubric.calibrationSummary, 'Fixture calibration');
  });

  it('returns 4xx for a JSON request whose provider is not executable', async () => {
    let fetched = false;
    globalThis.fetch = async () => {
      fetched = true;
      throw new Error('Non-executable provider must fail before fetch');
    };
    const response = await calibratePost(
      new Request('http://localhost/api/calibrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: 424242,
          rubric,
          jobDescription: 'Fixture job',
          provider: 'claude-agent',
        }),
      })
    );

    assert.equal(response.status >= 400 && response.status < 500, true);
    assert.match((await response.json()).error, /not executable/);
    assert.equal(fetched, false);
  });

  it('returns a clear skip payload with the cascade trace when too few candidates qualify', async () => {
    const requestedPaths: string[] = [];
    globalThis.fetch = async (input) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString()
      );
      requestedPaths.push(url.pathname);
      if (url.pathname.endsWith('/stages')) {
        // A realistic ladder: the floor is derived from the stage above
        // "Hiring Manager Review", so the fixture has to carry one.
        return Response.json([
          { id: 1, name: 'Application Review', priority: 0 },
          { id: 4, name: 'Hiring Manager Review', priority: 3 },
          { id: 3, name: 'Manager / Tech Screen', priority: 4 },
          { id: 2, name: 'Onsite Interviews', priority: 5 },
        ]);
      }
      if (url.pathname.endsWith('/candidates')) {
        return Response.json([
          {
            id: 10,
            first_name: 'Avery',
            last_name: 'Fixture',
            applications: [
              {
                id: 20,
                prospect: false,
                applied_at: '2026-07-01T00:00:00.000Z',
                rejected_at: null,
                jobs: [{ id: 424242, name: 'Fixture role' }],
                status: 'active',
                current_stage: { id: 2, name: 'Onsite Interviews' },
              },
            ],
            attachments: [],
          },
        ]);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };

    const response = await calibratePost(
      new Request('http://localhost/api/calibrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: 424242,
          rubric,
          jobDescription: 'Fixture job',
        }),
      })
    );

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.skipped, true);
    assert.match(body.reason, /found 1 candidate.*at least 3 are required/);
    // The floor is Manager / Tech Screen, the rung above Hiring Manager Review.
    assert.equal(body.targetStage, 'Manager / Tech Screen');
    assert.deepEqual(body.exemplars, [
      {
        name: 'Avery Fixture',
        stage: 'Onsite Interviews',
        status: 'active',
        activityAt: '2026-07-01T00:00:00.000Z',
      },
    ]);
    // The whole walk is reported, empty rungs included, so the operator can see
    // what the cascade looked at rather than only what it returned. Hiring
    // Manager Review is below the floor and must not appear.
    assert.deepEqual(body.rungs, [
      { stage: 'Hired', priority: null, matched: 0, taken: 0 },
      { stage: 'Onsite Interviews', priority: 5, matched: 1, taken: 1 },
      { stage: 'Manager / Tech Screen', priority: 4, matched: 0, taken: 0 },
    ]);
    assert.deepEqual(requestedPaths, [
      '/v1/jobs/424242/stages',
      '/v1/candidates',
    ]);
  });

  it('returns 400 with available stages when the threshold cannot be resolved', async () => {
    process.env.ROSIE_CALIBRATION_MIN_STAGE = 'Executive Review';
    globalThis.fetch = async () =>
      Response.json([
        { id: 1, name: 'Application Review', priority: 0 },
        { id: 2, name: 'Onsite Interviews', priority: 5 },
      ]);

    const response = await calibratePost(
      new Request('http://localhost/api/calibrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: 424242,
          rubric,
          jobDescription: 'Fixture job',
        }),
      })
    );

    assert.equal(response.status, 400);
    assert.match(
      (await response.json()).error,
      /Available stages: Application Review, Onsite Interviews/
    );
  });
});

it('POST /api/rubric/generate rejects a non-executable provider with 4xx', async () => {
  const response = await rubricPost(
    new Request('http://localhost/api/rubric/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobDescription: 'Fixture job',
        provider: 'codex-agent',
      }),
    })
  );

  assert.equal(response.status >= 400 && response.status < 500, true);
  assert.match((await response.json()).error, /not executable/);
});
