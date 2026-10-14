import { after, NextResponse } from 'next/server';
import { cancelRunBatches } from '@/lib/anthropic-batch';
import { requestRunCancel } from '@/lib/run-store';

export const maxDuration = 300;

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const run = await requestRunCancel(id);

  if (!run) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  }

  if (run.status === 'canceled') {
    after(() => cancelRunBatches(id).catch((error) => {
      console.error(`[anthropic-batch] cancel failed run=${id}:`, error);
    }));
  }

  return NextResponse.json({ run });
}
