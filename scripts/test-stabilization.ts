import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyTierSelection } from '../src/lib/selection';
import { timingSafeEqual } from '../src/lib/auth';
import {
  getTargetGreenhouseStage,
  matchesTargetGreenhouseStage,
  normalizeGreenhouseStage,
} from '../src/lib/greenhouse-stage';
import {
  parseAuditSampleRate,
  parseTriageEnabled,
} from '../src/lib/screening-logic';

// ---- applyTierSelection ----

describe('applyTierSelection', () => {
  it('select adds only the specified IDs', () => {
    const current = new Set(['a', 'b']);
    const result = applyTierSelection(current, 'select', ['c', 'd']);
    assert.deepStrictEqual([...result].sort(), ['a', 'b', 'c', 'd']);
  });

  it('deselect removes only the specified IDs', () => {
    const current = new Set(['a', 'b', 'c', 'd']);
    const result = applyTierSelection(current, 'deselect', ['b', 'c']);
    assert.deepStrictEqual([...result].sort(), ['a', 'd']);
  });

  it('deselect preserves IDs not in the removal set', () => {
    const current = new Set(['top-1', 'top-2', 'strong-1', 'strong-2']);
    const result = applyTierSelection(current, 'deselect', ['strong-1', 'strong-2']);
    assert.deepStrictEqual([...result].sort(), ['top-1', 'top-2']);
  });

  it('select with empty ids is a no-op', () => {
    const current = new Set(['a', 'b']);
    const result = applyTierSelection(current, 'select', []);
    assert.deepStrictEqual([...result].sort(), ['a', 'b']);
  });

  it('deselect with empty ids is a no-op', () => {
    const current = new Set(['a', 'b']);
    const result = applyTierSelection(current, 'deselect', []);
    assert.deepStrictEqual([...result].sort(), ['a', 'b']);
  });

  it('does not mutate the input set', () => {
    const current = new Set(['a']);
    applyTierSelection(current, 'select', ['b']);
    assert.equal(current.size, 1);
    assert.ok(current.has('a'));
  });

  it('select is idempotent for already-selected IDs', () => {
    const current = new Set(['a', 'b']);
    const result = applyTierSelection(current, 'select', ['a', 'b', 'c']);
    assert.deepStrictEqual([...result].sort(), ['a', 'b', 'c']);
  });

  it('deselect of absent IDs is a no-op', () => {
    const current = new Set(['a']);
    const result = applyTierSelection(current, 'deselect', ['x', 'y']);
    assert.deepStrictEqual([...result], ['a']);
  });

  it('works with empty current set', () => {
    const result = applyTierSelection(new Set(), 'select', ['a', 'b']);
    assert.deepStrictEqual([...result].sort(), ['a', 'b']);
  });
});

// ---- timingSafeEqual ----

describe('timingSafeEqual', () => {
  it('returns true for equal strings', () => {
    assert.equal(timingSafeEqual('abc', 'abc'), true);
  });

  it('returns false for different strings of same length', () => {
    assert.equal(timingSafeEqual('abc', 'abd'), false);
  });

  it('returns false for different lengths', () => {
    assert.equal(timingSafeEqual('abc', 'abcd'), false);
  });

  it('returns true for empty strings', () => {
    assert.equal(timingSafeEqual('', ''), true);
  });

  it('returns false when one is empty', () => {
    assert.equal(timingSafeEqual('a', ''), false);
  });

  it('handles long identical strings', () => {
    const s = 'a'.repeat(1000);
    assert.equal(timingSafeEqual(s, s), true);
  });

  it('detects single-character difference in long string', () => {
    const a = 'a'.repeat(999) + 'b';
    const b = 'a'.repeat(1000);
    assert.equal(timingSafeEqual(a, b), false);
  });
});

// ---- Greenhouse stage normalization ----

describe('Greenhouse stage normalization', () => {
  it('matches case-insensitively', () => {
    assert.equal(
      normalizeGreenhouseStage('Application Review'),
      normalizeGreenhouseStage('application review')
    );
  });

  it('trims whitespace', () => {
    assert.equal(
      normalizeGreenhouseStage('  Application Review  '),
      normalizeGreenhouseStage('Application Review')
    );
  });

  it('handles mixed case and whitespace', () => {
    assert.equal(
      normalizeGreenhouseStage(' APPLICATION REVIEW '),
      normalizeGreenhouseStage('application review')
    );
  });

  it('preserves non-default stage names', () => {
    assert.equal(normalizeGreenhouseStage('Phone Screen'), 'phone screen');
  });

  it('uses the default target stage when env is unset', () => {
    const original = process.env.GREENHOUSE_TARGET_STAGE;
    delete process.env.GREENHOUSE_TARGET_STAGE;
    try {
      assert.equal(getTargetGreenhouseStage(), 'application review');
    } finally {
      process.env.GREENHOUSE_TARGET_STAGE = original;
    }
  });

  it('matches the configured target stage', () => {
    const original = process.env.GREENHOUSE_TARGET_STAGE;
    process.env.GREENHOUSE_TARGET_STAGE = ' Phone Screen ';
    try {
      assert.equal(matchesTargetGreenhouseStage('phone screen'), true);
      assert.equal(matchesTargetGreenhouseStage('Application Review'), false);
    } finally {
      process.env.GREENHOUSE_TARGET_STAGE = original;
    }
  });
});

describe('screening rollout config', () => {
  it('defaults triage on and only disables it for false', () => {
    assert.equal(parseTriageEnabled(undefined), true);
    assert.equal(parseTriageEnabled('true'), true);
    assert.equal(parseTriageEnabled(' FALSE '), false);
  });

  it('defaults and clamps the audit sample rate', () => {
    assert.equal(parseAuditSampleRate(undefined), 0.1);
    assert.equal(parseAuditSampleRate('invalid'), 0.1);
    assert.equal(parseAuditSampleRate('-1'), 0);
    assert.equal(parseAuditSampleRate('0'), 0);
    assert.equal(parseAuditSampleRate('0.25'), 0.25);
    assert.equal(parseAuditSampleRate('2'), 1);
  });
});
