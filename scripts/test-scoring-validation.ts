import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ValidationError,
  validateScoringResult,
  withRetry,
} from '../src/lib/scoring-validation';
import type { ScoringRubric } from '../src/lib/types';

// ---- Fixtures ----

const RUBRIC: ScoringRubric = {
  criteria: [
    {
      id: 'rl-env-design',
      name: 'RL Environment Design',
      description: 'test',
      weight: 50,
      scoringGuide: { high: 'h', mid: 'm', low: 'l' },
    },
    {
      id: 'reward-eng',
      name: 'Reward Engineering',
      description: 'test',
      weight: 50,
      scoringGuide: { high: 'h', mid: 'm', low: 'l' },
    },
  ],
  tableStakes: ['Python'],
};

const VALID_RESULT = {
  criterionScores: [
    { criterionId: 'rl-env-design', score: 8.5, evidence: 'Built custom OpenAI Gym envs at DeepMind' },
    { criterionId: 'reward-eng', score: 7.0, evidence: 'Designed shaped reward for locomotion task' },
  ],
  strengths: ['Strong RL background'],
  gaps: ['No multi-agent experience'],
  currentRole: 'Research Engineer',
  currentCompany: 'DeepMind',
};

function clone<T>(obj: T): T {
  return structuredClone(obj);
}

// ---- validateScoringResult tests ----

describe('validateScoringResult', () => {
  it('accepts valid result', () => {
    validateScoringResult(VALID_RESULT, RUBRIC, 'Test Candidate');
  });

  describe('criterionScores structure', () => {
    it('rejects non-array criterionScores', () => {
      assert.throws(
        () => validateScoringResult({ criterionScores: 'not-array' }, RUBRIC, 'C'),
        (err: unknown) => err instanceof ValidationError && err.message.includes('not an array'),
      );
    });

    it('rejects null entry in array', () => {
      assert.throws(
        () =>
          validateScoringResult(
            { criterionScores: [null, VALID_RESULT.criterionScores[1]] },
            RUBRIC,
            'C',
          ),
        (err: unknown) => err instanceof ValidationError && err.message.includes('not an object'),
      );
    });
  });

  describe('criterionId checks', () => {
    it('rejects empty criterionId', () => {
      const bad = clone(VALID_RESULT);
      bad.criterionScores[0].criterionId = '';
      assert.throws(
        () => validateScoringResult(bad, RUBRIC, 'C'),
        (err: unknown) => err instanceof ValidationError && err.message.includes('missing or empty'),
      );
    });

    it('rejects unknown criterionId', () => {
      const bad = clone(VALID_RESULT);
      bad.criterionScores[0].criterionId = 'made-up-id';
      assert.throws(
        () => validateScoringResult(bad, RUBRIC, 'C'),
        (err: unknown) => err instanceof ValidationError && err.message.includes('not found in rubric'),
      );
    });

    it('rejects duplicate criterionId', () => {
      const bad = clone(VALID_RESULT);
      bad.criterionScores[1].criterionId = 'rl-env-design';
      assert.throws(
        () => validateScoringResult(bad, RUBRIC, 'C'),
        (err: unknown) => err instanceof ValidationError && err.message.includes('duplicate'),
      );
    });
  });

  describe('score checks', () => {
    it('rejects non-numeric score', () => {
      const bad = clone(VALID_RESULT);
      // Force a non-numeric value to test runtime validation
      (bad.criterionScores[0] as Record<string, unknown>).score = 'high';
      assert.throws(
        () => validateScoringResult(bad as Record<string, unknown>, RUBRIC, 'C'),
        (err: unknown) => err instanceof ValidationError && err.message.includes('not a finite number'),
      );
    });

    it('rejects NaN score', () => {
      const bad = clone(VALID_RESULT);
      bad.criterionScores[0].score = NaN;
      assert.throws(
        () => validateScoringResult(bad, RUBRIC, 'C'),
        (err: unknown) => err instanceof ValidationError && err.message.includes('not a finite number'),
      );
    });

    it('rejects Infinity score', () => {
      const bad = clone(VALID_RESULT);
      bad.criterionScores[0].score = Infinity;
      assert.throws(
        () => validateScoringResult(bad, RUBRIC, 'C'),
        (err: unknown) => err instanceof ValidationError && err.message.includes('not a finite number'),
      );
    });

    it('rejects score > 10', () => {
      const bad = clone(VALID_RESULT);
      bad.criterionScores[0].score = 11;
      assert.throws(
        () => validateScoringResult(bad, RUBRIC, 'C'),
        (err: unknown) => err instanceof ValidationError && err.message.includes('outside 0-10'),
      );
    });

    it('rejects score < 0', () => {
      const bad = clone(VALID_RESULT);
      bad.criterionScores[0].score = -1;
      assert.throws(
        () => validateScoringResult(bad, RUBRIC, 'C'),
        (err: unknown) => err instanceof ValidationError && err.message.includes('outside 0-10'),
      );
    });

    it('accepts boundary scores 0 and 10', () => {
      const edge = clone(VALID_RESULT);
      edge.criterionScores[0].score = 0;
      edge.criterionScores[1].score = 10;
      validateScoringResult(edge, RUBRIC, 'C');
    });
  });

  describe('evidence checks', () => {
    it('rejects empty evidence', () => {
      const bad = clone(VALID_RESULT);
      bad.criterionScores[0].evidence = '';
      assert.throws(
        () => validateScoringResult(bad, RUBRIC, 'C'),
        (err: unknown) => err instanceof ValidationError && err.message.includes('missing or empty'),
      );
    });

    it('rejects whitespace-only evidence', () => {
      const bad = clone(VALID_RESULT);
      bad.criterionScores[0].evidence = '   ';
      assert.throws(
        () => validateScoringResult(bad, RUBRIC, 'C'),
        (err: unknown) => err instanceof ValidationError && err.message.includes('missing or empty'),
      );
    });
  });

  describe('missing criteria', () => {
    it('rejects missing criterion', () => {
      const bad = { criterionScores: [VALID_RESULT.criterionScores[0]] };
      assert.throws(
        () => validateScoringResult(bad, RUBRIC, 'C'),
        (err: unknown) => err instanceof ValidationError && err.message.includes('missing criterion "reward-eng"'),
      );
    });
  });

  describe('multiple issues', () => {
    it('reports all issues in one message', () => {
      const bad = {
        criterionScores: [
          { criterionId: '', score: 'bad', evidence: '' },
          { criterionId: 'made-up', score: 15, evidence: '   ' },
        ],
      };
      assert.throws(
        () => validateScoringResult(bad, RUBRIC, 'C'),
        (err: unknown) => {
          if (!(err instanceof ValidationError)) return false;
          const issueCount = err.message.split(';').length;
          return issueCount >= 4;
        },
      );
    });
  });

  describe('error message safety', () => {
    it('does not leak raw payload', () => {
      const bad = clone(VALID_RESULT);
      bad.criterionScores[0].criterionId = 'secret-internal-id';
      try {
        validateScoringResult(bad, RUBRIC, 'C');
        assert.fail('Should have thrown');
      } catch (err) {
        assert.ok(err instanceof ValidationError);
        assert.ok(!err.message.includes('"score"'), 'Should not contain full payload');
        assert.ok(!err.message.includes('"evidence"'), 'Should not contain full payload');
      }
    });
  });
});

