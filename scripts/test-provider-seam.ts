import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildRequestFixtures, stableStringify } from './capture-request-fixtures';
import {
  makeCalibrationVersion,
  makeRubricVersion,
  makeScoreVersionKey,
  makeTriageVersionKey,
} from '../src/lib/cache';
import { getExecutableProviders } from '../src/lib/providers/config';
import {
  ValidationError,
  validateTriageDecision,
} from '../src/lib/scoring-validation';

test('API request params remain identical to the pre-refactor golden fixture', async () => {
  const expected = JSON.parse(
    await readFile(new URL('./fixtures/request-params.golden.json', import.meta.url), 'utf8')
  );
  assert.deepEqual(JSON.parse(stableStringify(await buildRequestFixtures())), expected);
});

test('provider tags preserve API cache keys and namespace non-API providers', () => {
  const rubricInput = {
    jobDescription: 'fixture job',
    intakeNotes: 'fixture notes',
    model: 'fixture-model',
  };
  assert.equal(
    makeRubricVersion(rubricInput),
    makeRubricVersion({ ...rubricInput, provider: undefined })
  );
  assert.notEqual(
    makeRubricVersion(rubricInput),
    makeRubricVersion({ ...rubricInput, provider: 'claude-agent' })
  );

  const calibrationInput = {
    rubricVersion: 'rubric-fixture',
    exemplarHashes: ['b', 'a'],
    model: 'fixture-model',
  };
  assert.equal(
    makeCalibrationVersion(calibrationInput),
    makeCalibrationVersion({ ...calibrationInput, provider: undefined })
  );
  assert.notEqual(
    makeCalibrationVersion(calibrationInput),
    makeCalibrationVersion({ ...calibrationInput, provider: 'claude-agent' })
  );

  const scoreInput = {
    resumeFingerprint: 'resume-fixture',
    rubricVersion: 'rubric-fixture',
    calibrationVersion: null,
    model: 'fixture-model',
    inputMode: 'text' as const,
  };
  assert.equal(
    makeScoreVersionKey(scoreInput),
    makeScoreVersionKey({ ...scoreInput, provider: undefined })
  );
  assert.notEqual(
    makeScoreVersionKey(scoreInput),
    makeScoreVersionKey({ ...scoreInput, provider: 'claude-agent' })
  );

  const triageInput = {
    resumeFingerprint: 'resume-fixture',
    rubricVersion: 'rubric-fixture',
    calibrationVersion: null,
    model: 'fixture-model',
  };
  assert.equal(
    makeTriageVersionKey(triageInput),
    makeTriageVersionKey({ ...triageInput, provider: undefined })
  );
  assert.notEqual(
    makeTriageVersionKey(triageInput),
    makeTriageVersionKey({ ...triageInput, provider: 'claude-agent' })
  );
});

test('executable provider configuration defaults, parses, and drops garbage', () => {
  const original = process.env.ROSIE_EXECUTABLE_PROVIDERS;
  const originalWarn = console.warn;
  try {
    delete process.env.ROSIE_EXECUTABLE_PROVIDERS;
    assert.deepEqual(getExecutableProviders(), ['api']);

    process.env.ROSIE_EXECUTABLE_PROVIDERS = 'api, claude-agent';
    assert.deepEqual(getExecutableProviders(), ['api', 'claude-agent']);

    console.warn = () => {};
    process.env.ROSIE_EXECUTABLE_PROVIDERS = 'garbage, codex-agent, nope';
    assert.deepEqual(getExecutableProviders(), ['codex-agent']);

    process.env.ROSIE_EXECUTABLE_PROVIDERS = 'garbage';
    assert.deepEqual(getExecutableProviders(), []);

    process.env.ROSIE_EXECUTABLE_PROVIDERS = '   ';
    assert.deepEqual(getExecutableProviders(), ['api']);
  } finally {
    console.warn = originalWarn;
    if (original === undefined) {
      delete process.env.ROSIE_EXECUTABLE_PROVIDERS;
    } else {
      process.env.ROSIE_EXECUTABLE_PROVIDERS = original;
    }
  }
});

test('agent providers are registered without constructing them eagerly', async () => {
  const { getProvider, getRegisteredProviders } = await import('../src/lib/providers');
  assert.deepEqual(getRegisteredProviders(), [
    'api',
    'claude-agent',
    'codex-agent',
  ]);
  assert.equal(getProvider('api').supportsBatch, true);
  process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-enterprise-oauth-token';
  assert.equal(getProvider('claude-agent').supportsBatch, false);
  process.env.ROSIE_CODEX_TRIAGE_MODEL = 'codex-triage-fixture';
  process.env.ROSIE_CODEX_FULL_MODEL = 'codex-full-fixture';
  assert.equal(getProvider('codex-agent').supportsBatch, false);
});

test('providers endpoint returns registered and executable providers', async () => {
  process.env.ROSIE_EXECUTABLE_PROVIDERS = 'api,claude-agent,codex-agent';
  const { GET } = await import('../src/app/api/providers/route');
  const response = await GET();
  assert.deepEqual(await response.json(), {
    providers: ['api', 'claude-agent', 'codex-agent'],
  });
});

test('triage validation accepts the contract and rejects malformed fields', () => {
  const valid = {
    bucket: 'top_signal',
    confidence: 0.8,
    needsFullScore: true,
    rationale: 'Built the required system.',
    currentRole: 'Staff Engineer',
    currentCompany: 'Example',
  };
  assert.doesNotThrow(() => validateTriageDecision(valid, 'Avery'));

  for (const invalid of [
    { ...valid, bucket: 'maybe' },
    { ...valid, confidence: 'high' },
    { ...valid, needsFullScore: 'yes' },
    { ...valid, rationale: ' ' },
    Object.fromEntries(Object.entries(valid).filter(([key]) => key !== 'currentRole')),
  ]) {
    assert.throws(
      () => validateTriageDecision(invalid, 'Avery'),
      ValidationError
    );
  }
});
