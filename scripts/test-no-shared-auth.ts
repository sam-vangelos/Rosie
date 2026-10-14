import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const activeSources = [
  '../src/app/page.tsx',
  '../src/proxy.ts',
  '../src/lib/auth.ts',
  '../src/lib/require-viewer.ts',
  '../CLAUDE.md',
];

describe('shared-token auth removal', () => {
  it('leaves no shared-token mechanism in active code or guidance', async () => {
    for (const relativePath of activeSources) {
      const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
      assert.doesNotMatch(
        source,
        /ROSIE_AUTH_SECRET|rosie-session|computeSessionToken|\/api\/auth\/(?:login|logout)|access token/i,
        relativePath
      );
    }
  });

  it('removes the legacy login and logout routes', async () => {
    for (const relativePath of [
      '../src/app/api/auth/login/route.ts',
      '../src/app/api/auth/logout/route.ts',
    ]) {
      await assert.rejects(
        readFile(new URL(relativePath, import.meta.url), 'utf8'),
        (error: NodeJS.ErrnoException) => error.code === 'ENOENT'
      );
    }
  });

  it('keeps credential-free development on the loopback interface', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8')
    ) as { scripts?: { dev?: string } };

    assert.equal(packageJson.scripts?.dev, 'next dev --hostname 127.0.0.1');
  });
});
