export function normalizeGreenhouseStage(stage: string): string {
  return stage.trim().toLowerCase();
}

export function getTargetGreenhouseStage(): string {
  return normalizeGreenhouseStage(
    process.env.GREENHOUSE_TARGET_STAGE || 'Application Review'
  );
}

export function matchesTargetGreenhouseStage(stage: string | null | undefined): boolean {
  if (!stage) return false;
  return normalizeGreenhouseStage(stage) === getTargetGreenhouseStage();
}
