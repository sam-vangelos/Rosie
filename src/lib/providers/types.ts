import type {
  ScoreMessageInput,
  ScoringResponse,
  TriageMessageInput,
} from '../anthropic';
import type { TriageDecision } from '../types';

export type ProviderName = 'api' | 'claude-agent' | 'codex-agent';

export interface StructuredJsonRequest {
  label: string;
  tier: 'triage' | 'full';
  model?: string;
  system: string;
  userBlocks: string[];
  schema: Record<string, unknown>;
  maxOutputTokens: number;
}

export interface ScreeningProvider {
  readonly name: ProviderName;
  readonly supportsBatch: boolean;
  readonly supportsPdf: boolean;
  readonly models: { triage: string; full: string };
  triage(input: TriageMessageInput): Promise<TriageDecision>;
  score(input: ScoreMessageInput): Promise<ScoringResponse>;
  requestJSON<T>(req: StructuredJsonRequest): Promise<T>;
}
