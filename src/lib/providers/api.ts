import {
  ANTHROPIC_FULL_SCORE_MODEL,
  ANTHROPIC_TRIAGE_MODEL,
  requestStructuredJSON,
  scoreCandidate,
  triageCandidate,
} from '../anthropic';
import type { ScreeningProvider, StructuredJsonRequest } from './types';

export const apiProvider: ScreeningProvider = {
  name: 'api',
  supportsBatch: true,
  supportsPdf: true,
  get models() {
    return {
      triage: ANTHROPIC_TRIAGE_MODEL,
      full: ANTHROPIC_FULL_SCORE_MODEL,
    };
  },
  triage: triageCandidate,
  score: scoreCandidate,
  async requestJSON<T>(req: StructuredJsonRequest): Promise<T> {
    // KNOWN: requestStructuredJSON re-wraps retryable errors in Error; preserve API behavior.
    return (
      await requestStructuredJSON<T>({
        label: req.label,
        schemaName: req.label,
        schema: req.schema,
        maxOutputTokens: req.maxOutputTokens,
        model: req.model || this.models[req.tier],
        system: req.system
          ? [
              {
                type: 'text',
                text: req.system,
              },
            ]
          : undefined,
        content: req.userBlocks.map((text) => ({
          type: 'text' as const,
          text,
        })),
      })
    ).result;
  },
};
