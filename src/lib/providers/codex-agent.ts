import { accessSync, constants } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
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

const DEFAULT_TRIAGE_TIMEOUT_MS = 180_000;
const DEFAULT_SCORE_TIMEOUT_MS = 300_000;
const PDF_RASTERIZE_TIMEOUT_MS = 30_000;
const MAX_PDF_PAGES = 5;

function timeoutFromEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function binaryExists(name: string): boolean {
  for (const dir of (process.env.PATH || '').split(delimiter).filter(Boolean)) {
    try {
      accessSync(join(dir, name), constants.X_OK);
      return true;
    } catch {
      // Keep searching PATH.
    }
  }
  return false;
}

function stderrTail(stderr: string): string {
  return stderr.trim().slice(-500);
}

function parseLastMessage(raw: string, label: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new ValidationError(
      `[${label}] Codex CLI returned an empty last-message file`
    );
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;

    // Defensive fallback only: `--output-schema` should produce bare JSON, but
    // accept a fenced/prose-wrapped object if a future CLI version regresses.
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    const candidate =
      fenced ||
      (firstBrace >= 0 && lastBrace > firstBrace
        ? trimmed.slice(firstBrace, lastBrace + 1)
        : null);
    if (!candidate) throw error;

    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      throw error;
    }
  }
}

async function readLastMessage(
  filePath: string,
  label: string
): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ValidationError(
        `[${label}] Codex CLI returned no last-message file`
      );
    }
    throw error;
  }
  return parseLastMessage(raw, label);
}

function assertSuccessfulCall(
  call: SubprocessResult,
  binary: string,
  label: string
): void {
  if (call.exitCode === 0) return;
  const tail = stderrTail(call.stderr);
  throw new Error(
    `[${label}] ${binary} exited with code ${call.exitCode}${
      tail ? `: ${tail}` : ''
    }`
  );
}

