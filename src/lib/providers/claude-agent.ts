import { writeFile } from 'node:fs/promises';
import {
  finalizeScoreResult,
  finalizeTriageResult,
  type ScoreMessageInput,
  type ScoringResponse,
  type TriageMessageInput,
} from '../anthropic';
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
} from '../prompt-texts';
import { ValidationError, withRetry } from '../scoring-validation';
import { assessParseQuality, shouldUsePdfInput } from '../screening-logic';
import {
  assertNoCredentialLeak,
  buildMinimalEnv,
  runSubprocess,
  withTempDir,
  type SubprocessResult,
  type SubprocessRunner,
} from './subprocess';
import type {
  ScreeningProvider,
  StructuredJsonRequest,
} from './types';

const DEFAULT_TRIAGE_MODEL = 'claude-haiku-4-5';
const DEFAULT_FULL_MODEL = 'claude-sonnet-5';
const DEFAULT_TRIAGE_TIMEOUT_MS = 180_000;
const DEFAULT_SCORE_TIMEOUT_MS = 300_000;

interface ClaudeEnvelope {
  is_error?: unknown;
  structured_output?: unknown;
  total_cost_usd?: unknown;
  usage?: {
    input_tokens?: unknown;
    output_tokens?: unknown;
    cache_read_input_tokens?: unknown;
    [key: string]: unknown;
  };
  num_turns?: unknown;
  permission_denials?: unknown;
}

interface ClaudeOutput {
  structuredOutput: unknown;
  usage: ClaudeEnvelope['usage'];
}

function timeoutFromEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function stderrTail(stderr: string): string {
  return stderr.trim().slice(-500);
}

// `--output-format json` returns a single result object for most flag
// combinations, but with `--setting-sources ""` the CLI emits a JSON ARRAY of
// messages (system/init, rate_limit_event, assistant, result) with the result
// last. Verified on claude 2.1.220. Coercing an array to {} would fail the
// is_error gate on every call and burn all withRetry attempts, so normalize
// both shapes here.
export function normalizeEnvelope(parsed: unknown): ClaudeEnvelope {
  if (Array.isArray(parsed)) {
    const entries = parsed.filter(
      (entry): entry is ClaudeEnvelope & { type?: unknown } =>
        Boolean(entry) && typeof entry === 'object'
    );
    const result = [...entries]
      .reverse()
      .find((entry) => entry.type === 'result');
    return result || entries[entries.length - 1] || {};
  }

  return parsed && typeof parsed === 'object' ? (parsed as ClaudeEnvelope) : {};
}

function parseEnvelope(
  call: SubprocessResult,
  label: string,
  candidateId?: string
): ClaudeOutput {
  if (call.exitCode !== 0) {
    const tail = stderrTail(call.stderr);
    throw new Error(
      `[${label}] claude exited with code ${call.exitCode}${tail ? `: ${tail}` : ''}`
    );
  }

  const parsed = JSON.parse(call.stdout) as unknown;
  const envelope = normalizeEnvelope(parsed);
  const usage = envelope.usage || {};
  console.log(
    `[${label}] candidate_id=${candidateId || 'n/a'} total_cost_usd=${
      typeof envelope.total_cost_usd === 'number' ? envelope.total_cost_usd : 0
    } input_tokens=${
      typeof usage.input_tokens === 'number' ? usage.input_tokens : 0
    } output_tokens=${
      typeof usage.output_tokens === 'number' ? usage.output_tokens : 0
    } cache_read_input_tokens=${
      typeof usage.cache_read_input_tokens === 'number'
        ? usage.cache_read_input_tokens
        : 0
    } num_turns=${
      typeof envelope.num_turns === 'number' ? envelope.num_turns : 0
    }`
  );

  if (envelope.is_error !== false || envelope.structured_output == null) {
    throw new ValidationError(
      `[${label}] Claude CLI returned an error or no structured_output`
    );
  }

  const serialized = JSON.stringify(envelope.structured_output);
  try {
    assertNoCredentialLeak(serialized, label);
  } catch (error) {
    console.error(
      `[${label}] credential-like output blocked candidate_id=${candidateId || 'n/a'}`
    );
    throw error;
  }

  return {
    structuredOutput: envelope.structured_output,
    usage: envelope.usage,
  };
}

