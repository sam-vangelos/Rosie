import { NextResponse, type NextRequest } from 'next/server';
import { isCronAuthorized } from '@/lib/auth';
import { buildDefaultRefreshDeps, runScheduledRefresh } from '@/lib/refresh';

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!(await isCronAuthorized(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const origin = process.env.ROSIE_BASE_URL || request.nextUrl.origin;
  const outcome = await runScheduledRefresh(buildDefaultRefreshDeps(origin));
  return NextResponse.json(outcome);
}
