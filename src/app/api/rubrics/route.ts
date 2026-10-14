import { NextResponse, type NextRequest } from 'next/server';
import { listRubricsForJob } from '@/lib/rubric-store';

export async function GET(request: NextRequest) {
  const rawJobId = request.nextUrl.searchParams.get('jobId');
  const jobId = Number(rawJobId);

  if (rawJobId === null || !Number.isSafeInteger(jobId) || jobId < 0) {
    return NextResponse.json({ error: 'Valid jobId is required' }, { status: 400 });
  }

  try {
    return NextResponse.json({ rubrics: await listRubricsForJob(jobId, 5) });
  } catch (error) {
    console.error('List rubrics error:', error);
    return NextResponse.json({ error: 'Rubrics temporarily unavailable' }, { status: 503 });
  }
}
