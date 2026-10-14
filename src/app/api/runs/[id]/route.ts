import { after, NextResponse, type NextRequest } from 'next/server';
import { getRunSummary, shouldNudgeRun } from '@/lib/run-store';
import { getRunRubric } from '@/lib/rubric-store';
import { isOperatorRequest } from '@/lib/auth';
import { machineHeaders } from '@/lib/machine-fetch';
import { resolveJobAccess } from '@/lib/job-access';
import { resolveViewer } from '@/lib/require-viewer';

export const maxDuration = 300;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  try {
    const viewer = await resolveViewer({ requestHeaders: request.headers });
    if (!viewer) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [run, rubric] = await Promise.all([getRunSummary(id), getRunRubric(id)]);

    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    // Not-found rather than forbidden: a 403 would confirm that a run exists
    // for a requisition this recruiter is not on.
    const access = await resolveJobAccess(viewer);
    if (access.kind === 'jobs' && !access.jobIds.has(run.jobId)) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    if (await isOperatorRequest(request) && await shouldNudgeRun(id)) {
      const origin = process.env.ROSIE_BASE_URL || request.nextUrl.origin;
      after(async () => {
        const headers = await machineHeaders();
        try {
          await fetch(new URL(`/api/runs/${id}/tick`, origin), {
            method: 'POST',
            headers,
          });
        } catch (error) {
          console.error('Poll nudge failed:', error);
        }
      });
    }

    return NextResponse.json({ run, rubric });
  } catch (error) {
    console.error('Get run error:', error);
    return NextResponse.json({ error: 'Run temporarily unavailable' }, { status: 503 });
  }
}
