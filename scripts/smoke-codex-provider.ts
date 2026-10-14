import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { loadEnvFile } from 'node:process';
import { createCodexAgentProvider } from '../src/lib/providers/codex-agent';
import {
  assertNoCredentialLeak,
  runSubprocess,
  type SubprocessOptions,
  type SubprocessResult,
  type SubprocessRunner,
} from '../src/lib/providers/subprocess';
import type { ScoringRubric } from '../src/lib/types';

interface CapturedCall {
  options: SubprocessOptions;
  result: SubprocessResult;
  lastMessage: string;
}

const rubric: ScoringRubric = {
  criteria: [
    {
      id: 'ranking-systems',
      name: 'Ranking Systems',
      description: 'Designs and ships production ranking or retrieval systems.',
      weight: 45,
      scoringGuide: {
        high: 'Multiple production ranking systems with measured quality impact.',
        mid: 'One production ranking or retrieval system.',
        low: 'No explicit ranking or retrieval system evidence.',
      },
    },
    {
      id: 'evaluation',
      name: 'Evaluation Design',
      description: 'Builds rigorous offline and online evaluation systems.',
      weight: 35,
      scoringGuide: {
        high: 'Designed multiple evaluations tied to production decisions.',
        mid: 'Implemented a relevant evaluation workflow.',
        low: 'No explicit evaluation design evidence.',
      },
    },
    {
      id: 'data-scale',
      name: 'Data Scale',
      description: 'Operates data-intensive systems at meaningful scale.',
      weight: 20,
      scoringGuide: {
        high: 'Operated billion-record or multi-million-user systems.',
        mid: 'Operated a production data system.',
        low: 'No explicit production scale evidence.',
      },
    },
  ],
  tableStakes: ['TypeScript', 'Python'],
};

async function binaryExists(name: string): Promise<boolean> {
  for (const dir of (process.env.PATH || '').split(delimiter).filter(Boolean)) {
    try {
      await access(join(dir, name), constants.X_OK);
      return true;
    } catch {
      // Keep searching PATH.
    }
  }
  return false;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function argValue(argv: string[], flag: string): string {
  const index = argv.indexOf(flag);
  assert.notEqual(index, -1, `${flag} missing from codex argv`);
  return argv[index + 1];
}

function argValues(argv: string[], flag: string): string[] {
  return argv.flatMap((value, index) =>
    value === flag ? [argv[index + 1]] : []
  );
}

function jsonShape(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return 'array';
    if (parsed === null) return 'null';
    return typeof parsed;
  } catch {
    return 'wrapped-or-non-json';
  }
}

function assertCodexPolicy(
  options: SubprocessOptions,
  codexHome: string
): void {
  assert.equal(argValue(options.argv, '--sandbox'), 'read-only');
  assert.equal(options.argv.includes('--skip-git-repo-check'), true);
  assert.equal(options.argv.includes('--ephemeral'), true);
  assert.equal(argValue(options.argv, '-C'), options.cwd);
  assert.equal(options.argv.includes('--json'), false);
  assert.equal(
    argValue(options.argv, '--output-schema'),
    join(options.cwd, 'schema.json')
  );
  assert.equal(
    argValue(options.argv, '--output-last-message'),
    join(options.cwd, 'last-message.json')
  );
  assert.equal(options.argv.at(-1), '-');
  assert.deepEqual(Object.keys(options.env).sort(), [
    'CODEX_HOME',
    'HOME',
    'PATH',
  ]);
  assert.equal(options.env.CODEX_HOME, codexHome);
  assert.equal(options.env.HOME, options.cwd);
  for (const secret of [
    'ANTHROPIC_API_KEY',
    'BLOB_READ_WRITE_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'DATABASE_URL',
    'GREENHOUSE_API_KEY',
    'ROSIE_AUTH_SECRET',
  ]) {
    assert.equal(secret in options.env, false);
  }
}

function reportCalls(label: string, calls: CapturedCall[]): void {
  assert.equal(calls.length > 0, true, `${label} made no codex calls`);
  for (const { options, result, lastMessage } of calls) {
    console.log(
      `[smoke-codex-provider] ${label} duration_ms=${
        result.durationMs
      } exit_code=${result.exitCode} model=${argValue(
        options.argv,
        '-m'
      )} page_count=${argValues(options.argv, '-i').length} last_message_bytes=${
        Buffer.byteLength(lastMessage)
      } last_message_shape=${jsonShape(lastMessage)}`
    );
  }
}