// ---- withRetry tests ----

describe('withRetry', () => {
  it('retries ValidationError and succeeds on later attempt', async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 3) {
          throw new ValidationError('Scoring validation failed for C: bad output');
        }
        return 'ok';
      },
      'test-retry',
      3,
    );
    assert.equal(result, 'ok');
    assert.equal(attempts, 3);
  });

  it('exhausts retries and throws ValidationError with attempt count', async () => {
    await assert.rejects(
      () =>
        withRetry(
          async () => {
            throw new ValidationError('Scoring validation failed for C: always bad');
          },
          'test-exhaust',
          3,
        ),
      (err: unknown) => {
        if (!(err instanceof ValidationError)) return false;
        return (
          err.message.includes('after 3 attempts') &&
          err.message.includes('always bad')
        );
      },
    );
  });

  it('does not retry non-retryable errors', async () => {
    let attempts = 0;
    await assert.rejects(
      () =>
        withRetry(
          async () => {
            attempts++;
            throw new Error('some other error');
          },
          'test-no-retry',
          3,
        ),
      (err: unknown) => err instanceof Error && err.message === 'some other error',
    );
    assert.equal(attempts, 1);
  });

  it('retries JSON parse errors', async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 2) {
          JSON.parse('{');
        }
        return 'ok';
      },
      'test-json-parse',
      3,
    );
    assert.equal(result, 'ok');
    assert.equal(attempts, 2);
  });

  it('leaves API and transport retries to the SDK', async () => {
    for (const message of ['rate_limit exceeded', 'timeout', 'ECONNRESET']) {
      let attempts = 0;
      await assert.rejects(
        withRetry(async () => {
          attempts++;
          throw new Error(message);
        }, 'test-sdk-retry', 3),
        new RegExp(message)
      );
      assert.equal(attempts, 1);
    }
  });
});
