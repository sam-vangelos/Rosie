import assert from 'node:assert/strict';
import { loadEnvFile } from 'node:process';
import { describe, it, test } from 'node:test';
import { stripNulBytes } from '../src/lib/sanitize-text';

if (!process.env.DATABASE_URL) {
  try {
    loadEnvFile('.env.local');
  } catch {
    // The database round-trip below skips when no local database is configured.
  }
}

const NUL = '\u0000';

describe('stripNulBytes', () => {
  it('removes every NUL while preserving the surrounding resume text', () => {
    const extracted = `Jane Doe${NUL}\nStaff Engineer${NUL}${NUL} - Acme`;
    const cleaned = stripNulBytes(extracted);
    assert.equal(cleaned, 'Jane Doe\nStaff Engineer - Acme');
    assert.ok(!cleaned.includes(NUL));
  });

  it('leaves clean text byte-identical so existing extractions do not change', () => {
    const clean = 'Jane Doe\r\n\tStaff Engineer — Acme, résumé';
    assert.equal(stripNulBytes(clean), clean);
  });

  it('preserves the control characters Postgres accepts', () => {
    // Only 0x00 is illegal in a Postgres text column. Widening the strip would
    // silently alter text for resumes that store correctly today.
    const withControls = `a\u0001b\u0008c\u001Fd`;
    assert.equal(stripNulBytes(withControls), withControls);
  });

  it('maps null and undefined to null', () => {
    assert.equal(stripNulBytes(null), null);
    assert.equal(stripNulBytes(undefined), null);
  });

  it('reduces an all-NUL string to empty rather than null', () => {
    assert.equal(stripNulBytes(`${NUL}${NUL}`), '');
  });
});

// The assertions above only prove a string operation. The defect was a Postgres
// constraint, so the regression lock has to be the database itself: this proves
// the raw text is genuinely rejected with the production error, and that the
// sanitized text round-trips intact. A temporary table keeps the assertion
// honest without writing to a real one.
test('sanitized resume text satisfies the Postgres text constraint', async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip('DATABASE_URL is unset');
    return;
  }

  const { pool } = await import('../src/lib/db');
  const client = await pool.connect();
  const resumeText = `Jane Doe${NUL}\nStaff Engineer at Acme`;

  try {
    await client.query('begin');
    await client.query('create temp table rosie_nul_probe (resume_text text)');

    await assert.rejects(
      () => client.query('insert into rosie_nul_probe (resume_text) values ($1)', [resumeText]),
      (error: Error) => {
        assert.match(error.message, /invalid byte sequence for encoding "UTF8": 0x00/);
        return true;
      },
      'raw extracted text containing NUL must still be rejected by Postgres — if ' +
        'this stops throwing, the sanitizer is no longer load-bearing'
    );

    // The failed statement poisons the transaction block; start a clean one.
    await client.query('rollback');
    await client.query('begin');
    await client.query('create temp table rosie_nul_probe (resume_text text)');
    await client.query('insert into rosie_nul_probe (resume_text) values ($1)', [
      stripNulBytes(resumeText),
    ]);

    const stored = await client.query<{ resume_text: string }>(
      'select resume_text from rosie_nul_probe'
    );
    assert.equal(stored.rows[0].resume_text, 'Jane Doe\nStaff Engineer at Acme');
    await client.query('rollback');
  } finally {
    client.release();
    await pool.end();
  }
});
