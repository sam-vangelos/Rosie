import Anthropic from '@anthropic-ai/sdk';
import { CriterionScore, IdealPatterns, ScoringRubric, TriageDecision } from './types';
import {
  ValidationError,
  validateScoringResult,
  validateTriageDecision,
  withRetry,
} from './scoring-validation';
import {
  buildCalibrationAnalysisPrompt,
  buildCalibrateRubricPrompt,
  buildExtractPatternsPrompt,
  buildGenerateRubricPrompt,
  buildScoreInstructionBlock,
  buildScoreResumeTextBlock,
  buildScoreSystemText,
  buildTriageInstructionBlock,
  buildTriageResumeBlock,
  buildTriageSystemText,
  calibratedRubricSchema,
  calibrationAnalysisSchema,
  idealPatternsSchema,
  rubricSchema,
  sanitizeSchemaForAnthropic,
  scoringResultSchema,
  triageSchema,
} from './prompt-texts';
import type { ProviderName } from './providers/types';

export { ValidationError, validateScoringResult };
export { sanitizeSchemaForAnthropic } from './prompt-texts';

export const ANTHROPIC_FULL_SCORE_MODEL =
  process.env.ANTHROPIC_MODEL ||
  process.env.ANTHROPIC_FULL_SCORE_MODEL ||
  'claude-sonnet-5';
export const ANTHROPIC_TRIAGE_MODEL =
  process.env.ANTHROPIC_TRIAGE_MODEL || 'claude-haiku-4-5';
export const ANTHROPIC_RUBRIC_MODEL =
  process.env.ANTHROPIC_RUBRIC_MODEL || ANTHROPIC_FULL_SCORE_MODEL;
export const ANTHROPIC_CALIBRATION_MODEL =
  process.env.ANTHROPIC_CALIBRATION_MODEL || ANTHROPIC_FULL_SCORE_MODEL;

type InputContent =
  | Anthropic.Messages.TextBlockParam
  | Anthropic.Messages.DocumentBlockParam;

export function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  return new Anthropic({ apiKey, timeout: 120_000 });
}

export function getOutputText(response: Anthropic.Messages.Message, label: string): string {
  const texts = response.content
    .filter((item) => item.type === 'text' && item.text.trim())
    .map((item) => (item.type === 'text' ? item.text.trim() : ''));

  if (texts.length > 0) {
    return texts.join('\n').trim();
  }

  if (response.stop_reason === 'refusal') {
    throw new Error(`[${label}] Claude refused the request`);
  }

  throw new Error(`[${label}] Claude returned no text output`);
}

export interface RequestStructuredJSONOptions {
  label: string;
  schemaName: string;
  schema: Record<string, unknown>;
  maxOutputTokens: number;
  content: InputContent[];
  system?: Anthropic.Messages.TextBlockParam[];
  model?: string;
}

export interface StructuredJSONResponse<T> {
  result: T;
  usage: Anthropic.Messages.Usage;
}

export function buildStructuredJsonParams(
  options: RequestStructuredJSONOptions
): Anthropic.Messages.MessageCreateParamsNonStreaming {
  return {
    model: options.model || ANTHROPIC_FULL_SCORE_MODEL,
    max_tokens: options.maxOutputTokens,
    thinking: { type: 'disabled' },
    system: options.system,
    messages: [
      {
        role: 'user',
        content: options.content,
      },
    ],
    output_config: {
      format: {
        type: 'json_schema',
        schema: sanitizeSchemaForAnthropic(options.schema) as Record<string, unknown>,
      },
    },
  };
}

export async function requestStructuredJSON<T>(
  options: RequestStructuredJSONOptions
): Promise<StructuredJSONResponse<T>> {
  const client = getAnthropicClient();

  try {
    const response = await client.messages.create(buildStructuredJsonParams(options));
    const text = getOutputText(response, options.label);
    return { result: JSON.parse(text) as T, usage: response.usage };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`[${options.label}] ${error.message}`);
    }
    throw error;
  }
}

export interface RubricProviderOptions {
  model?: string;
  provider?: ProviderName;
}

async function requestRubricJSON<T>(
  request: RequestStructuredJSONOptions,
  options?: RubricProviderOptions
): Promise<T> {
  const providerName = options?.provider || 'api';
  const { getProvider } = await import('./providers');
  const provider = getProvider(providerName);
  const userBlocks = request.content.map((block) => {
    if (block.type !== 'text') {
      throw new Error(`[${request.label}] Rubric requests only support text input`);
    }
    return block.text;
  });

  return provider.requestJSON<T>({
    label: request.label,
    tier: 'full',
    model:
      options?.model ||
      (providerName === 'api' ? request.model : provider.models.full),
    system: request.system?.map((block) => block.text).join('\n\n') || '',
    userBlocks,
    schema: request.schema,
    maxOutputTokens: request.maxOutputTokens,
  });
}

