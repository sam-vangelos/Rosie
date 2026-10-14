import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  VERSION_TAGS,
  makeCalibrationVersion,
  makeResumeArtifactKey,
  makeRubricVersion,
  makeScoreVersionKey,
} from '../src/lib/cache';
import {
  assessParseQuality,
  isAuditDisagreement,
  selectAuditSampleIds,
  shouldEscalateLikelyNoBucket,
  shouldEscalateToFullScore,
  shouldUsePdfInput,
} from '../src/lib/screening-logic';

describe('cache version helpers', () => {
  it('uses the Phase 2 prompt cache versions', () => {
    assert.equal(VERSION_TAGS.score, 'score-v4');
    assert.equal(VERSION_TAGS.triage, 'triage-v2');
  });

  it('keeps rubric versions stable for identical inputs', () => {
    const a = makeRubricVersion({
      jobDescription: 'Staff data scientist',
      intakeNotes: 'Hiring manager values experimentation',
      model: 'gpt-5.4',
    });
    const b = makeRubricVersion({
      jobDescription: 'Staff data scientist',
      intakeNotes: 'Hiring manager values experimentation',
      model: 'gpt-5.4',
    });

    assert.equal(a, b);
  });

  it('changes rubric versions when inputs change', () => {
    const a = makeRubricVersion({
      jobDescription: 'Staff data scientist',
      intakeNotes: 'Hiring manager values experimentation',
      model: 'gpt-5.4',
    });
    const b = makeRubricVersion({
      jobDescription: 'Staff data scientist',
      intakeNotes: 'Hiring manager cares about RL infra',
      model: 'gpt-5.4',
    });

    assert.notEqual(a, b);
  });

  it('treats exemplar file order as irrelevant for calibration cache keys', () => {
    const a = makeCalibrationVersion({
      rubricVersion: 'rubric-v1',
      exemplarHashes: ['resume-c', 'resume-a', 'resume-b'],
      model: 'gpt-5.4',
    });
    const b = makeCalibrationVersion({
      rubricVersion: 'rubric-v1',
      exemplarHashes: ['resume-b', 'resume-c', 'resume-a'],
      model: 'gpt-5.4',
    });

    assert.equal(a, b);
  });

  it('invalidates resume cache keys when the candidate or attachment changes', () => {
    const base = makeResumeArtifactKey({
      candidateId: 1,
      updatedAt: '2026-04-01T00:00:00.000Z',
      attachmentUrl: 'https://example.com/resume.pdf',
      attachmentCreatedAt: '2026-04-01T00:00:00.000Z',
    });

    const updated = makeResumeArtifactKey({
      candidateId: 1,
      updatedAt: '2026-04-02T00:00:00.000Z',
      attachmentUrl: 'https://example.com/resume.pdf',
      attachmentCreatedAt: '2026-04-01T00:00:00.000Z',
    });

    const attachmentChanged = makeResumeArtifactKey({
      candidateId: 1,
      updatedAt: '2026-04-01T00:00:00.000Z',
      attachmentUrl: 'https://example.com/new-resume.pdf',
      attachmentCreatedAt: '2026-04-01T00:00:00.000Z',
    });

    assert.notEqual(base, updated);
    assert.notEqual(base, attachmentChanged);
  });

  it('invalidates score cache keys when rubric, calibration, model, or input mode changes', () => {
    const base = makeScoreVersionKey({
      resumeFingerprint: 'resume-hash',
      rubricVersion: 'rubric-v1',
      calibrationVersion: 'cal-v1',
      model: 'gpt-5.4',
      inputMode: 'text',
    });

    const changedCalibration = makeScoreVersionKey({
      resumeFingerprint: 'resume-hash',
      rubricVersion: 'rubric-v1',
      calibrationVersion: 'cal-v2',
      model: 'gpt-5.4',
      inputMode: 'text',
    });

    const changedModel = makeScoreVersionKey({
      resumeFingerprint: 'resume-hash',
      rubricVersion: 'rubric-v1',
      calibrationVersion: 'cal-v1',
      model: 'gpt-5.4-mini',
      inputMode: 'text',
    });

    const changedInputMode = makeScoreVersionKey({
      resumeFingerprint: 'resume-hash',
      rubricVersion: 'rubric-v1',
      calibrationVersion: 'cal-v1',
      model: 'gpt-5.4',
      inputMode: 'pdf',
    });

    assert.notEqual(base, changedCalibration);
    assert.notEqual(base, changedModel);
    assert.notEqual(base, changedInputMode);
  });
});

