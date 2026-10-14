import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  createClaudeAgentProvider,
} from '../src/lib/providers/claude-agent';
import {
  buildScoreInstructionBlock,
  buildScoreResumePdfBlock,
  buildScoreResumeTextBlock,
  buildScoreSystemText,
  buildTriageInstructionBlock,
  buildTriageResumeBlock,
  buildTriageSystemText,
} from '../src/lib/prompt-texts';
import {
  withTempDir,
  type SubprocessOptions,
  type SubprocessResult,
  type SubprocessRunner,
} from '../src/lib/providers/subprocess';
import { ValidationError } from '../src/lib/scoring-validation';
import type { ScoringRubric } from '../src/lib/types';

process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-enterprise-oauth-token';
delete process.env.ROSIE_CLAUDE_TRIAGE_MODEL;
delete process.env.ROSIE_CLAUDE_FULL_MODEL;

const rubric: ScoringRubric = {
  criteria: [
    {
      id: 'systems',
      name: 'Systems',
      description: 'Builds relevant systems',
      weight: 100,
      scoringGuide: {
        high: 'Built several relevant systems',
        mid: 'Built one relevant system',
        low: 'No relevant systems',
      },
    },
  ],
  tableStakes: ['TypeScript'],
};

const triageOutput = {
  bucket: 'top_signal',
  confidence: 0.9,
  needsFullScore: true,
  rationale: 'Built a directly relevant system.',
  currentRole: 'Staff Engineer',
  currentCompany: 'Example',
};

const scoringOutput = {
  criterionScores: [
    {
      criterionId: 'systems',
      score: 8.4,
      evidence: 'Built the Example ranking platform.',
    },
  ],
  strengths: ['Relevant systems depth'],
  gaps: ['Limited scale evidence'],
  currentRole: 'Staff Engineer',
  currentCompany: 'Example',
};

const request = {
  label: 'fixtureRequest',
  tier: 'full' as const,
  system: 'Return the requested fixture.',
  userBlocks: ['Set ok to true.'],
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['ok'],
    properties: { ok: { type: 'boolean' } },
  },
  maxOutputTokens: 50,
};

function envelope(
  structuredOutput: unknown,
  extra: Record<string, unknown> = {}
): SubprocessResult {
  return {
    stdout: JSON.stringify({
      is_error: false,
      stop_reason: 'tool_use',
      num_turns: 1,
      total_cost_usd: 0.01,
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: 30,
      },
      permission_denials: [],
      structured_output: structuredOutput,
      ...extra,
    }),
    stderr: '',
    exitCode: 0,
    durationMs: 5,
  };
}