export function createCodexAgentProvider(
  runner: SubprocessRunner = runSubprocess
): ScreeningProvider {
  const triageModel = process.env.ROSIE_CODEX_TRIAGE_MODEL?.trim();
  if (!triageModel) {
    throw new Error(
      'ROSIE_CODEX_TRIAGE_MODEL is required for the codex-agent provider'
    );
  }
  const fullModel = process.env.ROSIE_CODEX_FULL_MODEL?.trim();
  if (!fullModel) {
    throw new Error(
      'ROSIE_CODEX_FULL_MODEL is required for the codex-agent provider'
    );
  }

  const models = { triage: triageModel, full: fullModel };
  // Codex has no --effort flag; reasoning effort is a config override. Values
  // are validated server-side (an unknown level, or "minimal" on gpt-5.6-sol,
  // returns HTTP 400), so a typo fails loudly rather than silently degrading.
  // Verified levels for gpt-5.6-sol: low, medium, high, xhigh, max, ultra.
  const efforts = {
    triage: process.env.ROSIE_CODEX_TRIAGE_EFFORT?.trim() || 'medium',
    full: process.env.ROSIE_CODEX_FULL_EFFORT?.trim() || 'high',
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
  const codexHome =
    process.env.ROSIE_CODEX_HOME?.trim() || join(homedir(), '.rosie-codex');
  const hasPdftoppm = binaryExists('pdftoppm');

  async function invoke({
    label,
    candidateId,
    system,
    userBlocks,
    fallbackUserBlocks,
    schema,
    model,
    effort,
    timeoutMs,
    pdfBase64,
  }: {
    label: string;
    candidateId?: string;
    system: string;
    userBlocks: string[];
    fallbackUserBlocks?: string[];
    schema: Record<string, unknown>;
    model: string;
    effort: string;
    timeoutMs: number;
    pdfBase64?: string;
  }): Promise<unknown> {
    return withTempDir(async (cwd) => {
      const env = buildMinimalEnv({
        HOME: cwd,
        CODEX_HOME: codexHome,
      });
      const schemaPath = join(cwd, 'schema.json');
      const outputPath = join(cwd, 'last-message.json');
      await writeFile(
        schemaPath,
        JSON.stringify(sanitizeSchemaForAnthropic(schema))
      );

      let blocks = userBlocks;
      let imagePaths: string[] = [];
      if (pdfBase64) {
        if (!hasPdftoppm) {
          if (!fallbackUserBlocks) {
            throw new Error(
              `[${label}] pdftoppm is required to score this PDF because no extracted resume text is available; install Poppler or provide resumeText`
            );
          }
          console.warn(
            `[${label}] candidate_id=${
              candidateId || 'n/a'
            } pdf_downgrade=pdftoppm_unavailable input_mode=text`
          );
          blocks = fallbackUserBlocks;
        } else {
          await writeFile(
            join(cwd, 'resume.pdf'),
            Buffer.from(pdfBase64, 'base64')
          );
          try {
            const rasterized = await runner({
              argv: [
                'pdftoppm',
                '-png',
                '-r',
                '150',
                '-f',
                '1',
                '-l',
                String(MAX_PDF_PAGES),
                'resume.pdf',
                'page',
              ],
              cwd,
              env,
              timeoutMs: PDF_RASTERIZE_TIMEOUT_MS,
            });
            assertSuccessfulCall(rasterized, 'pdftoppm', label);
            imagePaths = (await readdir(cwd))
              .map((name) => ({
                name,
                page: /^page-(\d+)\.png$/.exec(name)?.[1],
              }))
              .filter(
                (
                  entry
                ): entry is {
                  name: string;
                  page: string;
                } => Boolean(entry.page)
              )
              .sort((a, b) => Number(a.page) - Number(b.page))
              .slice(0, MAX_PDF_PAGES)
              .map(({ name }) => join(cwd, name));
            if (imagePaths.length === 0) {
              throw new Error(`[${label}] pdftoppm produced no PNG pages`);
            }
          } catch (error) {
            if (!fallbackUserBlocks) throw error;
            console.warn(
              `[${label}] candidate_id=${
                candidateId || 'n/a'
              } pdf_downgrade=rasterization_failed input_mode=text`
            );
            blocks = fallbackUserBlocks;
            imagePaths = [];
          }
        }
      }

      const result = await runner({
        argv: [
          'codex',
          'exec',
          '--sandbox',
          'read-only',
          '--skip-git-repo-check',
          '--ephemeral',
          // Parity with the claude arm's `--setting-sources ""`: load no user
          // config, so a config.toml appearing under CODEX_HOME can never
          // change the model, approval policy, or MCP servers out from under a
          // run. Auth still resolves from CODEX_HOME, so this is safe.
          '--ignore-user-config',
          '-C',
          cwd,
          '--output-schema',
          schemaPath,
          '--output-last-message',
          outputPath,
          '-m',
          model,
          '-c',
          `model_reasoning_effort="${effort}"`,
          ...imagePaths.flatMap((imagePath) => ['-i', imagePath]),
          '-',
        ],
        stdin: [system, ...blocks].join('\n\n'),
        cwd,
        env,
        timeoutMs,
      });
      console.log(
        `[${label}] candidate_id=${
          candidateId || 'n/a'
        } duration_ms=${result.durationMs} exit_code=${
          result.exitCode
        } model=${model} effort=${effort} page_count=${imagePaths.length}`
      );
      assertSuccessfulCall(result, 'codex', label);

      const output = await readLastMessage(outputPath, label);
      try {
        assertNoCredentialLeak(JSON.stringify(output), label);
      } catch (error) {
        console.error(
          `[${label}] credential-like output blocked candidate_id=${
            candidateId || 'n/a'
          }`
        );
        throw error;
      }
      return output;
    });
  }

  return {
    name: 'codex-agent',
    supportsBatch: false,
    supportsPdf: true,
    models,
    triage(input: TriageMessageInput) {
      return withRetry(async () => {
        const output = await invoke({
          label: 'codexAgentTriage',
          candidateId: input.candidateId,
          system: buildTriageSystemText(input.rubric, input.idealPatterns),
          userBlocks: [
            buildTriageResumeBlock(input.resumeText),
            buildTriageInstructionBlock(input.candidateName),
          ],
          schema: triageSchema,
          model: models.triage,
          effort: efforts.triage,
          timeoutMs: timeouts.triage,
        });
        return finalizeTriageResult(
          JSON.stringify(output),
          input.candidateName
        );
      }, `codexAgentTriage:${input.candidateId}`);
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
        const instructionBlock = buildScoreInstructionBlock(
          input.candidateName
        );
        const textBlocks = [
          buildScoreResumeTextBlock(input.resumeText),
          instructionBlock,
        ];
        const output = await invoke({
          label: 'codexAgentScore',
          candidateId: input.candidateId,
          system: buildScoreSystemText(input.rubric, input.idealPatterns),
          userBlocks: usePdf
            ? [
                buildScoreResumePdfBlock('the attached page images'),
                instructionBlock,
              ]
            : textBlocks,
          fallbackUserBlocks:
            usePdf && input.resumeText?.trim() ? textBlocks : undefined,
          schema: scoringResultSchema,
          model: input.model || models.full,
          effort: efforts.full,
          timeoutMs: timeouts.score,
          pdfBase64: usePdf ? input.resumeBase64 || undefined : undefined,
        });
        const result = finalizeScoreResult(
          JSON.stringify(output),
          input.rubric,
          input.candidateName
        );
        return {
          ...result,
          usage: {
            input_tokens: 0,
            output_tokens: 0,
          } as ScoringResponse['usage'],
        };
      }, `codexAgentScore:${input.candidateId}`);
    },
    async requestJSON<T>(req: StructuredJsonRequest): Promise<T> {
      return (await invoke({
        label: req.label,
        system: req.system,
        userBlocks: req.userBlocks,
        schema: req.schema,
        model: req.model || models[req.tier],
        effort: efforts[req.tier],
        timeoutMs: timeouts.score,
      })) as T;
    },
  };
}
