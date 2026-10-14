import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const globalsUrl = new URL('../src/app/globals.css', import.meta.url);
const runsUrl = new URL('../src/app/runs/[id]/page.tsx', import.meta.url);
const candidatesUrl = new URL(
  '../src/components/viewer/RunCandidateList.tsx',
  import.meta.url
);

describe('viewer accessibility styling', () => {
  it('uses neutral readable ink for live status with no live color token', async () => {
    const css = await readFile(globalsUrl, 'utf8');

    assert.doesNotMatch(css, /--v-live:/);
    assert.match(
      css,
      /\.viewer-status-chip\[data-status-tone='live'\]\s*\{[^}]*color:\s*var\(--v-ink-2\)/
    );
    assert.match(
      css,
      /\.viewer-status-banner\[data-status-tone='live'\]\s*\{[^}]*border-left-color:\s*var\(--v-ink-2\)/
    );
  });

  it('gives every inline viewer action the shared 44px target', async () => {
    const [css, runs, candidates] = await Promise.all([
      readFile(globalsUrl, 'utf8'),
      readFile(runsUrl, 'utf8'),
      readFile(candidatesUrl, 'utf8'),
    ]);

    assert.match(
      css,
      /\.viewer-link-target\s*\{[^}]*min-width:\s*var\(--v-hit-target\)[^}]*min-height:\s*var\(--v-hit-target\)/
    );
    assert.match(
      runs,
      /viewer-muted-link viewer-link-target[^"]*"[\s\S]*?← Runs/
    );
    assert.match(
      runs,
      /viewer-text-link viewer-link-target[^"]*"[\s\S]*?Refresh results/
    );
    assert.match(
      candidates,
      /viewer-text-link viewer-link-target[^"]*"[\s\S]*?Open in Greenhouse/
    );
    assert.match(
      candidates,
      /viewer-muted-link viewer-link-target[^"]*"[\s\S]*?href=\{section\.href\}/
    );
  });

  it('retains rank through the narrow breakpoint in one identity cell', async () => {
    const [css, candidates] = await Promise.all([
      readFile(globalsUrl, 'utf8'),
      readFile(candidatesUrl, 'utf8'),
    ]);

    assert.doesNotMatch(
      css,
      /\.viewer-candidate-rank\s*\{[^}]*display:\s*none/
    );
    assert.match(css, /\.viewer-candidate-identity\s*\{/);
    assert.match(candidates, /className="viewer-candidate-identity"/);
  });
});
