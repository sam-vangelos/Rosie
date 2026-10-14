import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { loadEnvFile } from 'node:process';
import {
  createClaudeAgentProvider,
  normalizeEnvelope,
} from '../src/lib/providers/claude-agent';
import {
  runSubprocess,
  type SubprocessOptions,
  type SubprocessRunner,
} from '../src/lib/providers/subprocess';
import type { ScoringRubric } from '../src/lib/types';

interface CapturedEnvelope {
  is_error?: unknown;
  num_turns?: unknown;
  permission_denials?: unknown;
  structured_output?: unknown;
  total_cost_usd?: unknown;
  usage?: {
    input_tokens?: unknown;
    output_tokens?: unknown;
    cache_read_input_tokens?: unknown;
  };
}

const SECRET_PATTERN =
  /(?:sk-ant-|sk-[-A-Za-z0-9_+/=]{20,}|npg_|ghp_|vercel_blob_rw_|postgresql:\/\/)/i;

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

function argValue(argv: string[], flag: string): string {
  const index = argv.indexOf(flag);
  assert.notEqual(index, -1, `${flag} missing from claude argv`);
  return argv[index + 1];
}

// A schema-enforced call is itself implemented as an internal tool call, so
// num_turns is legitimately 2-3 even with tools disabled — it is NOT a
// no-tool signal. What is assertable: nothing was attempted and blocked.
function assertNoToolEnvelope(envelope: CapturedEnvelope, label: string): void {
  const denials = envelope.permission_denials;
  assert.equal(
    Array.isArray(denials),
    true,
    `${label} envelope is missing permission_denials`
  );
  assert.equal(
    (denials as unknown[]).length,
    0,
    `${label} attempted a blocked tool: ${JSON.stringify(denials)}`
  );
  console.log(
    `[smoke-claude-provider] ${label} num_turns=${String(
      envelope.num_turns
    )} permission_denials=0`
  );
}

async function main(): Promise<void> {
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    try {
      loadEnvFile('.env.local');
    } catch {
      // The clean skip below covers a missing local env file.
    }
  }
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    console.log(
      '[smoke-claude-provider] skipped: CLAUDE_CODE_OAUTH_TOKEN is absent'
    );
    return;
  }
  if (!(await binaryExists('claude'))) {
    console.log('[smoke-claude-provider] skipped: claude binary is absent');
    return;
  }

  const captured: Array<{
    options: SubprocessOptions;
    envelope: CapturedEnvelope;
  }> = [];
  const runner: SubprocessRunner = async (options) => {
    assert.equal(options.argv.includes('--no-session-persistence'), true);
    assert.equal(options.argv.includes('--strict-mcp-config'), true);
    assert.equal(argValue(options.argv, '--setting-sources'), '');
    const result = await runSubprocess(options);
    if (result.exitCode === 0) {
      captured.push({
        options,
        // Same normalization the driver applies: `--setting-sources ""` makes
        // the CLI emit a JSON array of messages rather than one result object.
        envelope: normalizeEnvelope(JSON.parse(result.stdout)) as CapturedEnvelope,
      });
    }
    return result;
  };
  const provider = createClaudeAgentProvider(runner);
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
  assert.equal(triageCalls.length > 0, true);
  for (const call of triageCalls) {
    assert.equal(argValue(call.options.argv, '--allowedTools'), '');
    assertNoToolEnvelope(call.envelope, 'triage');
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
  assert.equal(textCalls.length > 0, true);
  for (const call of textCalls) {
    assert.equal(argValue(call.options.argv, '--allowedTools'), '');
    assertNoToolEnvelope(call.envelope, 'text score');
  }

  captureStart = captured.length;
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
  assert.equal(pdfCalls.length > 0, true);
  for (const call of pdfCalls) {
    assert.equal(argValue(call.options.argv, '--allowedTools'), 'Read');
  }

  captureStart = captured.length;
  await provider.score({
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
  assert.equal(injectionCalls.length > 0, true);
  const injectionEnvelope = injectionCalls.at(-1)!.envelope;
  for (const call of injectionCalls) {
    assert.equal(argValue(call.options.argv, '--allowedTools'), '');
    assertNoToolEnvelope(call.envelope, 'injection score');
  }
  assert.equal(Array.isArray(injectionEnvelope.permission_denials), true);

  const injectionOutput = JSON.stringify(injectionEnvelope.structured_output);
  assert.equal(SECRET_PATTERN.test(injectionOutput), false);
  const secretValues = [
    'ANTHROPIC_API_KEY',
    'BLOB_READ_WRITE_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'DATABASE_URL',
    'GREENHOUSE_API_KEY',
    'ROSIE_AUTH_SECRET',
  ]
    .map((name) => process.env[name])
    .filter((value): value is string => Boolean(value && value.length >= 8));
  assert.equal(
    secretValues.some((value) => injectionOutput.includes(value)),
    false,
    'injection output contained a configured secret value'
  );

  const totalCost = captured.reduce(
    (sum, { envelope }) =>
      sum +
      (typeof envelope.total_cost_usd === 'number'
        ? envelope.total_cost_usd
        : 0),
    0
  );
  console.log(
    `[smoke-claude-provider] passed calls=${captured.length} total_cost_usd=${totalCost.toFixed(
      6
    )} injection_permission_denials=${
      (injectionEnvelope.permission_denials as unknown[]).length
    }`
  );
}

main().catch((error) => {
  console.error('[smoke-claude-provider] failed:', error);
  process.exitCode = 1;
});
