import type {
  GHApplication,
  GHCandidate,
  GHJobStage,
} from './greenhouse';
import { normalizeGreenhouseStage } from './greenhouse-stage';
import type { IdealPatterns } from './types';

export interface CalibrationExemplar {
  name: string;
  stage: string;
  status: string;
  /**
   * Greenhouse `last_activity_at`. Surfaced so an operator can see that the
   * five exemplars are all two years old and overrule the cascade — staleness
   * is made visible rather than gated on, because no date rule would have
   * caught the requisition where the requirement changed days before the run.
   */
  activityAt?: string;
}

/**
 * Below three exemplars the cascade stops and hands control to the operator,
 * who can supply resumes directly or refine on what exists anyway. Whether to
 * proceed on fewer than three is a judgment about the requisition, not a rule
 * the system should apply on its own.
 */
export const CALIBRATION_MIN_EXEMPLARS = 3;

/** Hired applications carry no stage, so they get a rung of their own. */
export const HIRED_RUNG = 'Hired';
const HIRED_KEY = 'hired';

export interface ExemplarRung {
  stage: string;
  /** Null for the hired rung, which sits above every stage on the ladder. */
  priority: number | null;
  matched: number;
  taken: number;
}

export interface ExemplarCascadeSelection {
  candidate: GHCandidate;
  application: GHApplication;
  stageName: string;
  status: string;
  activityAt: string;
}

export function buildPatternsOnlyCalibrationPayload(input: {
  patterns: IdealPatterns;
  calibrationVersion: string | null;
  calibrationFailed: boolean;
  filesProcessed: string[];
  totalFiles: number;
  targetStage?: string;
  exemplars?: CalibrationExemplar[];
  rungs?: ExemplarRung[];
}) {
  return {
    ...input,
    targetStage: input.targetStage || 'Manual upload',
    exemplars: input.exemplars || [],
    rungs: input.rungs || [],
    calibratedRubric: null,
  };
}

export function resolveThresholdStage(
  stages: GHJobStage[],
  targetName: string
): GHJobStage | null {
  const target = normalizeGreenhouseStage(targetName);
  if (!target) return null;

  return (
    stages.find((stage) => normalizeGreenhouseStage(stage.name) === target) ||
    stages.find((stage) => normalizeGreenhouseStage(stage.name).includes(target)) ||
    null
  );
}

/**
 * Resolves the floor from the stage that signals hiring-manager endorsement.
 *
 * A candidate *sitting in* a stage has *cleared* the one below it, so anyone
 * above "Hiring Manager Review" has been read and advanced by the hiring
 * manager — which is the judgment the rubric is trying to learn. The stage
 * called "Hiring Manager Review" is itself an early resume read (priority 2-3
 * on every requisition measured), so it sits below the floor, not at it.
 *
 * Deriving the floor structurally rather than by name is what makes this work
 * across requisitions whose ladders differ: on the five requisitions measured
 * it landed on a manager/tech screen for three, a skills assessment for one,
 * and a phone interview for one — five ladders, no shared naming convention.
 */
export function resolveEndorsementFloor(
  stages: GHJobStage[],
  endorsementStageName: string
): {
  endorsementStage: GHJobStage;
  floorPriority: number;
  floorStage: GHJobStage | null;
} | null {
  const endorsementStage = resolveThresholdStage(stages, endorsementStageName);
  if (!endorsementStage) return null;

  const floorPriority = endorsementStage.priority + 1;
  const floorStage =
    stages
      .filter((stage) => stage.priority >= floorPriority)
      .sort((left, right) => left.priority - right.priority)[0] ?? null;

  return { endorsementStage, floorPriority, floorStage };
}

/**
 * Walks the requisition's own stage ladder from the top, accumulating
 * exemplars until `max` are found: hired first, then every stage at or above
 * the floor in descending priority order.
 *
 * The ladder's priority ordering is already the strength ordering, so no stage
 * name is interpreted anywhere in the walk. That is what keeps the cascade
 * correct across requisitions that spell the same rung four different ways
 * ("Verbal Offer", "Offer", "Offer Extend", "Offer Signed") or carry stages the
 * others lack entirely ("Skills Assessment", "AI Interview", "Face to Face").
 *
 * Rejected candidates count as exemplars for the stage they were rejected at,
 * because Rosie's target is the screening decision rather than the hire
 * decision: someone rejected at Onsite cleared every resume-facing gate before
 * the interview that failed them. Excluding them would have discarded every
 * offer-signed candidate on two of the five requisitions measured — 19 of
 * them on one requisition alone.
 *
 * Every rung at or above the floor is reported, including empty ones, so the
 * operator can see the whole walk rather than only its result.
 */
export function selectExemplarCascade(input: {
  candidates: GHCandidate[];
  jobId: number;
  stages: GHJobStage[];
  floorPriority: number;
  max?: number;
}): { selected: ExemplarCascadeSelection[]; rungs: ExemplarRung[] } {
  const max = input.max ?? 5;
  const stageById = new Map(input.stages.map((stage) => [stage.id, stage]));
  const stageByName = new Map(
    input.stages.map((stage) => [normalizeGreenhouseStage(stage.name), stage])
  );

  const bucketed = new Map<string, ExemplarCascadeSelection[]>();
  const push = (key: string, item: ExemplarCascadeSelection) => {
    const existing = bucketed.get(key);
    if (existing) existing.push(item);
    else bucketed.set(key, [item]);
  };

  for (const candidate of input.candidates) {
    const application = candidate.applications.find((item) =>
      item.jobs.some((job) => job.id === input.jobId)
    );
    if (!application || application.prospect) continue;

    // last_activity_at is the honest recency signal. Sorting on applied_at
    // understates a hire who applied months before being hired, and hired
    // applications never carry rejected_at at all.
    const activityAt =
      application.last_activity_at || application.rejected_at || application.applied_at;

    if (application.status === 'hired') {
      push(HIRED_KEY, {
        candidate,
        application,
        stageName: HIRED_RUNG,
        status: application.status,
        activityAt,
      });
      continue;
    }

    // Bucket on the stage resolved from the requisition's own ladder, never on
    // the application's stage string: a renamed stage would otherwise pass the
    // floor test by id and then match no rung in the walk, dropping the
    // candidate silently.
    const resolved = application.current_stage
      ? stageById.get(application.current_stage.id) ??
        stageByName.get(normalizeGreenhouseStage(application.current_stage.name))
      : undefined;
    if (!resolved || resolved.priority < input.floorPriority) continue;

    push(String(resolved.id), {
      candidate,
      application,
      stageName: resolved.name,
      status: application.status,
      activityAt,
    });
  }

  const ladder: Array<{ key: string; stage: string; priority: number | null }> = [
    { key: HIRED_KEY, stage: HIRED_RUNG, priority: null },
    ...input.stages
      .filter((stage) => stage.priority >= input.floorPriority)
      .sort((left, right) => right.priority - left.priority)
      .map((stage) => ({ key: String(stage.id), stage: stage.name, priority: stage.priority })),
  ];

  const selected: ExemplarCascadeSelection[] = [];
  const rungs: ExemplarRung[] = [];

  for (const rung of ladder) {
    const matches = (bucketed.get(rung.key) || []).sort(
      (left, right) =>
        new Date(right.activityAt).getTime() - new Date(left.activityAt).getTime()
    );
    const taken = matches.slice(0, Math.max(0, max - selected.length));
    selected.push(...taken);
    rungs.push({
      stage: rung.stage,
      priority: rung.priority,
      matched: matches.length,
      taken: taken.length,
    });
  }

  return { selected, rungs };
}
