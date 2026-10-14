import { ScoringRubric } from './types';

// ---- Validation error (retryable) ----

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function validateTriageDecision(
  result: unknown,
  candidateName: string
): void {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new ValidationError(
      `Triage validation failed for ${candidateName}: result is not an object`
    );
  }

  const value = result as Record<string, unknown>;
  const issues: string[] = [];

  if (
    typeof value.bucket !== 'string' ||
    !['top_signal', 'borderline', 'likely_no'].includes(value.bucket)
  ) {
    issues.push('bucket is invalid');
  }
  if (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence)) {
    issues.push('confidence is not a finite number');
  }
  if (typeof value.needsFullScore !== 'boolean') {
    issues.push('needsFullScore is not a boolean');
  }
  if (typeof value.rationale !== 'string' || value.rationale.trim() === '') {
    issues.push('rationale is missing or empty');
  }
  if (typeof value.currentRole !== 'string') {
    issues.push('currentRole is not a string');
  }
  if (typeof value.currentCompany !== 'string') {
    issues.push('currentCompany is not a string');
  }

  if (issues.length > 0) {
    throw new ValidationError(
      `Triage validation failed for ${candidateName}: ${issues.join('; ')}`
    );
  }
}

// ---- Retry helper ----

const MAX_RETRIES = 3;

export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  retries = MAX_RETRIES
): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isLast = attempt === retries;
      const isRetryable =
        err instanceof Error &&
        (err instanceof ValidationError || err instanceof SyntaxError);

      if (isLast) {
        if (err instanceof ValidationError) {
          throw new ValidationError(
            err.message.replace(
              'Scoring validation failed',
              `Scoring validation failed after ${retries} attempts`
            )
          );
        }
        throw err;
      }
      if (!isRetryable) throw err;

      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
      console.warn(`[${label}] Attempt ${attempt} failed, retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error(`[${label}] All ${retries} attempts failed`);
}

// ---- Scoring output validation ----

export function validateScoringResult(
  result: Record<string, unknown>,
  rubric: ScoringRubric,
  candidateName: string
): void {
  const issues: string[] = [];
  const { criterionScores } = result;

  // 1. criterionScores is an array
  if (!Array.isArray(criterionScores)) {
    throw new ValidationError(
      `Scoring validation failed for ${candidateName}: criterionScores is not an array`
    );
  }

  const rubricIds = new Set(rubric.criteria.map((c) => c.id));
  const seenIds = new Set<string>();

  for (let i = 0; i < criterionScores.length; i++) {
    const entry = criterionScores[i];
    const prefix = `criterionScores[${i}]`;

    // 2. Each entry is a non-null object
    if (entry === null || typeof entry !== 'object') {
      issues.push(`${prefix} is not an object`);
      continue;
    }

    const cs = entry as Record<string, unknown>;

    // 3. criterionId is a non-empty trimmed string
    if (typeof cs.criterionId !== 'string' || cs.criterionId.trim() === '') {
      issues.push(`${prefix}.criterionId is missing or empty`);
    } else {
      const id = cs.criterionId.trim();

      // 6. No unknown criterion IDs
      if (!rubricIds.has(id)) {
        issues.push(`${prefix}.criterionId "${id}" not found in rubric`);
      }

      // 7. No duplicate criterion IDs
      if (seenIds.has(id)) {
        issues.push(`${prefix}.criterionId "${id}" is a duplicate`);
      }
      seenIds.add(id);
    }

    // 4. score is finite and within 0-10
    if (typeof cs.score !== 'number' || !Number.isFinite(cs.score)) {
      issues.push(`${prefix}.score is not a finite number`);
    } else if (cs.score < 0 || cs.score > 10) {
      issues.push(`${prefix}.score ${cs.score} is outside 0-10`);
    }

    // 5. evidence is a non-empty trimmed string
    if (typeof cs.evidence !== 'string' || cs.evidence.trim() === '') {
      issues.push(`${prefix}.evidence is missing or empty`);
    }
  }

  // 8. Every rubric criterion appears exactly once (no missing)
  for (const id of rubricIds) {
    if (!seenIds.has(id)) {
      issues.push(`missing criterion "${id}"`);
    }
  }

  if (issues.length > 0) {
    throw new ValidationError(
      `Scoring validation failed for ${candidateName}: ${issues.join('; ')}`
    );
  }
}
