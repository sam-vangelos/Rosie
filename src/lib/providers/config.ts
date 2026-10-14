import type { ProviderName } from './types';

const providerNames = new Set<ProviderName>([
  'api',
  'claude-agent',
  'codex-agent',
]);

export class ProviderNotExecutableError extends Error {
  readonly provider: ProviderName;

  constructor(provider: ProviderName) {
    super(`Provider "${provider}" is not executable in this environment`);
    this.name = 'ProviderNotExecutableError';
    this.provider = provider;
  }
}

export function getExecutableProviders(): ProviderName[] {
  const configured = process.env.ROSIE_EXECUTABLE_PROVIDERS;
  if (!configured?.trim()) return ['api'];

  const providers: ProviderName[] = [];
  for (const value of configured.split(',').map((entry) => entry.trim()).filter(Boolean)) {
    if (!providerNames.has(value as ProviderName)) {
      console.warn(`[providers] Ignoring unknown executable provider "${value}"`);
      continue;
    }
    if (!providers.includes(value as ProviderName)) {
      providers.push(value as ProviderName);
    }
  }
  return providers;
}

export function isProviderExecutable(name: ProviderName): boolean {
  return getExecutableProviders().includes(name);
}

export function assertProviderExecutable(name: ProviderName): void {
  if (!isProviderExecutable(name)) {
    throw new ProviderNotExecutableError(name);
  }
}
