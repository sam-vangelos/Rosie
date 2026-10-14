import { apiProvider } from './api';
import { createClaudeAgentProvider } from './claude-agent';
import { createCodexAgentProvider } from './codex-agent';
import type { ProviderName, ScreeningProvider } from './types';

let claudeAgentProvider: ScreeningProvider | undefined;
let codexAgentProvider: ScreeningProvider | undefined;
const providers: Partial<Record<ProviderName, ScreeningProvider>> = {
  api: apiProvider,
  get 'claude-agent'() {
    return (claudeAgentProvider ||= createClaudeAgentProvider());
  },
  get 'codex-agent'() {
    return (codexAgentProvider ||= createCodexAgentProvider());
  },
};

export function getProvider(name: ProviderName): ScreeningProvider {
  const provider = providers[name];
  if (!provider) {
    throw new Error(`Provider "${name}" is not registered`);
  }
  return provider;
}

export function getRegisteredProviders(): ProviderName[] {
  return Object.keys(providers) as ProviderName[];
}

export type { ProviderName, ScreeningProvider, StructuredJsonRequest } from './types';
