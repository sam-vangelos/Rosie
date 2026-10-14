import { getJob } from './greenhouse';
import { machineHeaders } from './machine-fetch';
import { getExecutableProviders } from './providers/config';
import type { ProviderName } from './providers/types';
import {
  createRun,
  getRefreshableJobTemplates,
  RunAlreadyInProgressError,
} from './run-store';

export interface RefreshDeps {
  listTemplates: typeof getRefreshableJobTemplates;
  fetchJob: (jobId: number) => Promise<{ status: string; name: string }>;
  create: typeof createRun;
  kickTick: (runId: string) => Promise<void>;
  executableProviders: ProviderName[];
}

export interface RefreshOutcome {
  started: number;
  skippedActive: number;
  skippedClosed: number;
  skippedProvider: number;
  failed: number;
}

export function buildDefaultRefreshDeps(origin: string): RefreshDeps {
  return {
    listTemplates: getRefreshableJobTemplates,
    fetchJob: (jobId) => getJob(jobId),
    create: createRun,
    executableProviders: getExecutableProviders(),
    kickTick: async (runId) => {
      const headers = await machineHeaders();
      const response = await fetch(new URL(`/api/runs/${runId}/tick`, origin), {
        method: 'POST',
        headers,
      });
      if (!response.ok) {
        throw new Error(`Tick request returned ${response.status}`);
      }
    },
  };
}

/**
 * Start a fresh screening run for every job with a completed manual run,
 * cloned from that run's rubric. The run itself handles both halves of a
 * refresh: fetch keeps only active applications in the target stage (so
 * dispositioned candidates drop out), and the result cache makes unchanged
 * candidates free (so only new applicants cost anything).
 *
 * Mode is always new_or_changed regardless of the template's mode — a manual
 * retry_failed_only or reopen_likely_no run supplies its rubric, never its
 * candidate filter.
 */
export async function runScheduledRefresh(deps: RefreshDeps): Promise<RefreshOutcome> {
  const templates = await deps.listTemplates();
  const outcome: RefreshOutcome = {
    started: 0,
    skippedActive: 0,
    skippedClosed: 0,
    skippedProvider: 0,
    failed: 0,
  };
  const startedRunIds: string[] = [];

  for (const template of templates) {
    if (!deps.executableProviders.includes(template.provider)) {
      // A run created for a non-executable provider would sit queued until the
      // 48-hour watchdog kill, blocking every later refresh of the job.
      outcome.skippedProvider += 1;
      continue;
    }

    let job: { status: string; name: string };
    try {
      job = await deps.fetchJob(template.jobId);
    } catch (error) {
      console.error(
        `Scheduled refresh: status check failed for job ${template.jobId}:`,
        error
      );
      outcome.failed += 1;
      continue;
    }
    if (job.status !== 'open') {
      outcome.skippedClosed += 1;
      continue;
    }

    try {
      const { run } = await deps.create({
        jobId: template.jobId,
        jobTitle: job.name || template.jobTitle,
        mode: 'new_or_changed',
        provider: template.provider,
        rubricVersion: template.rubricVersion,
        calibrationVersion: template.calibrationVersion,
        rubric: template.rubric,
        idealPatterns: template.idealPatterns,
        trigger: 'scheduled',
      });
      outcome.started += 1;
      startedRunIds.push(run.id);
    } catch (error) {
      if (error instanceof RunAlreadyInProgressError) {
        outcome.skippedActive += 1;
        continue;
      }
      console.error(
        `Scheduled refresh: run creation failed for job ${template.jobId}:`,
        error
      );
      outcome.failed += 1;
    }
  }

  // A failed kick is not a failed refresh: the watchdog nudges any unleased
  // run within a minute.
  for (const runId of startedRunIds) {
    try {
      await deps.kickTick(runId);
    } catch (error) {
      console.error(`Scheduled refresh: initial tick failed for run ${runId}:`, error);
    }
  }

  return outcome;
}