describe('screening logic', () => {
  function lcg(seed: number): () => number {
    let state = seed >>> 0;
    return () => ((state = (Math.imul(1664525, state) + 1013904223) >>> 0) / 2 ** 32);
  }

  it('classifies parse quality from extracted text and file availability', () => {
    assert.equal(assessParseQuality('A'.repeat(1500), null), 'good');
    assert.equal(assessParseQuality('short text', null), 'poor');
    assert.equal(assessParseQuality(null, 'base64-pdf'), 'poor');
    assert.equal(assessParseQuality(null, null), 'missing');
  });

  it('escalates non-good parses and ambiguous triage results to full scoring', () => {
    assert.equal(
      shouldEscalateToFullScore(
        {
          bucket: 'likely_no',
          confidence: 0.96,
          needsFullScore: false,
          rationale: '',
          currentRole: '',
          currentCompany: '',
        },
        'good'
      ),
      false
    );

    assert.equal(
      shouldEscalateToFullScore(
        {
          bucket: 'likely_no',
          confidence: 0.4,
          needsFullScore: false,
          rationale: '',
          currentRole: '',
          currentCompany: '',
        },
        'good'
      ),
      true
    );

    assert.equal(
      shouldEscalateToFullScore(
        {
          bucket: 'likely_no',
          confidence: 0.99,
          needsFullScore: false,
          rationale: '',
          currentRole: '',
          currentCompany: '',
        },
        'poor'
      ),
      true
    );
  });

  it('uses PDF input only when that extra fidelity is warranted', () => {
    assert.equal(shouldUsePdfInput('good', true, true, 'borderline'), false);
    assert.equal(shouldUsePdfInput('good', true, true, 'top_signal'), true);
    assert.equal(shouldUsePdfInput('poor', true, true, 'likely_no'), true);
    assert.equal(shouldUsePdfInput('good', false, false, 'top_signal'), false);
  });

  it('samples deterministically without replacement under a seeded RNG', () => {
    const ids = Array.from({ length: 20 }, (_, index) => `candidate-${index}`);
    const first = selectAuditSampleIds(ids, { random: lcg(42) });
    const second = selectAuditSampleIds(ids, { random: lcg(42) });
    assert.deepStrictEqual(first, second);
    assert.deepStrictEqual(first, [
      'candidate-13',
      'candidate-10',
      'candidate-2',
      'candidate-14',
      'candidate-18',
    ]);
    assert.equal(first.length, 5);
    assert.equal(new Set(first).size, first.length);
  });

  it('applies the minimum sample floor and audits a small bucket in full', () => {
    const ids = Array.from({ length: 40 }, (_, index) => String(index));
    assert.equal(selectAuditSampleIds(ids, { random: lcg(1), sampleRate: 0.01 }).length, 5);
    assert.deepStrictEqual(selectAuditSampleIds(['e', 'a', 'c', 'b', 'd']), ['a', 'b', 'c', 'd', 'e']);
    assert.deepStrictEqual(selectAuditSampleIds(['a'], { random: lcg(1) }), ['a']);
  });

  it('sorts before sampling so Greenhouse input order cannot bias selection', () => {
    const ordered = Array.from({ length: 20 }, (_, index) => `candidate-${index}`);
    const reversed = [...ordered].reverse();
    assert.deepStrictEqual(
      selectAuditSampleIds(ordered, { random: lcg(7) }),
      selectAuditSampleIds(reversed, { random: lcg(7) })
    );
  });

  it('skips sampling when the rollout sample rate is zero', () => {
    assert.deepStrictEqual(selectAuditSampleIds(['a', 'b', 'c'], { sampleRate: 0 }), []);
  });

  it('defines disagreement and bucket escalation at the same strong-score boundary', () => {
    for (const [score, disagreement] of [
      [6, false],
      [7, false],
      [7.9, false],
      [8, true],
      [9.2, true],
    ] as const) {
      assert.equal(isAuditDisagreement(score), disagreement);
      assert.equal(
        shouldEscalateLikelyNoBucket({ disagreements: disagreement ? 1 : 0 }),
        disagreement
      );
    }
  });

  it('does not repeat the old one-moderate-score-in-ten escalation', () => {
    const scores = [7, 6, 6, 6, 6, 6, 6, 6, 6, 6];
    const disagreements = scores.filter(isAuditDisagreement).length;
    assert.equal(disagreements, 0);
    assert.equal(shouldEscalateLikelyNoBucket({ disagreements }), false);
  });
});
