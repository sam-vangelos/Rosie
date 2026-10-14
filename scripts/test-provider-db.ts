import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import type { ScoringRubric } from '../src/lib/types';

if (!process.env.DATABASE_URL) {
  try {
    loadEnvFile('.env.local');
  } catch {
    // The suite skips below when no local database is configured.
  }
}

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
};

test('provider database guards and comparable-run isolation', async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip('DATABASE_URL is unset');
    return;
  }

  const store = await import('../src/lib/run-store');
  const { pool, query } = await import('../src/lib/db');
  const rubricVersion = `provider-db-${randomUUID()}`;
  const jobId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  const runIds: string[] = [];

  try {
    const { run: guardedRun } = await store.createRun({
      jobId,
      jobTitle: 'Provider Guard Role',
      mode: 'all',
      provider: 'claude-agent',
      rubricVersion,
      calibrationVersion: null,
      rubric,
      idealPatterns: null,
    });
    runIds.push(guardedRun.id);
    assert.equal(guardedRun.provider, 'claude-agent');

    const ownerToken = randomUUID();
    assert.equal(
      await store.claimRunLease(guardedRun.id, ownerToken, 360, ['api']),
      false
    );
    assert.equal(
      await store.claimRunLease(
        guardedRun.id,
        ownerToken,
        360,
        ['api', 'claude-agent']
      ),
      true
    );
    await store.releaseRunLease(guardedRun.id, ownerToken);
    await query(
      `update rosie_runs
       set last_updated_at = now() - interval '1 minute'
       where id = $1`,
      [guardedRun.id]
    );

    assert.equal((await store.getWatchdogRunIds(5, ['api'])).includes(guardedRun.id), false);
    assert.equal(
      (
        await store.getWatchdogRunIds(5, ['api', 'claude-agent'])
      ).includes(guardedRun.id),
      true
    );
    assert.equal(await store.shouldNudgeRun(guardedRun.id, ['api']), false);
    assert.equal(
      await store.shouldNudgeRun(guardedRun.id, ['api', 'claude-agent']),
      true
    );
    await store.setRunStatus(guardedRun.id, 'completed');

    const { run: apiRun } = await store.createRun({
      jobId,
      jobTitle: 'Provider Guard Role',
      mode: 'all',
      provider: 'api',
      rubricVersion,
      calibrationVersion: null,
      rubric,
      idealPatterns: null,
    });
    runIds.push(apiRun.id);
    await store.setRunStatus(apiRun.id, 'completed');

    const { run: latestClaudeRun } = await store.createRun({
      jobId,
      jobTitle: 'Provider Guard Role',
      mode: 'all',
      provider: 'claude-agent',
      rubricVersion,
      calibrationVersion: null,
      rubric,
      idealPatterns: null,
    });
    runIds.push(latestClaudeRun.id);
    await store.setRunStatus(latestClaudeRun.id, 'completed');

    assert.equal(
      (
        await store.getLatestComparableRun({
          jobId,
          rubricVersion,
          provider: 'api',
        })
      )?.id,
      apiRun.id
    );
    assert.equal(
      (
        await store.getLatestComparableRun({
          jobId,
          rubricVersion,
          provider: 'claude-agent',
        })
      )?.id,
      latestClaudeRun.id
    );
  } finally {
    if (runIds.length) {
      await query('delete from rosie_runs where id = any($1::uuid[])', [runIds]);
    }
    await query('delete from rosie_rubrics where rubric_version = $1', [rubricVersion]);
    await pool.end();
  }
});