export function buildGenerateRubricRequest(
  jobDescription: string,
  intakeNotes: string,
  model?: string
): RequestStructuredJSONOptions {
  return {
    label: 'generateRubric',
    schemaName: 'rosie_rubric',
    schema: rubricSchema,
    maxOutputTokens: 4096,
    model: model || ANTHROPIC_RUBRIC_MODEL,
    content: [
      {
        type: 'text',
        text: buildGenerateRubricPrompt(jobDescription, intakeNotes),
      },
    ],
  };
}

export async function generateRubric(
  jobDescription: string,
  intakeNotes: string,
  options?: RubricProviderOptions
): Promise<ScoringRubric> {
  return withRetry(async () => {
    return requestRubricJSON<ScoringRubric>(
      buildGenerateRubricRequest(jobDescription, intakeNotes, options?.model),
      options
    );
  }, 'generateRubric');
}

export function buildCalibrateRubricRequest(
  rubric: ScoringRubric,
  idealPatterns: IdealPatterns,
  jobDescription: string,
  model?: string
): RequestStructuredJSONOptions {
  return {
    label: 'calibrateRubric',
    schemaName: 'rosie_calibrated_rubric',
    schema: calibratedRubricSchema,
    maxOutputTokens: 4096,
    model: model || ANTHROPIC_CALIBRATION_MODEL,
    content: [
      {
        type: 'text',
        text: buildCalibrateRubricPrompt(rubric, idealPatterns, jobDescription),
      },
    ],
  };
}

export async function calibrateRubric(
  rubric: ScoringRubric,
  idealPatterns: IdealPatterns,
  jobDescription: string,
  options?: RubricProviderOptions
): Promise<ScoringRubric> {
  return withRetry(async () => {
    return requestRubricJSON<ScoringRubric>(
      buildCalibrateRubricRequest(
        rubric,
        idealPatterns,
        jobDescription,
        options?.model
      ),
      options
    );
  }, 'calibrateRubric');
}

export function buildExtractPatternsRequest(
  resumeTexts: string[],
  model?: string
): RequestStructuredJSONOptions {
  return {
    label: 'extractPatterns',
    schemaName: 'rosie_ideal_patterns',
    schema: idealPatternsSchema,
    maxOutputTokens: 4096,
    model: model || ANTHROPIC_CALIBRATION_MODEL,
    content: [
      {
        type: 'text',
        text: buildExtractPatternsPrompt(resumeTexts),
      },
    ],
  };
}

export async function extractPatterns(
  resumeTexts: string[],
  options?: RubricProviderOptions
): Promise<IdealPatterns> {
  if (resumeTexts.length === 0) {
    throw new Error('No resume texts provided for pattern extraction');
  }

  return withRetry(async () => {
    return requestRubricJSON<IdealPatterns>(
      buildExtractPatternsRequest(resumeTexts, options?.model),
      options
    );
  }, 'extractPatterns');
}

export function buildCalibrationAnalysisRequest({
  rubric,
  jobDescription,
  resumeTexts,
  model,
}: {
  rubric: ScoringRubric;
  jobDescription: string;
  resumeTexts: string[];
  model?: string;
}): RequestStructuredJSONOptions {
  return {
    label: 'analyzeCalibrationResumes',
    schemaName: 'rosie_calibration_analysis',
    schema: calibrationAnalysisSchema,
    maxOutputTokens: 6000,
    model: model || ANTHROPIC_CALIBRATION_MODEL,
    content: [
      {
        type: 'text',
        text: buildCalibrationAnalysisPrompt({ rubric, jobDescription, resumeTexts }),
      },
    ],
  };
}

export async function analyzeCalibrationResumes(
  {
    rubric,
    jobDescription,
    resumeTexts,
  }: {
    rubric: ScoringRubric;
    jobDescription: string;
    resumeTexts: string[];
  },
  options?: RubricProviderOptions
): Promise<{
  patterns: IdealPatterns;
  calibratedRubric: ScoringRubric;
}> {
  if (resumeTexts.length === 0) {
    throw new Error('No resume texts provided for calibration');
  }

  return withRetry(async () => {
    return requestRubricJSON<{
      patterns: IdealPatterns;
      calibratedRubric: ScoringRubric;
    }>(
      buildCalibrationAnalysisRequest({
        rubric,
        jobDescription,
        resumeTexts,
        model: options?.model,
      }),
      options
    );
  }, 'analyzeCalibrationResumes');
}

export interface ScoringResult {
  criterionScores: CriterionScore[];
  strengths: string[];
  gaps: string[];
  currentRole: string;
  currentCompany: string;
}

export interface ScoringResponse extends ScoringResult {
  usage: Anthropic.Messages.Usage;
}

export interface TriageMessageInput {
  rubric: ScoringRubric;
  candidateId: string;
  candidateName: string;
  resumeText: string;
  idealPatterns: IdealPatterns | null;
}

export interface ScoreMessageInput {
  rubric: ScoringRubric;
  idealPatterns: IdealPatterns | null;
  candidateId: string;
  candidateName: string;
  resumeBase64: string | null;
  resumeText: string | null;
  resumeMimeType: string;
  useFileInput?: boolean;
  parseQuality?: import('./types').ParseQuality;
  preferredBucket?: TriageDecision['bucket'];
  model?: string;
}