function argValue(argv: string[], flag: string): string {
  const index = argv.indexOf(flag);
  assert.notEqual(index, -1, `${flag} missing from argv`);
  return argv[index + 1];
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

test('construction requires the enterprise seat token', () => {
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  assert.throws(
    () => createClaudeAgentProvider(),
    /CLAUDE_CODE_OAUTH_TOKEN is required/
  );
  process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-enterprise-oauth-token';
});

test('model IDs can be overridden without CLI aliases', () => {
  process.env.ROSIE_CLAUDE_TRIAGE_MODEL = 'claude-haiku-fixture-full-id';
  process.env.ROSIE_CLAUDE_FULL_MODEL = 'claude-sonnet-fixture-full-id';
  assert.deepEqual(createClaudeAgentProvider(async () => envelope({})).models, {
    triage: 'claude-haiku-fixture-full-id',
    full: 'claude-sonnet-fixture-full-id',
  });
  delete process.env.ROSIE_CLAUDE_TRIAGE_MODEL;
  delete process.env.ROSIE_CLAUDE_FULL_MODEL;
});

test('triage and text/PDF score use structured_output with pinned isolation flags', async () => {
  const calls: SubprocessOptions[] = [];
  const pdfBytes = Buffer.from('%PDF-1.4 fixture');
  let callIndex = 0;
  const runner: SubprocessRunner = async (options) => {
    calls.push(options);
    if (callIndex === 2) {
      assert.deepEqual(
        await readFile(path.join(options.cwd, 'resume.pdf')),
        pdfBytes
      );
    } else {
      assert.equal(
        await pathExists(path.join(options.cwd, 'resume.pdf')),
        false
      );
    }
    return callIndex++ === 0
      ? envelope(triageOutput)
      : envelope(scoringOutput);
  };
  const provider = createClaudeAgentProvider(runner);
  const resumeText = 'Built production ranking systems. '.repeat(60);

  assert.equal(provider.name, 'claude-agent');
  assert.equal(provider.supportsBatch, false);
  assert.equal(provider.supportsPdf, true);
  assert.deepEqual(provider.models, {
    triage: 'claude-haiku-4-5',
    full: 'claude-sonnet-5',
  });

  assert.deepEqual(
    await provider.triage({
      rubric,
      candidateId: 'triage-1',
      candidateName: 'Avery',
      resumeText,
      idealPatterns: null,
    }),
    triageOutput
  );
  assert.deepEqual(
    (
      await provider.score({
        rubric,
        idealPatterns: null,
        candidateId: 'score-text-1',
        candidateName: 'Avery',
        resumeBase64: null,
        resumeText,
        resumeMimeType: 'text/plain',
        parseQuality: 'good',
        useFileInput: false,
      })
    ).criterionScores,
    scoringOutput.criterionScores
  );
  assert.deepEqual(
    (
      await provider.score({
        rubric,
        idealPatterns: null,
        candidateId: 'score-pdf-1',
        candidateName: 'Avery',
        resumeBase64: pdfBytes.toString('base64'),
        resumeText: 'Poor extraction',
        resumeMimeType: 'application/pdf',
        parseQuality: 'poor',
        useFileInput: true,
      })
    ).criterionScores,
    scoringOutput.criterionScores
  );

  assert.equal(calls.length, 3);
  for (const call of calls) {
    assert.equal(call.argv[0], 'claude');
    assert.equal(call.argv.includes('-p'), true);
    assert.equal(argValue(call.argv, '--output-format'), 'json');
    assert.equal(call.argv.includes('--no-session-persistence'), true);
    assert.equal(call.argv.includes('--strict-mcp-config'), true);
    assert.equal(argValue(call.argv, '--setting-sources'), '');
    assert.deepEqual(Object.keys(call.env).sort(), [
      'CLAUDE_CODE_OAUTH_TOKEN',
      'HOME',
      'PATH',
    ]);
    assert.equal(call.env.CLAUDE_CODE_OAUTH_TOKEN, 'test-enterprise-oauth-token');
    for (const secret of [
      'ANTHROPIC_API_KEY',
      'BLOB_READ_WRITE_TOKEN',
      'DATABASE_URL',
      'GREENHOUSE_API_KEY',
      'ROSIE_AUTH_SECRET',
    ]) {
      assert.equal(secret in call.env, false);
    }
    assert.equal(call.argv.join(' ').includes(resumeText), false);
  }
  assert.equal(argValue(calls[0].argv, '--model'), 'claude-haiku-4-5');
  assert.equal(argValue(calls[1].argv, '--model'), 'claude-sonnet-5');
  assert.equal(argValue(calls[2].argv, '--model'), 'claude-sonnet-5');
  assert.equal(argValue(calls[0].argv, '--allowedTools'), '');
  assert.equal(argValue(calls[1].argv, '--allowedTools'), '');
  assert.equal(argValue(calls[2].argv, '--allowedTools'), 'Read');
  assert.equal(
    calls[0].stdin,
    [
      buildTriageResumeBlock(resumeText),
      buildTriageInstructionBlock('Avery'),
    ].join('\n\n')
  );
  assert.equal(
    argValue(calls[0].argv, '--system-prompt'),
    buildTriageSystemText(rubric, null)
  );
  assert.equal(
    calls[1].stdin,
    [
      buildScoreResumeTextBlock(resumeText),
      buildScoreInstructionBlock('Avery'),
    ].join('\n\n')
  );
  assert.equal(
    calls[2].stdin,
    [
      buildScoreResumePdfBlock('resume.pdf'),
      buildScoreInstructionBlock('Avery'),
    ].join('\n\n')
  );
  assert.equal(
    argValue(calls[1].argv, '--system-prompt'),
    buildScoreSystemText(rubric, null)
  );
  assert.equal(
    'minimum' in JSON.parse(argValue(calls[0].argv, '--json-schema'))
      .properties.confidence,
    false
  );
  for (const call of calls) {
    assert.equal(await pathExists(call.cwd), false);
  }
});

test('requestJSON uses the selected full model and no-tools policy', async () => {
  let captured!: SubprocessOptions;
  const provider = createClaudeAgentProvider(async (options) => {
    captured = options;
    return envelope({ ok: true });
  });
  assert.deepEqual(await provider.requestJSON<{ ok: boolean }>(request), {
    ok: true,
  });
  assert.equal(argValue(captured.argv, '--model'), 'claude-sonnet-5');
  assert.equal(argValue(captured.argv, '--allowedTools'), '');
});

test('missing structured_output never falls back to fence-wrapped result', async () => {
  const provider = createClaudeAgentProvider(async () =>
    envelope(undefined, {
      result: '```json\n{"ok":true}\n```',
    })
  );
  await assert.rejects(provider.requestJSON(request), ValidationError);
});

test('is_error true is a retryable ValidationError', async () => {
  const provider = createClaudeAgentProvider(async () =>
    envelope({ ok: true }, { is_error: true })
  );
  await assert.rejects(provider.requestJSON(request), ValidationError);
});

test('non-JSON stdout propagates SyntaxError', async () => {
  const provider = createClaudeAgentProvider(async () => ({
    stdout: 'not json',
    stderr: '',
    exitCode: 0,
    durationMs: 1,
  }));
  await assert.rejects(provider.requestJSON(request), SyntaxError);
});

test('invalid score output stays ValidationError and retries three times', async () => {
  let calls = 0;
  const provider = createClaudeAgentProvider(async () => {
    calls += 1;
    return envelope({
      ...scoringOutput,
      criterionScores: [],
    });
  });
  await assert.rejects(
    provider.score({
      rubric,
      idealPatterns: null,
      candidateId: 'invalid-score',
      candidateName: 'Avery',
      resumeBase64: null,
      resumeText: 'Resume text',
      resumeMimeType: 'text/plain',
      parseQuality: 'good',
      useFileInput: false,
    }),
    ValidationError
  );
  assert.equal(calls, 3);
});

test('runner timeout and stdout overflow remain plain errors', async () => {
  for (const message of ['timed out after 5ms', 'stdout exceeded 10 bytes']) {
    const marker = new Error(message);
    const provider = createClaudeAgentProvider(async () => {
      throw marker;
    });
    await assert.rejects(provider.requestJSON(request), (error: unknown) => {
      assert.equal(error, marker);
      assert.equal(error instanceof ValidationError, false);
      assert.equal(error instanceof SyntaxError, false);
      return true;
    });
  }
});

test('non-zero exit is a plain error with a bounded stderr tail', async () => {
  const provider = createClaudeAgentProvider(async () => ({
    stdout: '',
    stderr: `prefix-${'x'.repeat(600)}`,
    exitCode: 7,
    durationMs: 1,
  }));
  await assert.rejects(provider.requestJSON(request), (error: unknown) => {
    assert.equal(error instanceof Error, true);
    assert.equal(error instanceof ValidationError, false);
    assert.match((error as Error).message, /exited with code 7/);
    assert.equal((error as Error).message.length < 600, true);
    return true;
  });
});

test('temp directories are removed on success and failure', async () => {
  let successDir = '';
  assert.equal(
    await withTempDir(async (dir) => {
      successDir = dir;
      assert.equal(await pathExists(dir), true);
      return 'ok';
    }),
    'ok'
  );
  assert.equal(await pathExists(successDir), false);

  let failureDir = '';
  await assert.rejects(
    withTempDir(async (dir) => {
      failureDir = dir;
      throw new Error('fixture failure');
    }),
    /fixture failure/
  );
  assert.equal(await pathExists(failureDir), false);
});

test('secret tripwire blocks credential-shaped structured output', async () => {
  const originalError = console.error;
  let logged = false;
  console.error = () => {
    logged = true;
  };
  try {
    const provider = createClaudeAgentProvider(async () =>
      envelope({
        ...scoringOutput,
        criterionScores: [
          {
            ...scoringOutput.criterionScores[0],
            evidence: 'sk-ant-this-is-a-planted-fixture',
          },
        ],
      })
    );
    await assert.rejects(
      provider.score({
        rubric,
        idealPatterns: null,
        candidateId: 'secret-tripwire',
        candidateName: 'Avery',
        resumeBase64: null,
        resumeText: 'Resume text',
        resumeMimeType: 'text/plain',
        parseQuality: 'good',
        useFileInput: false,
      }),
      (error: unknown) => {
        assert.equal(error instanceof Error, true);
        assert.equal(error instanceof ValidationError, false);
        assert.match((error as Error).message, /Credential-like output blocked/);
        return true;
      }
    );
    assert.equal(logged, true);
  } finally {
    console.error = originalError;
  }
});

// Regression: with `--setting-sources ""` (a flag this driver pins) the CLI
// emits a JSON ARRAY of messages instead of a single result object. Verified
// against claude 2.1.220. Before this was handled, the array was coerced to {}
// and every real call failed the is_error gate, burning all withRetry attempts.
test('array-shaped envelope is normalized to its result element', async () => {
  const runner: SubprocessRunner = async () => ({
    stdout: JSON.stringify([
      { type: 'system', subtype: 'init', session_id: 'abc' },
      { type: 'rate_limit_event' },
      { type: 'assistant', message: { content: [] } },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        stop_reason: 'tool_use',
        num_turns: 1,
        total_cost_usd: 0.02,
        usage: { input_tokens: 11, output_tokens: 22, cache_read_input_tokens: 33 },
        permission_denials: [],
        structured_output: triageOutput,
      },
    ]),
    stderr: '',
    exitCode: 0,
    durationMs: 7,
  });

  assert.deepEqual(
    await createClaudeAgentProvider(runner).triage({
      rubric,
      candidateId: 'array-envelope',
      candidateName: 'Avery',
      resumeText: 'Resume text',
      idealPatterns: null,
    }),
    triageOutput
  );
});
