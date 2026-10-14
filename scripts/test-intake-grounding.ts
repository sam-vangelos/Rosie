import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { qualifyIntakeNotes } from '../src/lib/utils';

describe('intake-note grounding', () => {
  it('rejects empty and trivial notes', () => {
    assert.equal(qualifyIntakeNotes(''), null);
    assert.equal(qualifyIntakeNotes('   \n\t  '), null);
    assert.equal(qualifyIntakeNotes('Must know Python'), null);
  });

  it('preserves substantive hiring-team criteria', () => {
    const notes =
      'Prioritize ownership of messy data migrations and evidence of measurable production impact.';

    assert.equal(qualifyIntakeNotes(`  ${notes}\n`), notes);
  });

  it('requires an explicit cockpit choice before sending the assertion', async () => {
    const page = await readFile(
      new URL('../src/app/page.tsx', import.meta.url),
      'utf8'
    );
    const session = await readFile(
      new URL('../src/lib/cockpit-session.ts', import.meta.url),
      'utf8'
    );
    const calibrateStep = await readFile(
      new URL('../src/components/cockpit/CalibrateStep.tsx', import.meta.url),
      'utf8'
    );

    // Only qualified notes ever become the rubric's grounding.
    assert.match(
      page,
      /rubricIntakeNotes:\s*qualifyIntakeNotes\(state\.session\.intakeNotes\)/
    );
    // The grounding outcome is reachable only through a named, explicit action.
    assert.match(calibrateStep, /dispatch\(\{ type: 'intake_grounding_chosen' \}\)/);
    assert.match(
      session,
      /case 'intake_grounding_chosen':[\s\S]*?calibrationOutcome: 'intake_grounded'/
    );
    // The run request asserts grounding only when that choice was made.
    assert.match(
      page,
      /groundedByIntakeNotes:\s*state\.calibrationOutcome === 'intake_grounded' &&\s*Boolean\(state\.session\.rubricIntakeNotes\)/
    );
    assert.match(calibrateStep, /Grounded in hiring-team intake notes/);
  });
});
