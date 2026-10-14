import { NextResponse, type NextRequest } from 'next/server';
import { isCronAuthorized } from '@/lib/auth';
import { machineHeaders } from '@/lib/machine-fetch';
import { expireStaleBatches } from '@/lib/anthropic-batch';
import { failWatchdogTimedOutRuns, getWatchdogRunIds } from '@/lib/run-store';

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!(await isCronAuthorized(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await expireStaleBatches();
  const failed = await failWatchdogTimedOutRuns();
  const runIds = await getWatchdogRunIds(5);
  const headers = await machineHeaders();

  let ticked = 0;
  const origin = process.env.ROSIE_BASE_URL || request.nextUrl.origin;
  for (const id of runIds) {
    try {
      const response = await fetch(new URL(`/api/runs/${id}/tick`, origin), {
        method: 'POST',
        headers,
      });
      if (response.ok) ticked += 1;
      else console.error(`Watchdog tick failed for ${id}: ${response.status}`);
    } catch (error) {
      console.error(`Watchdog tick request failed for ${id}:`, error);
    }
  }

  return NextResponse.json({ ticked, failed });
}