async function main(): Promise<void> {
  if (!(await binaryExists('codex'))) {
    console.log('[smoke-codex-provider] skipped: codex binary is absent');
    return;
  }

  // Parity with smoke-claude-provider: read local config from .env.local when
  // it is not already exported, so both sibling smokes run the same way.
  if (!process.env.ROSIE_CODEX_TRIAGE_MODEL?.trim()) {
    try {
      loadEnvFile('.env.local');
    } catch {
      // The clean skips below cover a missing local env file.
    }
  }

  const codexHome =
    process.env.ROSIE_CODEX_HOME?.trim() || join(homedir(), '.rosie-codex');
  const authFile = join(codexHome, 'auth.json');
  if (!(await fileExists(authFile))) {
    console.log(
      `[smoke-codex-provider] skipped: dedicated CODEX_HOME has no auth.json (${codexHome})`
    );
    return;
  }
  const missingModels = [
    'ROSIE_CODEX_TRIAGE_MODEL',
    'ROSIE_CODEX_FULL_MODEL',
  ].filter((name) => !process.env[name]?.trim());
  if (missingModels.length > 0) {
    console.log(
      `[smoke-codex-provider] skipped: missing mandatory model config (${missingModels.join(
        ', '
      )})`
    );
    return;
  }

  const captured: CapturedCall[] = [];
  const rasterCalls: Array<{
    options: SubprocessOptions;
    result: SubprocessResult;
  }> = [];
  const runner: SubprocessRunner = async (options) => {
    if (options.argv[0] === 'pdftoppm') {
      assert.deepEqual(options.argv, [
        'pdftoppm',
        '-png',
        '-r',
        '150',
        '-f',
        '1',
        '-l',
        '5',
        'resume.pdf',
        'page',
      ]);
      assert.equal(options.timeoutMs, 30_000);
      const result = await runSubprocess(options);
      rasterCalls.push({ options, result });
      return result;
    }

    assertCodexPolicy(options, codexHome);
    for (const imagePath of argValues(options.argv, '-i')) {
      await access(imagePath, constants.R_OK);
    }
    const result = await runSubprocess(options);
    let lastMessage = '';
    if (result.exitCode === 0) {
      try {
        lastMessage = await readFile(
          argValue(options.argv, '--output-last-message'),
          'utf8'
        );
      } catch {
        // The provider owns missing-output classification.
      }
    }
    captured.push({ options, result, lastMessage });
    return result;
  };

  const provider = createCodexAgentProvider(runner);
  const fixtureDir = new URL('./fixtures/', import.meta.url);
  const resumeText = await readFile(
    new URL('smoke-resume.txt', fixtureDir),
    'utf8'
  );
  const resumePdf = await readFile(new URL('smoke-resume.pdf', fixtureDir));
  const injectionResume = await readFile(
    new URL('smoke-injection-resume.txt', fixtureDir),
    'utf8'
  );

  let captureStart = captured.length;
  await provider.triage({
    rubric,
    candidateId: 'smoke-triage',
    candidateName: 'Avery Morgan',
    resumeText,
    idealPatterns: null,
  });
  const triageCalls = captured.slice(captureStart);
  reportCalls('triage', triageCalls);
  for (const call of triageCalls) {
    assert.deepEqual(argValues(call.options.argv, '-i'), []);
  }

  captureStart = captured.length;
  await provider.score({
    rubric,
    idealPatterns: null,
    candidateId: 'smoke-score-text',
    candidateName: 'Avery Morgan',
    resumeBase64: null,
    resumeText,
    resumeMimeType: 'text/plain',
    parseQuality: 'good',
    useFileInput: false,
  });
  const textCalls = captured.slice(captureStart);
  reportCalls('text score', textCalls);
  for (const call of textCalls) {
    assert.deepEqual(argValues(call.options.argv, '-i'), []);
  }

  captureStart = captured.length;
  const rasterStart = rasterCalls.length;
  await provider.score({
    rubric,
    idealPatterns: null,
    candidateId: 'smoke-score-pdf',
    candidateName: 'Avery Morgan',
    resumeBase64: resumePdf.toString('base64'),
    resumeText: null,
    resumeMimeType: 'application/pdf',
    parseQuality: 'poor',
    useFileInput: true,
  });
  const pdfCalls = captured.slice(captureStart);
  reportCalls('PDF score', pdfCalls);
  assert.equal(rasterCalls.length > rasterStart, true);
  for (const call of pdfCalls) {
    const images = argValues(call.options.argv, '-i');
    assert.equal(images.length > 0 && images.length <= 5, true);
  }

  captureStart = captured.length;
  const injectionResult = await provider.score({
    rubric,
    idealPatterns: null,
    candidateId: 'smoke-injection',
    candidateName: 'Injection Fixture',
    resumeBase64: null,
    resumeText: injectionResume,
    resumeMimeType: 'text/plain',
    parseQuality: 'good',
    useFileInput: false,
  });
  const injectionCalls = captured.slice(captureStart);
  reportCalls('injection score', injectionCalls);
  for (const call of injectionCalls) {
    assert.deepEqual(argValues(call.options.argv, '-i'), []);
  }
  assertNoCredentialLeak(
    JSON.stringify(injectionResult),
    'smokeCodexInjection'
  );

  console.log(
    `[smoke-codex-provider] passed codex_calls=${captured.length} rasterizations=${rasterCalls.length} injection_policy=sandbox_read_only_home_isolated_no_credential_output`
  );
}

main().catch((error) => {
  console.error('[smoke-codex-provider] failed:', error);
  process.exitCode = 1;
});
