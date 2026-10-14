import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { access, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { createCodexAgentProvider } from '../src/lib/providers/codex-agent';
import {
  buildScoreInstructionBlock,
  buildScoreResumePdfBlock,
  buildScoreResumeTextBlock,
  buildScoreSystemText,
  buildTriageInstructionBlock,
  buildTriageResumeBlock,
  buildTriageSystemText,
  sanitizeSchemaForAnthropic,
  scoringResultSchema,
  triageSchema,
} from '../src/lib/prompt-texts';
import {
  type SubprocessOptions,
  type SubprocessResult,
  type SubprocessRunner,
} from '../src/lib/providers/subprocess';
import { ValidationError } from '../src/lib/scoring-validation';
import type { ScoringRubric } from '../src/lib/types';

const originalEnv = {
  PATH: process.env.PATH,
  ROSIE_CODEX_HOME: process.env.ROSIE_CODEX_HOME,
  ROSIE_CODEX_TRIAGE_MODEL: process.env.ROSIE_CODEX_TRIAGE_MODEL,
  ROSIE_CODEX_FULL_MODEL: process.env.ROSIE_CODEX_FULL_MODEL,
};
const fakeBinDir = mkdtempSync(path.join(tmpdir(), 'rosie-codex-bin-'));
const fakePdftoppm = path.join(fakeBinDir, 'pdftoppm');
writeFileSync(fakePdftoppm, '');
chmodSync(fakePdftoppm, 0o755);
process.env.PATH = `${fakeBinDir}${path.delimiter}${process.env.PATH || ''}`;
process.env.ROSIE_CODEX_HOME = '/tmp/rosie-codex-fixture-home';
process.env.ROSIE_CODEX_TRIAGE_MODEL = 'codex-triage-fixture';
process.env.ROSIE_CODEX_FULL_MODEL = 'codex-full-fixture';

after(() => {
  rmSync(fakeBinDir, { recursive: true, force: true });
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

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

function subprocessResult(
  overrides: Partial<SubprocessResult> = {}
): SubprocessResult {
  return {
    stdout: '',
    stderr: '',
    exitCode: 0,
    durationMs: 5,
    ...overrides,
  };
}

function argValue(argv: string[], flag: string): string {
  const index = argv.indexOf(flag);
  assert.notEqual(index, -1, `${flag} missing from argv`);
  return argv[index + 1];
}

function argValues(argv: string[], flag: string): string[] {
  return argv.flatMap((value, index) =>
    value === flag ? [argv[index + 1]] : []
  );
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeLastMessage(
  options: SubprocessOptions,
  output: unknown,
  raw = false
): Promise<void> {
  await writeFile(
    argValue(options.argv, '--output-last-message'),
    raw ? String(output) : JSON.stringify(output)
  );
}

function scoreInput(overrides: Record<string, unknown> = {}) {
  return {
    rubric,
    idealPatterns: null,
    candidateId: 'score-fixture',
    candidateName: 'Avery',
    resumeBase64: null,
    resumeText: 'Built production ranking systems.',
    resumeMimeType: 'text/plain',
    parseQuality: 'good' as const,
    useFileInput: false,
    ...overrides,
  };
}

function createWithMissingPdftoppm(runner: SubprocessRunner) {
  const savedPath = process.env.PATH;
  process.env.PATH = '';
  try {
    return createCodexAgentProvider(runner);
  } finally {
    process.env.PATH = savedPath;
  }
}

test('construction requires both configured model IDs', () => {
  const triageModel = process.env.ROSIE_CODEX_TRIAGE_MODEL;
  const fullModel = process.env.ROSIE_CODEX_FULL_MODEL;
  delete process.env.ROSIE_CODEX_TRIAGE_MODEL;
  assert.throws(
    () => createCodexAgentProvider(),
    /ROSIE_CODEX_TRIAGE_MODEL is required/
  );
  process.env.ROSIE_CODEX_TRIAGE_MODEL = triageModel;
  delete process.env.ROSIE_CODEX_FULL_MODEL;
  assert.throws(
    () => createCodexAgentProvider(),
    /ROSIE_CODEX_FULL_MODEL is required/
  );
  process.env.ROSIE_CODEX_FULL_MODEL = fullModel;
});

test('triage and text/PDF score use pinned argv, sanitized schemas, and minimal env', async () => {
  const calls: SubprocessOptions[] = [];
  const schemas: unknown[] = [];
  const pdfBytes = Buffer.from('%PDF-1.4 fixture');
  let codexCall = 0;
  const runner: SubprocessRunner = async (options) => {
    calls.push(options);
    if (options.argv[0] === 'pdftoppm') {
      assert.deepEqual(
        await readFile(path.join(options.cwd, 'resume.pdf')),
        pdfBytes
      );
      await writeFile(path.join(options.cwd, 'page-2.png'), 'page two');
      await writeFile(path.join(options.cwd, 'page-1.png'), 'page one');
      return subprocessResult({ durationMs: 3 });
    }

    schemas.push(
      JSON.parse(
        await readFile(argValue(options.argv, '--output-schema'), 'utf8')
      )
    );
    await writeLastMessage(
      options,
      codexCall++ === 0 ? triageOutput : scoringOutput
    );
    return subprocessResult();
  };
  const provider = createCodexAgentProvider(runner);
  const resumeText = 'Built production ranking systems. '.repeat(60);

  assert.equal(provider.name, 'codex-agent');
  assert.equal(provider.supportsBatch, false);
  assert.equal(provider.supportsPdf, true);
  assert.deepEqual(provider.models, {
    triage: 'codex-triage-fixture',
    full: 'codex-full-fixture',
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
      await provider.score(
        scoreInput({
          candidateId: 'score-text-1',
          resumeText,
        })
      )
    ).criterionScores,
    scoringOutput.criterionScores
  );
  assert.deepEqual(
    (
      await provider.score(
        scoreInput({
          candidateId: 'score-pdf-1',
          resumeBase64: pdfBytes.toString('base64'),
          resumeText: 'Poor extraction',
          resumeMimeType: 'application/pdf',
          parseQuality: 'poor',
          useFileInput: true,
        })
      )
    ).criterionScores,
    scoringOutput.criterionScores
  );

  assert.equal(calls.length, 4);
  const rasterCall = calls[2];
  const codexCalls = [calls[0], calls[1], calls[3]];
  assert.deepEqual(rasterCall.argv, [
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
  assert.equal(rasterCall.timeoutMs, 30_000);

  for (const call of calls) {
    assert.deepEqual(Object.keys(call.env).sort(), [
      'CODEX_HOME',
      'HOME',
      'PATH',
    ]);
    assert.equal(call.env.CODEX_HOME, '/tmp/rosie-codex-fixture-home');
    assert.equal(call.env.HOME, call.cwd);
    for (const secret of [
      'ANTHROPIC_API_KEY',
      'BLOB_READ_WRITE_TOKEN',
      'CLAUDE_CODE_OAUTH_TOKEN',
      'DATABASE_URL',
      'GREENHOUSE_API_KEY',
      'ROSIE_AUTH_SECRET',
    ]) {
      assert.equal(secret in call.env, false);
    }
  }

  for (const call of codexCalls) {
    assert.deepEqual(call.argv.slice(0, 9), [
      'codex',
      'exec',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--ephemeral',
      // Isolation parity with the claude arm: no user config is loaded.
      '--ignore-user-config',
      '-C',
      call.cwd,
    ]);
    assert.equal(
      argValue(call.argv, '--output-schema'),
      path.join(call.cwd, 'schema.json')
    );
    assert.equal(
      argValue(call.argv, '--output-last-message'),
      path.join(call.cwd, 'last-message.json')
    );
    assert.equal(call.argv.at(-1), '-');
    assert.equal(call.argv.join(' ').includes(resumeText), false);
  }
  assert.equal(argValue(codexCalls[0].argv, '-m'), 'codex-triage-fixture');
  assert.equal(argValue(codexCalls[1].argv, '-m'), 'codex-full-fixture');
  assert.equal(argValue(codexCalls[2].argv, '-m'), 'codex-full-fixture');
  assert.deepEqual(argValues(codexCalls[0].argv, '-i'), []);
  assert.deepEqual(argValues(codexCalls[1].argv, '-i'), []);
  assert.deepEqual(argValues(codexCalls[2].argv, '-i'), [
    path.join(codexCalls[2].cwd, 'page-1.png'),
    path.join(codexCalls[2].cwd, 'page-2.png'),
  ]);
  assert.equal(
    codexCalls[0].stdin,
    [
      buildTriageSystemText(rubric, null),
      buildTriageResumeBlock(resumeText),
      buildTriageInstructionBlock('Avery'),
    ].join('\n\n')
  );
  assert.equal(
    codexCalls[1].stdin,
    [
      buildScoreSystemText(rubric, null),
      buildScoreResumeTextBlock(resumeText),
      buildScoreInstructionBlock('Avery'),
    ].join('\n\n')
  );
  assert.equal(
    codexCalls[2].stdin,
    [
      buildScoreSystemText(rubric, null),
      buildScoreResumePdfBlock('the attached page images'),
      buildScoreInstructionBlock('Avery'),
    ].join('\n\n')
  );
  assert.deepEqual(schemas, [
    sanitizeSchemaForAnthropic(triageSchema),
    sanitizeSchemaForAnthropic(scoringResultSchema),
    sanitizeSchemaForAnthropic(scoringResultSchema),
  ]);
  assert.equal(
    'minimum' in
      (
        schemas[0] as {
          properties: { confidence: Record<string, unknown> };
        }
      ).properties.confidence,
    false
  );
  for (const cwd of new Set(calls.map((call) => call.cwd))) {
    assert.equal(await pathExists(cwd), false);
  }
});

test('requestJSON uses the model selected by tier', async () => {
  const calls: SubprocessOptions[] = [];
  const provider = createCodexAgentProvider(async (options) => {
    calls.push(options);
    await writeLastMessage(options, { ok: true });
    return subprocessResult();
  });

  assert.deepEqual(await provider.requestJSON<{ ok: boolean }>(request), {
    ok: true,
  });
  assert.deepEqual(
    await provider.requestJSON<{ ok: boolean }>({
      ...request,
      tier: 'triage',
    }),
    { ok: true }
  );
  assert.equal(argValue(calls[0].argv, '-m'), 'codex-full-fixture');
  assert.equal(argValue(calls[1].argv, '-m'), 'codex-triage-fixture');
});

test('missing and empty last-message files are ValidationErrors and clean temp dirs', async () => {
  for (const empty of [false, true]) {
    let cwd = '';
    const provider = createCodexAgentProvider(async (options) => {
      cwd = options.cwd;
      if (empty) await writeLastMessage(options, '', true);
      return subprocessResult();
    });
    await assert.rejects(provider.requestJSON(request), ValidationError);
    assert.equal(await pathExists(cwd), false);
  }
});

test('malformed last-message JSON propagates SyntaxError', async () => {
  const provider = createCodexAgentProvider(async (options) => {
    await writeLastMessage(options, 'not json', true);
    return subprocessResult();
  });
  await assert.rejects(provider.requestJSON(request), SyntaxError);
});

test('fenced JSON is accepted only as the documented defensive fallback', async () => {
  const provider = createCodexAgentProvider(async (options) => {
    await writeLastMessage(options, '```json\n{"ok":true}\n```', true);
    return subprocessResult();
  });
  assert.deepEqual(await provider.requestJSON(request), { ok: true });
});

test('non-zero codex exit is a bounded plain Error', async () => {
  const provider = createCodexAgentProvider(async () =>
    subprocessResult({
      stderr: `prefix-${'x'.repeat(600)}`,
      exitCode: 7,
    })
  );
  await assert.rejects(provider.requestJSON(request), (error: unknown) => {
    assert.equal(error instanceof Error, true);
    assert.equal(error instanceof ValidationError, false);
    assert.match((error as Error).message, /codex exited with code 7/);
    assert.equal((error as Error).message.length < 600, true);
    return true;
  });
});

test('spawn, timeout, and overflow errors propagate without wrapping', async () => {
  for (const message of [
    'Failed to spawn codex',
    'codex timed out after 5ms',
    'codex stdout exceeded 10 bytes',
  ]) {
    const marker = new Error(message);
    const provider = createCodexAgentProvider(async () => {
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

test('schema-invalid score remains ValidationError and retries three times', async () => {
  let calls = 0;
  const provider = createCodexAgentProvider(async (options) => {
    calls += 1;
    await writeLastMessage(options, {
      ...scoringOutput,
      criterionScores: [],
    });
    return subprocessResult();
  });
  await assert.rejects(
    provider.score(scoreInput({ candidateId: 'invalid-score' })),
    ValidationError
  );
  assert.equal(calls, 3);
});

test('rasterization failure logs a downgrade and uses extracted text', async () => {
  const calls: SubprocessOptions[] = [];
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...values: unknown[]) => {
    warnings.push(values.map(String).join(' '));
  };
  try {
    const provider = createCodexAgentProvider(async (options) => {
      calls.push(options);
      if (options.argv[0] === 'pdftoppm') {
        return subprocessResult({ exitCode: 2, stderr: 'fixture failure' });
      }
      await writeLastMessage(options, scoringOutput);
      return subprocessResult();
    });
    await provider.score(
      scoreInput({
        resumeBase64: Buffer.from('%PDF fixture').toString('base64'),
        resumeText: 'Extracted fallback text',
        resumeMimeType: 'application/pdf',
        parseQuality: 'poor',
        useFileInput: true,
      })
    );
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(calls.length, 2);
  assert.equal(calls[0].argv[0], 'pdftoppm');
  assert.equal(calls[1].argv[0], 'codex');
  assert.deepEqual(argValues(calls[1].argv, '-i'), []);
  assert.equal(
    calls[1].stdin,
    [
      buildScoreSystemText(rubric, null),
      buildScoreResumeTextBlock('Extracted fallback text'),
      buildScoreInstructionBlock('Avery'),
    ].join('\n\n')
  );
  assert.equal(
    warnings.some((line) => line.includes('pdf_downgrade=rasterization_failed')),
    true
  );
});

test('rasterization failure without text is a plain actionable Error', async () => {
  let calls = 0;
  let cwd = '';
  const provider = createCodexAgentProvider(async (options) => {
    calls += 1;
    cwd = options.cwd;
    return subprocessResult({ exitCode: 2, stderr: 'fixture failure' });
  });
  await assert.rejects(
    provider.score(
      scoreInput({
        resumeBase64: Buffer.from('%PDF fixture').toString('base64'),
        resumeText: null,
        resumeMimeType: 'application/pdf',
        parseQuality: 'poor',
        useFileInput: true,
      })
    ),
    (error: unknown) => {
      assert.equal(error instanceof Error, true);
      assert.equal(error instanceof ValidationError, false);
      assert.match((error as Error).message, /pdftoppm/);
      return true;
    }
  );
  assert.equal(calls, 1);
  assert.equal(await pathExists(cwd), false);
});

test('missing pdftoppm downgrades with text and fails without it', async () => {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...values: unknown[]) => {
    warnings.push(values.map(String).join(' '));
  };
  try {
    let calls = 0;
    const runner: SubprocessRunner = async (options) => {
      calls += 1;
      assert.equal(options.argv[0], 'codex');
      await writeLastMessage(options, scoringOutput);
      return subprocessResult();
    };
    const provider = createWithMissingPdftoppm(runner);
    await provider.score(
      scoreInput({
        resumeBase64: Buffer.from('%PDF fixture').toString('base64'),
        resumeText: 'Extracted fallback text',
        resumeMimeType: 'application/pdf',
        parseQuality: 'poor',
        useFileInput: true,
      })
    );
    assert.equal(calls, 1);

    const noTextProvider = createWithMissingPdftoppm(runner);
    await assert.rejects(
      noTextProvider.score(
        scoreInput({
          resumeBase64: Buffer.from('%PDF fixture').toString('base64'),
          resumeText: null,
          resumeMimeType: 'application/pdf',
          parseQuality: 'poor',
          useFileInput: true,
        })
      ),
      /pdftoppm is required/
    );
    assert.equal(calls, 1);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(
    warnings.some((line) => line.includes('pdf_downgrade=pdftoppm_unavailable')),
    true
  );
});

test('shared secret tripwire blocks credential-shaped output', async () => {
  const originalError = console.error;
  let logged = false;
  console.error = () => {
    logged = true;
  };
  try {
    const provider = createCodexAgentProvider(async (options) => {
      await writeLastMessage(options, {
        ...scoringOutput,
        criterionScores: [
          {
            ...scoringOutput.criterionScores[0],
            evidence: 'sk-ant-this-is-a-planted-fixture',
          },
        ],
      });
      return subprocessResult();
    });
    await assert.rejects(
      provider.score(scoreInput({ candidateId: 'secret-tripwire' })),
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

// Reasoning effort is a per-tier config override, not a flag. Values are
// validated server-side (unknown levels and "minimal" both return HTTP 400 on
// gpt-5.6-sol), so a wrong level fails loudly — but a MISSING one would
// silently run at the CLI default, which is the failure this locks down.
test('per-tier reasoning effort is passed as a config override', async () => {
  process.env.ROSIE_CODEX_TRIAGE_EFFORT = 'low';
  process.env.ROSIE_CODEX_FULL_EFFORT = 'ultra';
  try {
    const calls: SubprocessOptions[] = [];
    const runner: SubprocessRunner = async (options) => {
      calls.push(options);
      const isTriage = options.argv.includes('codex-triage-fixture');
      await writeFile(
        path.join(options.cwd, 'last-message.json'),
        JSON.stringify(isTriage ? triageOutput : scoringOutput)
      );
      return { stdout: '', stderr: '', exitCode: 0, durationMs: 5 };
    };
    const provider = createCodexAgentProvider(runner);

    await provider.triage({
      rubric,
      candidateId: 'effort-triage',
      candidateName: 'Avery',
      resumeText: 'Resume text',
      idealPatterns: null,
    });
    await provider.score({
      rubric,
      idealPatterns: null,
      candidateId: 'effort-score',
      candidateName: 'Avery',
      resumeBase64: null,
      resumeText: 'Resume text',
      resumeMimeType: 'text/plain',
      parseQuality: 'good',
      useFileInput: false,
    });

    const efforts = calls.map((call) => {
      const index = call.argv.indexOf('-c');
      assert.notEqual(index, -1, 'effort config override missing from argv');
      return call.argv[index + 1];
    });
    assert.deepEqual(efforts, [
      'model_reasoning_effort="low"',
      'model_reasoning_effort="ultra"',
    ]);
  } finally {
    delete process.env.ROSIE_CODEX_TRIAGE_EFFORT;
    delete process.env.ROSIE_CODEX_FULL_EFFORT;
  }
});
