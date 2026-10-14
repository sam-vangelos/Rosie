import { after, NextResponse, type NextRequest } from 'next/server';
import {
  createRun,
  listRunSummaries,
  listRunSummariesForJobs,
  RunAlreadyInProgressError,
} from '@/lib/run-store';
import { resolveJobAccess } from '@/lib/job-access';
import { resolveViewer } from '@/lib/require-viewer';
import { stableHash } from '@/lib/cache';
import type { IdealPatterns, ScreeningRunMode, ScoringRubric } from '@/lib/types';
import { getRegisteredProviders } from '@/lib/providers';
import type { ProviderName } from '@/lib/providers/types';
import { machineHeaders } from '@/lib/machine-fetch';

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  try {
    // Same recruiter scoping as the viewer pages: the JSON API must not be a
    // way around it.
    const viewer = await resolveViewer({ requestHeaders: request.headers });
    if (!viewer) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const access = await resolveJobAccess(viewer);
    const runs =
      access.kind === 'all'
        ? await listRunSummaries(20)
        : await listRunSummariesForJobs([...access.jobIds], 20);
    return NextResponse.json({ runs });
  } catch (error) {
    console.error('List runs error:', error);
    return NextResponse.json({ error: 'Runs temporarily unavailable' }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const origin = process.env.ROSIE_BASE_URL || request.nextUrl.origin;
    const {
      jobId,
      jobTitle,
      rubric,
      idealPatterns,
      rubricVersion,
      calibrationVersion,
      mode,
      provider: requestedProvider,
      groundedByIntakeNotes,
    }: {
      jobId: number;
      jobTitle?: string;
      rubric: ScoringRubric;
      idealPatterns: IdealPatterns | null;
      rubricVersion?: string | null;
      calibrationVersion?: string | null;
      mode?: ScreeningRunMode;
      provider?: unknown;
      groundedByIntakeNotes?: boolean;
    } = await request.json();

    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
    }

    if (!rubric) {
      return NextResponse.json({ error: 'rubric is required' }, { status: 400 });
    }

    // A rubric with no grounding in what "good" looks like does not produce a
    // weak ranking — it produces a meaningless one. Measured on a 75-candidate
    // requisition: against a JD-only rubric, candidates who reached
    // Onsite/Offer/Hired averaged 2.86 while the general pool averaged 2.75 —
    // no separation at all, and the top-ranked candidate was not the one the
    // calibrated rubric put first.
    //
    // Exemplar résumés are one valid grounding. Explicit hiring-team criteria
    // are another, and are STRONGER when a requirement has just changed: on
    // another requisition the hiring team made back-office operations the
    // decisive filter days before this run, so every historical exemplar on
    // the req predated the requirement. Auto-calibration there actively fought
    // the brief — it called the filter "an almost adversarial back-office
    // purity test" and halved a known wrong-fit candidate's penalty — because
    // it had learned from five candidates rejected under the OLD spec.
    //
    // `groundedByIntakeNotes` is a deliberate, auditable assertion by the
    // operator that the rubric encodes stated hiring-team criteria. It is not
    // a generic override: it names the grounding rather than skipping it.
    if (!calibrationVersion && !groundedByIntakeNotes) {
      return NextResponse.json(
        {
          error:
            'This rubric has no stated grounding. Either calibrate it against exemplar resumes, or set groundedByIntakeNotes when it encodes explicit hiring-team criteria — ungrounded scoring cannot separate strong candidates from the pool.',
          code: 'CALIBRATION_REQUIRED',
        },
        { status: 400 }
      );
    }

    const provider = requestedProvider ?? 'api';
    if (
      typeof provider !== 'string' ||
      !getRegisteredProviders().includes(provider as ProviderName)
    ) {
      return NextResponse.json({ error: 'Unknown or unregistered provider' }, { status: 400 });
    }

    const effectiveRubricVersion = rubricVersion || stableHash(rubric);

    const { run, rubric: storedRubric } = await createRun({
      jobId,
      jobTitle: jobTitle || `Job ${jobId}`,
      mode: mode || 'new_or_changed',
      provider: provider as ProviderName,
      rubricVersion: effectiveRubricVersion,
      calibrationVersion: calibrationVersion || null,
      rubric,
      idealPatterns: idealPatterns || null,
    });

    after(async () => {
      const headers = await machineHeaders();
      try {
        const response = await fetch(new URL(`/api/runs/${run.id}/tick`, origin), {
          method: 'POST',
          headers,
        });
        if (!response.ok) console.error(`Initial tick failed: ${response.status}`);
      } catch (error) {
        console.error('Initial tick request failed:', error);
      }
    });

    return NextResponse.json({ run, rubric: storedRubric });
  } catch (error) {
    if (error instanceof RunAlreadyInProgressError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error('Create run error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create screening run' },
      { status: 500 }
    );
  }
}