export function createClaudeAgentProvider(
  runner: SubprocessRunner = runSubprocess
): ScreeningProvider {
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!token?.trim()) {
    throw new Error(
      'CLAUDE_CODE_OAUTH_TOKEN is required for the claude-agent provider'
    );
  }

  const models = {
    triage:
      process.env.ROSIE_CLAUDE_TRIAGE_MODEL?.trim() || DEFAULT_TRIAGE_MODEL,
    full: process.env.ROSIE_CLAUDE_FULL_MODEL?.trim() || DEFAULT_FULL_MODEL,
  };
  const timeouts = {
    triage: timeoutFromEnv(
      'ROSIE_AGENT_TIMEOUT_TRIAGE_MS',
      DEFAULT_TRIAGE_TIMEOUT_MS
    ),
    score: timeoutFromEnv(
      'ROSIE_AGENT_TIMEOUT_SCORE_MS',
      DEFAULT_SCORE_TIMEOUT_MS
    ),
  };
  const env = buildMinimalEnv({ CLAUDE_CODE_OAUTH_TOKEN: token });

  async function invoke({
    label,
    candidateId,
    system,
    userBlocks,
    schema,
    model,
    timeoutMs,
    pdfBase64,
  }: {
    label: string;
    candidateId?: string;
    system: string;
    userBlocks: string[];
    schema: Record<string, unknown>;
    model: string;
    timeoutMs: number;
    pdfBase64?: string;
  }): Promise<ClaudeOutput> {
    return withTempDir(async (cwd) => {
      if (pdfBase64) {
        await writeFile(`${cwd}/resume.pdf`, Buffer.from(pdfBase64, 'base64'));
      }
      const toolArgs = pdfBase64
        ? ['--allowedTools', 'Read']
        : ['--allowedTools', ''];
      const result = await runner({
        argv: [
          'claude',
          '-p',
          '--output-format',
          'json',
          '--json-schema',
          JSON.stringify(sanitizeSchemaForAnthropic(schema)),
          '--model',
          model,
          '--system-prompt',
          system,
          '--no-session-persistence',
          '--strict-mcp-config',
          '--setting-sources',
          '',
          ...toolArgs,
        ],
        stdin: userBlocks.join('\n\n'),
        cwd,
        env,
        timeoutMs,
      });
      return parseEnvelope(result, label, candidateId);
    });
  }

  return {
    name: 'claude-agent',
    supportsBatch: false,
    supportsPdf: true,
    models,
    triage(input: TriageMessageInput) {
      return withRetry(async () => {
        const output = await invoke({
          label: 'claudeAgentTriage',
          candidateId: input.candidateId,
          system: buildTriageSystemText(input.rubric, input.idealPatterns),
          userBlocks: [
            buildTriageResumeBlock(input.resumeText),
            buildTriageInstructionBlock(input.candidateName),
          ],
          schema: triageSchema,
          model: models.triage,
          timeoutMs: timeouts.triage,
        });
        return finalizeTriageResult(
          JSON.stringify(output.structuredOutput),
          input.candidateName
        );
      }, `claudeAgentTriage:${input.candidateId}`);
    },
    score(input: ScoreMessageInput) {
      return withRetry(async () => {
        const parseQuality =
          input.parseQuality ??
          assessParseQuality(input.resumeText, input.resumeBase64);
        const preferredBucket =
          input.preferredBucket ??
          (input.useFileInput ? 'top_signal' : undefined);
        const usePdf = shouldUsePdfInput(
          parseQuality,
          input.resumeMimeType === 'application/pdf',
          Boolean(input.resumeBase64),
          preferredBucket
        );
        const output = await invoke({
          label: 'claudeAgentScore',
          candidateId: input.candidateId,
          system: buildScoreSystemText(input.rubric, input.idealPatterns),
          userBlocks: [
            usePdf
              ? buildScoreResumePdfBlock('resume.pdf')
              : buildScoreResumeTextBlock(input.resumeText),
            buildScoreInstructionBlock(input.candidateName),
          ],
          schema: scoringResultSchema,
          model: input.model || models.full,
          timeoutMs: timeouts.score,
          pdfBase64: usePdf ? input.resumeBase64 || undefined : undefined,
        });
        const result = finalizeScoreResult(
          JSON.stringify(output.structuredOutput),
          input.rubric,
          input.candidateName
        );
        return {
          ...result,
          usage: (output.usage || {
            input_tokens: 0,
            output_tokens: 0,
          }) as unknown as ScoringResponse['usage'],
        };
      }, `claudeAgentScore:${input.candidateId}`);
    },
    async requestJSON<T>(req: StructuredJsonRequest): Promise<T> {
      const output = await invoke({
        label: req.label,
        system: req.system,
        userBlocks: req.userBlocks,
        schema: req.schema,
        model: req.model || models[req.tier],
        timeoutMs: timeouts.score,
      });
      return output.structuredOutput as T;
    },
  };
}
