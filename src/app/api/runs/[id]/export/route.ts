import { NextResponse } from 'next/server';
import { getRunSummary } from '@/lib/run-store';
import { resolveJobAccess } from '@/lib/job-access';
import { resolveViewer } from '@/lib/require-viewer';

export const maxDuration = 300;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const viewer = await resolveViewer({ requestHeaders: request.headers });
  if (!viewer) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const run = await getRunSummary(id);

  if (!run) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  }

  // Not-found rather than forbidden: a 403 would confirm that a run exists for
  // a requisition this recruiter is not on.
  const access = await resolveJobAccess(viewer);
  if (access.kind === 'jobs' && !access.jobIds.has(run.jobId)) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  }

  const exportPayload = {
    runId: run.id,
    jobId: run.jobId,
    jobTitle: run.jobTitle,
    mode: run.mode,
    rubricVersion: run.rubricVersion,
    calibrationVersion: run.calibrationVersion,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    counts: run.counts,
    audit: run.audit,
    topCandidates: run.fullyScored.filter((candidate) => candidate.tier === 'top'),
    borderlineWatchlist: run.fullyScored.filter(
      (candidate) => candidate.tier === 'strong' || candidate.tier === 'moderate'
    ),
    belowTier: run.fullyScored.filter((candidate) => candidate.tier === 'below'),
    likelyNo: run.likelyNo,
    parseFailures: run.failures,
  };

  return NextResponse.json(exportPayload);
}
