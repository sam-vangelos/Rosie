import { randomUUID } from 'node:crypto';
import { after, NextResponse, type NextRequest } from 'next/server';
import { isCronAuthorized } from '@/lib/auth';
import { machineHeaders } from '@/lib/machine-fetch';
import { claimRunLease, releaseRunLease } from '@/lib/run-store';
import { runTick } from '@/lib/screening-engine';

export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  if (!(await isCronAuthorized(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;
  const ownerToken = randomUUID();
  if (!(await claimRunLease(id, ownerToken))) {
    return NextResponse.json({ claimed: false });
  }

  const origin = process.env.ROSIE_BASE_URL || request.nextUrl.origin;
  after(async () => {
    try {
      const outcome = await runTick(id, ownerToken);
      if (outcome === 'chain') {
        await releaseRunLease(id, ownerToken);
        const headers = await machineHeaders();
        try {
          const response = await fetch(new URL(`/api/runs/${id}/tick`, origin), {
            method: 'POST',
            headers,
          });
          if (!response.ok) console.error(`Chained tick failed: ${response.status}`);
        } catch (error) {
          console.error('Chained tick request failed:', error);
        }
      } else {
        await releaseRunLease(id, ownerToken);
      }
    } catch (error) {
      console.error('Run tick failed:', error);
      await releaseRunLease(id, ownerToken);
    }
  });

  return NextResponse.json({ claimed: true }, { status: 202 });
}