export function buildTriageMessageParams({
  rubric,
  candidateName,
  resumeText,
  idealPatterns,
}: TriageMessageInput): Anthropic.Messages.MessageCreateParamsNonStreaming {
  return {
    model: ANTHROPIC_TRIAGE_MODEL,
    max_tokens: 700,
    thinking: { type: 'disabled' },
    system: [
      {
        type: 'text',
        cache_control: { type: 'ephemeral' },
        text: buildTriageSystemText(rubric, idealPatterns),
      },
    ],
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: buildTriageResumeBlock(resumeText),
          },
          {
            type: 'text',
            text: buildTriageInstructionBlock(candidateName),
          },
        ],
      },
    ],
    output_config: {
      format: {
        type: 'json_schema',
        schema: sanitizeSchemaForAnthropic(triageSchema) as Record<string, unknown>,
      },
    },
  };
}

export function finalizeTriageResult(
  rawText: string,
  candidateName: string
): TriageDecision {
  const result = JSON.parse(rawText) as TriageDecision;
  validateTriageDecision(result as unknown as Record<string, unknown>, candidateName);
  result.confidence = Math.min(1, Math.max(0, result.confidence));
  return result;
}

export async function triageCandidate(input: TriageMessageInput): Promise<TriageDecision> {
  return withRetry(async () => {
    const response = await getAnthropicClient().messages.create(buildTriageMessageParams(input));
    const result = finalizeTriageResult(
      getOutputText(response, `triageCandidate:${input.candidateId}`),
      input.candidateName
    );

    console.log(
      `[triageCandidate] candidate_id=${input.candidateId} input_tokens=${response.usage.input_tokens} cache_creation_input_tokens=${response.usage.cache_creation_input_tokens ?? 0} cache_read_input_tokens=${response.usage.cache_read_input_tokens ?? 0}`
    );
    return result;
  }, `triageCandidate:${input.candidateId}`);
}

export function buildScoreMessageParams({
  rubric,
  idealPatterns,
  candidateName,
  resumeBase64,
  resumeText,
  resumeMimeType,
  useFileInput = true,
  model = ANTHROPIC_FULL_SCORE_MODEL,
}: ScoreMessageInput): Anthropic.Messages.MessageCreateParamsNonStreaming {
  const content: InputContent[] = [];

  if (useFileInput && resumeBase64 && resumeMimeType === 'application/pdf') {
    content.push({
      type: 'document',
      title: 'Candidate resume',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: resumeBase64,
      },
    });
  } else {
    content.push({
      type: 'text',
      text: buildScoreResumeTextBlock(resumeText),
    });
  }

  content.push({
    type: 'text',
    text: buildScoreInstructionBlock(candidateName),
  });

  return {
    model,
    max_tokens: 1500,
    thinking: { type: 'disabled' },
    system: [
      {
        type: 'text',
        cache_control: { type: 'ephemeral' },
        text: buildScoreSystemText(rubric, idealPatterns),
      },
    ],
    messages: [{ role: 'user', content }],
    output_config: {
      format: {
        type: 'json_schema',
        schema: sanitizeSchemaForAnthropic(scoringResultSchema) as Record<string, unknown>,
      },
    },
  };
}

export function finalizeScoreResult(
  rawText: string,
  rubric: ScoringRubric,
  candidateName: string
): ScoringResult {
  const result = JSON.parse(rawText) as ScoringResult;
  validateScoringResult(result as unknown as Record<string, unknown>, rubric, candidateName);

  const clampAndRound = (value: number) =>
    Math.round(Math.min(10, Math.max(0, value)) * 10) / 10;

  for (const criterionScore of result.criterionScores) {
    criterionScore.score = clampAndRound(criterionScore.score);
  }

  result.strengths = result.strengths || [];
  result.gaps = result.gaps || [];
  result.currentRole = result.currentRole || '';
  result.currentCompany = result.currentCompany || '';
  return result;
}

export async function scoreCandidate(input: ScoreMessageInput): Promise<ScoringResponse> {
  return withRetry(async () => {
    const response = await getAnthropicClient().messages.create(buildScoreMessageParams(input));
    const result = finalizeScoreResult(
      getOutputText(response, `scoreCandidate:${input.candidateId}`),
      input.rubric,
      input.candidateName
    );

    console.log(
      `[scoreCandidate] candidate_id=${input.candidateId} input_tokens=${response.usage.input_tokens} cache_creation_input_tokens=${response.usage.cache_creation_input_tokens ?? 0} cache_read_input_tokens=${response.usage.cache_read_input_tokens ?? 0}`
    );
    return { ...result, usage: response.usage };
  }, `scoreCandidate:${input.candidateId}`);
}

export function computeOverallScore(
  criterionScores: CriterionScore[],
  rubric: ScoringRubric
): number {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const criterionScore of criterionScores) {
    const criterion = rubric.criteria.find((item) => item.id === criterionScore.criterionId);
    const weight = criterion?.weight ?? 0;
    weightedSum += criterionScore.score * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return 0;

  const score = weightedSum / totalWeight;
  return Math.round(Math.min(10, Math.max(0, score)) * 10) / 10;
}
